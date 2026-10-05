package actions

import (
	"context"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// powerDelay da tempo para a resposta "ok" sair pelo NATS antes de desligar.
const powerDelay = 3 * time.Second

// power trata rebootnow (reboot=true) e shutdown: responde "ok" e age depois de powerDelay.
// rebootnow tambem chega como publish (sem reply) depois do Windows Update; o fluxo e o mesmo.
func (h *handlers) power(reboot bool) rpc.Handler {
	return func(ctx context.Context, req rpc.Request) any {
		if err := powerCheck(); err != nil {
			return errText(err)
		}
		what := "desligamento"
		if reboot {
			what = "reinicio"
		}
		h.e.Log.Info("pedido de "+what+" recebido do servidor", "func", req.Func())
		h.e.Go("power-"+req.Func(), func(context.Context) {
			// Sem respeitar o ctx do agente: o servico pode estar parando justamente pelo desligamento.
			time.Sleep(powerDelay)
			if err := powerAction(reboot); err != nil {
				h.e.Log.Error("falha no "+what, "erro", err)
			}
		})
		return "ok"
	}
}
