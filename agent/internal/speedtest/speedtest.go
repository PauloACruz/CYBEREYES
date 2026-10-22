// Package speedtest mede a conexao da maquina com a internet a pedido do console (func speedtest):
// rede local e Wi-Fi, latencia e perda de pacotes (gateway, DNS publicos e servidor Cybereyes),
// resolucao de nomes, download e upload com uma e com varias conexoes e a latencia sob carga.
// O andamento e o relatorio vao por PATCH /api/v4/{agent_id}/{pk}/speedtest/.
// Contrato: docs/agente/contrato-eyes.md, secao 4.3.
package speedtest

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Modos do teste.
const (
	ModeFull  = "full"
	ModeQuick = "quick"
)

// Fases informadas ao console.
const (
	PhaseNetwork   = "network"
	PhaseLatency   = "latency"
	PhaseDownload  = "download"
	PhaseUpload    = "upload"
	PhaseFinishing = "finishing"
)

const (
	// testTimeout limita o teste inteiro; reportTimeout, cada envio ao servidor.
	testTimeout   = 4 * time.Minute
	reportTimeout = time.Minute
	// progressEvery limita os envios de andamento durante as transferencias.
	progressEvery = time.Second
)

// rest e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type rest interface {
	Patch(ctx context.Context, path string, body, out any) error
}

type worker struct {
	api     rest
	agentID string
	log     *slog.Logger
	spawn   func(name string, fn func(ctx context.Context))
	// newEngine monta o motor de medicao (os testes trocam o servidor e os tamanhos).
	newEngine func(mode string, progress func(phase string, pct int, liveMbps float64)) *Engine
	// mu deixa um teste por vez: dois ao mesmo tempo dividiriam a banda e falseariam os dois.
	mu sync.Mutex
}

// Register liga o comando speedtest.
func Register(e *env.Env) error {
	opt := api.Options{Insecure: e.Cfg.Insecure, Proxy: e.Cfg.Proxy}
	w := &worker{
		api:     e.API,
		agentID: e.Cfg.AgentID,
		log:     e.Log.With("modulo", "teste-de-velocidade"),
		spawn:   e.Go,
		newEngine: func(mode string, progress func(string, int, float64)) *Engine {
			return NewEngine(Config{Mode: mode, Proxy: e.Cfg.Proxy, ServerURL: e.Cfg.API, ServerOptions: opt, Progress: progress})
		},
	}
	w.register(e.Reg)
	return nil
}

// register liga o comando. Chega por publish; o teste segue em segundo plano.
func (w *worker) register(reg *rpc.Registry) {
	reg.HandleTimeout("speedtest", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		pk := req.Int("speedtest_pk")
		if pk <= 0 {
			w.log.Warn("speedtest sem speedtest_pk valido")
			return "error: speedtest_pk invalido"
		}
		mode := req.Str("mode")
		if mode != ModeQuick {
			mode = ModeFull
		}
		w.spawn("teste-de-velocidade", func(ctx context.Context) { w.run(ctx, pk, mode) })
		return "ok"
	})
}

// update e o corpo do PATCH speedtest: andamento (running) ou resultado (completed/failed).
type update struct {
	Status   string  `json:"status"`
	Phase    string  `json:"phase,omitempty"`
	Progress int     `json:"progress"`
	LiveMbps float64 `json:"live_mbps,omitempty"`
	Error    string  `json:"error,omitempty"`
	Report   *Report `json:"report,omitempty"`
}

func (w *worker) run(parent context.Context, pk int, mode string) {
	if !w.mu.TryLock() {
		w.send(parent, pk, update{Status: "failed", Error: "Já existe um teste de velocidade em andamento nesta máquina"})
		return
	}
	defer w.mu.Unlock()
	ctx, cancel := context.WithTimeout(parent, testTimeout)
	defer cancel()

	var last time.Time
	var lastPhase string
	progress := func(phase string, pct int, live float64) {
		// Troca de fase sai na hora; dentro da fase, no maximo um envio por segundo.
		if phase == lastPhase && time.Since(last) < progressEvery {
			return
		}
		last, lastPhase = time.Now(), phase
		w.send(ctx, pk, update{Status: "running", Phase: phase, Progress: pct, LiveMbps: round1(live)})
	}
	w.log.Info("teste de velocidade iniciado", "pk", pk, "modo", mode)
	rep, err := w.newEngine(mode, progress).Run(ctx)
	if err != nil {
		w.log.Warn("teste de velocidade falhou", "pk", pk, "erro", err)
		w.send(parent, pk, update{Status: "failed", Progress: 100, Error: err.Error(), Report: rep})
		return
	}
	w.log.Info("teste de velocidade concluido", "pk", pk, "download_mbps", rep.Download.Mbps, "upload_mbps", rep.Upload.Mbps)
	w.send(parent, pk, update{Status: "completed", Progress: 100, Report: rep})
}

func (w *worker) send(parent context.Context, pk int, u update) {
	// Mesmo com o agente parando, tenta entregar o resultado.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), reportTimeout)
	defer cancel()
	if err := w.api.Patch(ctx, resultPath(w.agentID, pk), u, nil); err != nil {
		w.log.Warn("falha ao enviar o teste de velocidade", "pk", pk, "status", u.Status, "erro", err)
	}
}

// resultPath segue a ordem do softwareresult: agent_id antes do pk.
func resultPath(agentID string, pk int) string {
	return fmt.Sprintf("/api/v4/%s/%d/speedtest/", url.PathEscape(agentID), pk)
}
