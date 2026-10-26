// Package core tem os comandos basicos do EYES: ping e autoatualizacao do binario.
package core

import (
	"context"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/binswap"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Register registra os comandos e inicia a verificacao periodica de atualizacao.
func Register(e *env.Env) error {
	e.Reg.HandleTimeout("ping", 10*time.Second, func(context.Context, rpc.Request) any { return "pong" })
	e.Reg.HandleTimeout("agentupdate", 15*time.Minute, func(ctx context.Context, req rpc.Request) any {
		return update(ctx, e, req)
	})
	e.Go("updatecheck", func(ctx context.Context) { updateCheckLoop(ctx, e) })
	if e.Service {
		e.Go("binarycheck", func(ctx context.Context) { binaryCheckLoop(ctx, e) })
	}
	return nil
}

// binaryCheckLoop confere, na partida e a cada hora, se o executavel do servico existe e o recoloca a partir do .old
// quando falta: sem ele o servico nao sobe no proximo boot (ver binswap).
func binaryCheckLoop(ctx context.Context, e *env.Env) {
	for {
		dest := config.BinaryPath()
		if restored, err := binswap.Ensure(dest); err != nil {
			e.Log.Warn("executavel do servico ausente e nao recolocado", "binario", dest, "erro", err)
		} else if restored {
			e.Log.Warn("executavel do servico estava ausente; recolocado a partir do .old", "binario", dest)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}
