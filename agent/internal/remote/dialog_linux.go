//go:build linux

package remote

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"time"
)

// asUser monta o comando na sessao grafica do usuario: como root, troca para ele com o DISPLAY da sessao.
func asUser(ctx context.Context, t target, name string, args ...string) *exec.Cmd {
	if os.Geteuid() != 0 || t.User == "" {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = append(os.Environ(), t.Env...)
		return cmd
	}
	full := append([]string{"-u", t.User, "--", "env"}, t.Env...)
	full = append(full, name)
	full = append(full, args...)
	return exec.CommandContext(ctx, "runuser", full...)
}

// systemAsk pergunta pelo zenity ou pelo kdialog. Devolve errNoDialog quando nenhum dos dois existe.
func systemAsk(ctx context.Context, t target, technician string, timeout time.Duration) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout+5*time.Second)
	defer cancel()
	text := consentText(technician, true)
	var cmd *exec.Cmd
	switch {
	case lookPath("zenity"):
		cmd = asUser(ctx, t, "zenity", "--question", "--title=Acesso remoto", "--text="+text, "--ok-label=Permitir",
			"--cancel-label=Recusar", "--timeout="+strconv.Itoa(int(timeout.Seconds())))
	case lookPath("kdialog"):
		cmd = asUser(ctx, t, "kdialog", "--title", "Acesso remoto", "--yes-label", "Permitir", "--no-label", "Recusar", "--yesno", text)
	default:
		return false, errNoDialog
	}
	err := cmd.Run()
	if err == nil {
		return true, nil
	}
	var exit *exec.ExitError
	switch {
	case ctx.Err() != nil, errors.As(err, &exit) && exit.ExitCode() == 5:
		// zenity sai com 5 quando o tempo acaba.
		return false, errAskTimeout
	case errors.As(err, &exit):
		return false, nil
	}
	return false, err
}

// systemNotify mostra a notificacao do sistema (notify-send).
func systemNotify(ctx context.Context, t target, technician string) error {
	if !lookPath("notify-send") {
		return errNoDialog
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return asUser(ctx, t, "notify-send", "--app-name=EYES", "Acesso remoto", consentText(technician, false)).Run()
}

func lookPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
