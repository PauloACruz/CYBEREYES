package main

import (
	"errors"

	"github.com/pauloacruz/cybereyes/agent/tray/internal/ipc"
)

// eventRemote leva ao frontend os eventos do acesso remoto (aviso, pedido de aceite e fim).
const eventRemote = "tray:remote"

// onRemote recebe os eventos do agente: mostra a janela no pedido de aceite e avisa por notificacao no inicio do acesso.
func (s *TrayService) onRemote(ev ipc.RemoteEvent) {
	s.emit(eventRemote, ev)
	switch ev.Event {
	case "remote-ask":
		s.showWindow()
	case "remote-notify":
		who := ev.Technician
		if who == "" {
			who = "Um técnico"
		}
		s.notifier.notify("remote-"+ev.Session, who+" está acessando este computador", "Abra o EYES para encerrar o acesso.", 0)
		s.showWindow()
	}
}

func (s *TrayService) showWindow() {
	if s.window == nil {
		return
	}
	s.window.Show()
	s.window.Restore()
	s.window.Focus()
}

// RemoteAnswer responde ao pedido de acesso remoto.
func (s *TrayService) RemoteAnswer(session string, accept bool) error {
	return s.remoteErr(s.remote.Answer(session, accept))
}

// RemoteEnd encerra o acesso remoto em andamento.
func (s *TrayService) RemoteEnd(session string) error {
	return s.remoteErr(s.remote.End(session))
}

func (s *TrayService) remoteErr(err error) error {
	if errors.Is(err, ipc.ErrNotConnected) {
		return errors.New(msgUnavailable)
	}
	return err
}
