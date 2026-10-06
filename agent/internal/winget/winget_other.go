//go:build !windows

package winget

import (
	"context"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Register registra o installwithwinget como stub: o servidor so o publica para agentes Windows, mas
// um comando vindo por engano recebe erro claro.
func Register(e *env.Env) error {
	e.Reg.HandleTimeout("installwithwinget", 10*time.Second, func(context.Context, rpc.Request) any {
		return "error: " + ErrUnsupported.Error()
	})
	return nil
}
