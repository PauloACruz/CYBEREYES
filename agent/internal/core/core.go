// Package core tem os comandos basicos do EYES: ping e autoatualizacao do binario.
package core

import (
	"context"
	"time"

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
	return nil
}
