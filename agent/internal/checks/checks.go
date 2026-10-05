// Package checks executa os checks de monitoramento do servidor (contrato 3.5): busca periodica em
// GET /api/v3/{agent_id}/checkrunner/, comando runchecks e envio de cada resultado em
// PATCH /api/v3/checkrunner/.
package checks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const (
	// maxParallel limita os checks executando ao mesmo tempo.
	maxParallel = 4
	// intervalo padrao do agente quando o servidor nao informa check_interval.
	fallbackInterval = 120 * time.Second
	minInterval      = 15 * time.Second
	maxInterval      = time.Hour
	// retryDelay e a espera depois de falha na busca dos checks.
	retryDelay = 60 * time.Second
	// sampleEvery e o periodo do amostrador de CPU e memoria.
	sampleEvery = 30 * time.Second
)

// Register inicia o amostrador de CPU e memoria, o laco de checks e o comando runchecks.
func Register(e *env.Env) error {
	s := NewSampler(sampleEvery)
	r := NewRunner(e.API, e.Cfg.AgentID, e.Log.With("modulo", "checks"), s)
	e.Go("checks-sampler", s.Run)
	e.Go("checks-loop", r.Loop)
	e.Reg.HandleTimeout("runchecks", 30*time.Second, func(context.Context, rpc.Request) any {
		// Publish sem resposta: a execucao segue em segundo plano com o contexto do agente.
		e.Go("runchecks", func(ctx context.Context) {
			if _, err := r.RunOnce(ctx, true); err != nil {
				r.log.Warn("runchecks: falha ao buscar os checks", "erro", err)
			}
		})
		return "ok"
	})
	return nil
}

// Runner busca, executa e reporta os checks.
type Runner struct {
	api     *api.Client
	agentID string
	log     *slog.Logger
	sampler *Sampler
	sem     chan struct{}

	mu      sync.Mutex
	running map[int]bool
	// lastSent guarda quando cada check teve o resultado aceito (protecao contra repeticao).
	lastSent map[int]time.Time
	wg       sync.WaitGroup

	now func() time.Time
}

// NewRunner cria o executor de checks.
func NewRunner(client *api.Client, agentID string, log *slog.Logger, s *Sampler) *Runner {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	if s == nil {
		s = NewSampler(sampleEvery)
	}
	return &Runner{
		api:      client,
		agentID:  agentID,
		log:      log,
		sampler:  s,
		sem:      make(chan struct{}, maxParallel),
		running:  map[int]bool{},
		lastSent: map[int]time.Time{},
		now:      time.Now,
	}
}

// Loop busca os checks vencidos e dorme o check_interval devolvido, ate ctx ser cancelado.
func (r *Runner) Loop(ctx context.Context) {
	delay := time.Duration(5+rand.IntN(15)) * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		interval, err := r.RunOnce(ctx, false)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			r.log.Warn("falha ao buscar os checks", "erro", err)
			delay = retryDelay
			continue
		}
		delay = interval
	}
}

// RunOnce busca os checks (vencidos, ou todos com all) e dispara a execucao em segundo plano.
// Devolve o intervalo ate a proxima busca.
func (r *Runner) RunOnce(ctx context.Context, all bool) (time.Duration, error) {
	interval, list, err := r.fetch(ctx, all)
	if err != nil {
		return 0, err
	}
	for _, c := range list {
		if !all && r.recentlySent(c) {
			r.log.Debug("check ignorado: executado ha pouco", "check", c.ID)
			continue
		}
		r.start(ctx, c)
	}
	return interval, nil
}

// Wait espera os checks em execucao terminarem (usado em testes e no desligamento).
func (r *Runner) Wait() { r.wg.Wait() }

type checksResponse struct {
	Agent         json.RawMessage   `json:"agent"`
	CheckInterval json.RawMessage   `json:"check_interval"`
	Checks        []json.RawMessage `json:"checks"`
}

