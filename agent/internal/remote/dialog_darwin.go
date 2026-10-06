//go:build darwin

package remote

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func appleString(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}

// osascript roda o AppleScript na sessao do usuario (launchctl asuser), como o remote-helper.
func osascript(ctx context.Context, t target, script string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", script)
	if os.Geteuid() == 0 && t.User != "" {
		cmd = exec.CommandContext(ctx, "/bin/launchctl", "asuser", strconv.FormatUint(uint64(t.Session), 10), "/usr/bin/sudo", "-u", t.User,
			"/usr/bin/osascript", "-e", script)
	}
	return cmd.Output()
}

// systemAsk mostra a caixa de dialogo do macOS com Permitir e Recusar e prazo de resposta.
func systemAsk(ctx context.Context, t target, technician string, timeout time.Duration) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout+5*time.Second)
	defer cancel()
	script := "display dialog " + appleString(consentText(technician, true)) +
		` with title "Acesso remoto" buttons {"Recusar", "Permitir"} default button "Permitir" giving up after ` + strconv.Itoa(int(timeout.Seconds()))
	out, err := osascript(ctx, t, script)
	if err != nil {
		if ctx.Err() != nil {
			return false, errAskTimeout
		}
		return false, err
	}
	text := string(out)
	if strings.Contains(text, "gave up:true") {
		return false, errAskTimeout
	}
	return strings.Contains(text, "button returned:Permitir"), nil
}

// systemNotify mostra a notificacao do macOS.
func systemNotify(ctx context.Context, t target, technician string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := osascript(ctx, t, "display notification "+appleString(consentText(technician, false))+` with title "EYES"`)
	return err
}
