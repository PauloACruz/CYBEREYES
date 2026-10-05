//go:build !windows

package wua

import (
	"context"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Register registra os comandos do Windows Update como stubs: o servidor so os publica para
// agentes Windows, mas um comando vindo por engano recebe erro claro em vez de "desconhecido".
func Register(e *env.Env) error {
	registerStubs(e.Reg)
	return nil
}

func registerStubs(reg *rpc.Registry) {
	stub := func(context.Context, rpc.Request) any { return "error: " + ErrUnsupported.Error() }
	reg.HandleTimeout("getwinupdates", 10*time.Second, stub)
	reg.HandleTimeout("installwinupdates", 10*time.Second, stub)
}
