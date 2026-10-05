package remote

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/tray"
)

// consent aplica a politica de aviso pelo eyes-tray (contrato, secao 8.3) e devolve a funcao que encerra o aviso.
//   - none: nada aparece para o usuario.
//   - notify: aviso durante a sessao, com o botao Encerrar; sem eyes-tray conectado, segue sem aviso e registra no log.
//   - ask: pede o aceite; o resultado vai para o remote-helper, que so manda imagem depois de "accepted".
//     Sem eyes-tray conectado, recusa.
//
// O fim pedido pelo usuario no eyes-tray vira Control{End: "user"}.
func consent(ctx context.Context, log *slog.Logger, t target, p HelperParams, technician string, control chan<- Control) func() {
	end := func() {
		select {
		case control <- Control{End: "user"}:
		default:
		}
	}
	notify := func() func() {
		stop, ok := tray.Events.Notify(p.SessionID, t.User, technician, end)
		if !ok {
			log.Info("app de bandeja do usuario nao conectado; acesso segue sem aviso", "usuario", t.User)
		}
		return stop
	}
	switch p.Policy.Consent {
	case "notify":
		return notify()
	case "ask":
		timeout := time.Duration(max(10, p.Policy.ConsentTimeoutSeconds)) * time.Second
		accepted, err := tray.Events.Ask(ctx, p.SessionID, t.User, technician, timeout)
		state := "denied"
		switch {
		case accepted:
			state = "accepted"
		case errors.Is(err, tray.ErrTimeout):
			state = "timeout"
		case errors.Is(err, tray.ErrNoTray):
			log.Info("app de bandeja do usuario nao conectado; pedido de acesso recusado", "usuario", t.User)
		}
		log.Info("resposta do usuario ao pedido de acesso", "resposta", state)
		control <- Control{Consent: state}
		if accepted {
			// Depois do aceite, o aviso fica na tela durante a sessao.
			return notify()
		}
	}
	return func() {}
}
