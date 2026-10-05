//go:build !windows

package actions

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// powerCommands lista as tentativas em ordem para o sistema.
func powerCommands(goos string, reboot bool) [][]string {
	if goos == "darwin" {
		if reboot {
			return [][]string{{"shutdown", "-r", "now"}, {"reboot"}}
		}
		return [][]string{{"shutdown", "-h", "now"}, {"halt"}}
	}
	if reboot {
		return [][]string{{"shutdown", "-r", "+0"}, {"systemctl", "reboot"}, {"reboot"}}
	}
	return [][]string{{"shutdown", "-h", "+0"}, {"systemctl", "poweroff"}, {"poweroff"}}
}

// powerCheck confere, antes de responder, que existe algum comando de desligamento.
func powerCheck() error {
	for _, c := range powerCommands(runtime.GOOS, true) {
		if _, err := exec.LookPath(c[0]); err == nil {
			return nil
		}
	}
	return errors.New("nenhum comando de desligamento encontrado (shutdown, systemctl, reboot)")
}

func powerAction(reboot bool) error {
	var errs []string
	for _, c := range powerCommands(runtime.GOOS, reboot) {
		path, err := exec.LookPath(c[0])
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		out, err := exec.CommandContext(ctx, path, c[1:]...).CombinedOutput()
		cancel()
		if err == nil {
			return nil
		}
		errs = append(errs, fmt.Sprintf("%s: %v %s", strings.Join(c, " "), err, strings.TrimSpace(string(out))))
	}
	if len(errs) == 0 {
		return errors.New("nenhum comando de desligamento encontrado")
	}
	return errors.New(strings.Join(errs, "; "))
}
