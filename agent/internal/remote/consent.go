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
//   - notify: aviso durante a sessao, com o botao Encerrar; sem eyes-tray conectado, notificacao do sistema (Linux e
//     macOS) ou, sem ela, segue sem aviso e registra no log.
//   - ask: pede o aceite; o resultado vai para o remote-helper, que so manda imagem depois de "accepted".
//     Sem eyes-tray conectado, usa a caixa de dialogo do sistema (Linux e macOS); sem ela, recusa.
//
// O fim pedido pelo usuario no eyes-tray vira Control{End: "user"}.
// errNoDialog indica que o sistema nao tem caixa de dialogo para o pedido de acesso.
var errNoDialog = errors.New("sem caixa de dialogo do sistema")

// Caixa de dialogo e notificacao do sistema (trocadas nos testes).
var (
	askDialog    = systemAsk
	notifyDialog = systemNotify
)

// errAskTimeout indica que o usuario nao respondeu a caixa de dialogo do sistema.
var errAskTimeout = errors.New("usuario nao respondeu")

// consentText e o texto do aviso e do pedido.
func consentText(technician string, ask bool) string {
	who := technician
	if who == "" {
		who = "Um técnico"
	}
	if ask {
		return who + " quer acessar este computador para ver a tela e usar o mouse e o teclado. Permitir?"
	}
	return who + " está acessando este computador."
}

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
			// Sem eyes-tray: notificacao do sistema (Linux e macOS), sem o botao Encerrar.
			if err := notifyDialog(ctx, t, technician); err != nil {
				log.Info("aviso ao usuario indisponivel; acesso segue sem aviso", "usuario", t.User, "erro", err)
			}
		}
		return stop
	}
	switch p.Policy.Consent {
	case "notify":
		return notify()
	case "ask":
		timeout := time.Duration(max(10, p.Policy.ConsentTimeoutSeconds)) * time.Second
		accepted, err := tray.Events.Ask(ctx, p.SessionID, t.User, technician, timeout)
		if errors.Is(err, tray.ErrNoTray) {
			// Sem eyes-tray: caixa de dialogo do sistema (zenity ou kdialog no Linux, osascript no macOS).
			accepted, err = askDialog(ctx, t, technician, timeout)
			if errors.Is(err, errNoDialog) {
				err = tray.ErrNoTray
			}
		}
		state := "denied"
		switch {
		case accepted:
			state = "accepted"
		case errors.Is(err, tray.ErrTimeout), errors.Is(err, errAskTimeout):
			state = "timeout"
		case errors.Is(err, tray.ErrNoTray):
			log.Info("sem app de bandeja nem caixa de dialogo do sistema; pedido de acesso recusado", "usuario", t.User)
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
