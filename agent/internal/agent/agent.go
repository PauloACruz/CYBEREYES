// Package agent monta o EYES em execucao: carrega a configuracao, conecta ao NATS,
// registra os comandos de cada modulo e inicia as rotinas periodicas.
package agent

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/bus"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/logfile"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// Module e a funcao de partida de cada modulo: registra comandos em e.Reg e inicia rotinas com e.Go.
type Module func(e *env.Env) error

// Modules e a lista de modulos ativos, preenchida em modules.go.
var modules []Module

// Service e o laco usado pelo servico do sistema (log em arquivo com rotacao).
func Service(ctx context.Context) error {
	w, err := logfile.Open(filepath.Join(config.DataDir(), "logs", "eyes.log"), 10<<20, 3)
	var out io.Writer = os.Stderr
	if err == nil {
		defer w.Close()
		out = io.MultiWriter(w, os.Stderr)
	}
	log := slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: slog.LevelInfo}))
	return run(ctx, log, true)
}

// Foreground e o laco em primeiro plano, com log detalhado no terminal.
func Foreground(ctx context.Context) error {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return run(ctx, log, false)
}

// run executa o agente ate ctx ser cancelado.
func run(ctx context.Context, log *slog.Logger, asService bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log = log.With("agent_id", cfg.AgentID)
	log.Info("EYES iniciando", "versao", version.Version, "api", cfg.API)

	client, err := api.New(cfg.API, cfg.Token, api.Options{Insecure: cfg.Insecure, Proxy: cfg.Proxy})
	if err != nil {
		return err
	}
	reg := rpc.NewRegistry(log)
	pub := &lazyPublisher{}
	e := &env.Env{Cfg: cfg, API: client, Pub: pub, Reg: reg, Log: log, Ctx: ctx, Service: asService, Refresh: func() {}}

	for _, m := range modules {
		if err := m(e); err != nil {
			log.Error("falha ao iniciar modulo", "erro", err)
		}
	}

	// O NATS tenta reconectar para sempre; a primeira conexao tambem e repetida em segundo plano.
	b, err := bus.Connect(ctx, bus.Options{URL: cfg.NatsServer(), AgentID: cfg.AgentID, Token: cfg.Token, Insecure: cfg.Insecure, Proxy: cfg.Proxy}, reg, log)
	for err != nil {
		log.Error("falha ao conectar no NATS; nova tentativa em 30 s", "erro", err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(30 * time.Second):
		}
		b, err = bus.Connect(ctx, bus.Options{URL: cfg.NatsServer(), AgentID: cfg.AgentID, Token: cfg.Token, Insecure: cfg.Insecure, Proxy: cfg.Proxy}, reg, log)
	}
	pub.set(b)
	log.Info("EYES em execucao", "nats", cfg.NatsServer())
	<-ctx.Done()
	log.Info("EYES parando")
	b.Close()
	return nil
}
