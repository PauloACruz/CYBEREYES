//go:build darwin

package remote

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

// findDesktop usa o dono do /dev/console: o usuario com a sessao grafica na frente. Na janela de login (dono root)
// nao ha sessao de usuario para capturar na v1.
func findDesktop(bool) (target, error) {
	st, err := os.Stat("/dev/console")
	if err != nil {
		return target{}, errNoSession
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok || sys.Uid == 0 {
		return target{}, errNoSession
	}
	u, err := user.LookupId(strconv.FormatUint(uint64(sys.Uid), 10))
	if err != nil {
		return target{}, errNoSession
	}
	return target{User: u.Username, Session: sys.Uid}, nil
}

// launchHelper roda o remote-helper como o usuario, no contexto da sessao grafica dele (launchctl asuser): as
// permissoes de Gravacao de Tela e Acessibilidade sao concedidas ao EYES nesse usuario.
func launchHelper(ctx context.Context, t target, p HelperParams, control <-chan Control, log *slog.Logger) error {
	exe, err := Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command("/bin/launchctl", "asuser", strconv.FormatUint(uint64(t.Session), 10), "/usr/bin/sudo", "-u", t.User, "-H", exe, "remote-helper")
	if os.Geteuid() != 0 {
		// Execucao em primeiro plano (testes): ja estamos na sessao do usuario.
		cmd = exec.Command(exe, "remote-helper")
	}
	return runHelperProcess(ctx, cmd, p, control, func(line string) { log.Info("remote-helper", "linha", line) })
}