func (r *Runner) fetch(ctx context.Context, all bool) (time.Duration, []Check, error) {
	route := "/api/v3/" + r.agentID + "/checkrunner/"
	if all {
		route = "/api/v3/" + r.agentID + "/runchecks/"
	}
	var resp checksResponse
	if err := r.api.Get(ctx, route, &resp); err != nil {
		return 0, nil, err
	}
	interval := fallbackInterval
	var secs float64
	if json.Unmarshal(resp.CheckInterval, &secs) == nil && secs > 0 && !math.IsInf(secs, 0) {
		interval = time.Duration(secs * float64(time.Second))
	}
	interval = min(max(interval, minInterval), maxInterval)

	out := make([]Check, 0, len(resp.Checks))
	for _, raw := range resp.Checks {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			r.log.Warn("check ignorado: objeto invalido", "erro", err)
			continue
		}
		c, err := parseCheck(m)
		if err != nil {
			r.log.Warn("check ignorado", "erro", err)
			continue
		}
		out = append(out, c)
	}
	return interval, out, nil
}

// recentlySent evita repetir um check com run_interval proprio que acabou de ser enviado.
func (r *Runner) recentlySent(c Check) bool {
	if c.RunInterval <= 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	last, ok := r.lastSent[c.ID]
	return ok && r.now().Sub(last) < time.Duration(c.RunInterval)*time.Second-10*time.Second
}

// start executa o check em segundo plano, sem repetir um check que ainda esta rodando.
func (r *Runner) start(ctx context.Context, c Check) {
	r.mu.Lock()
	if r.running[c.ID] {
		r.mu.Unlock()
		r.log.Debug("check ainda em execucao", "check", c.ID)
		return
	}
	r.running[c.ID] = true
	r.mu.Unlock()
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		defer func() {
			r.mu.Lock()
			delete(r.running, c.ID)
			r.mu.Unlock()
		}()
		select {
		case r.sem <- struct{}{}:
		case <-ctx.Done():
			return
		}
		defer func() { <-r.sem }()
		r.runCheck(ctx, c)
	}()
}

// runCheck avalia o check e envia o resultado; panico em um check nao derruba o agente.
func (r *Runner) runCheck(ctx context.Context, c Check) {
	defer func() {
		if p := recover(); p != nil {
			r.log.Error("falha interna no check", "check", c.ID, "tipo", c.Type, "panic", p)
		}
	}()
	// Folga sobre o tempo limite do check para a coleta e o envio.
	cctx, cancel := context.WithTimeout(ctx, c.Timeout+30*time.Second)
	defer cancel()
	fields, err := r.evaluate(cctx, c)
	if err != nil {
		if errors.Is(err, errSkip) {
			r.log.Debug("check nao enviado", "check", c.ID, "tipo", c.Type, "motivo", err)
		} else {
			r.log.Warn("check nao enviado", "check", c.ID, "tipo", c.Type, "erro", err)
		}
		return
	}
	body := map[string]any{"id": c.ID, "agent_id": r.agentID}
	for k, v := range fields {
		body[k] = v
	}
	if err := r.api.Patch(ctx, "/api/v3/checkrunner/", body, nil); err != nil {
		if api.IsStatus(err, http.StatusNotFound) {
			r.log.Debug("check nao pertence mais ao agente", "check", c.ID)
		} else {
			r.log.Warn("falha ao enviar resultado do check", "check", c.ID, "erro", err)
		}
		return
	}
	r.mu.Lock()
	r.lastSent[c.ID] = r.now()
	r.mu.Unlock()
}

// errSkip indica check que nao deve ser enviado (tipo desconhecido ou sem suporte no sistema).
var errSkip = errors.New("check ignorado")

// evaluate executa o check e devolve os campos do corpo do PATCH para o tipo.
func (r *Runner) evaluate(ctx context.Context, c Check) (map[string]any, error) {
	switch c.Type {
	case typeDiskSpace:
		return diskCheck(c), nil
	case typeCPULoad:
		p, err := r.sampler.CPU(ctx)
		if err != nil {
			return nil, fmt.Errorf("uso de CPU: %w", err)
		}
		return map[string]any{"percent": round2(p)}, nil
	case typeMemory:
		p, err := r.sampler.Memory()
		if err != nil {
			return nil, fmt.Errorf("uso de memoria: %w", err)
		}
		return map[string]any{"percent": round2(p)}, nil
	case typePing:
		return pingCheck(ctx, c), nil
	case typeScript:
		return scriptCheck(ctx, c), nil
	case typeWinSvc:
		return winsvcCheck(ctx, c)
	case typeEventLog:
		return eventLogCheck(c, r.now())
	}
	return nil, fmt.Errorf("%w: tipo desconhecido %q", errSkip, c.Type)
}

func round2(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
}
