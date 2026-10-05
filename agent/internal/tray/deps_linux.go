//go:build linux

package tray

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// hasGraphicalEnvironment: gerenciador de login configurado ou sessoes X11/Wayland instaladas
// (mesmo criterio do script de instalacao para cadastrar a maquina como estacao).
func hasGraphicalEnvironment() bool {
	if exists("/etc/systemd/system/display-manager.service") {
		return true
	}
	for _, dir := range []string{"/usr/share/xsessions", "/usr/share/wayland-sessions"} {
		if m, _ := filepath.Glob(filepath.Join(dir, "*.desktop")); len(m) > 0 {
			return true
		}
	}
	return false
}

// errMissingLibraries indica que o carregador recusou o app por falta de bibliotecas do sistema.
var errMissingLibraries = errors.New("bibliotecas do sistema ausentes")

// checkLibraries roda "eyes-tray --version", que sai antes de abrir a interface. Sem GTK 3 e
// WebKitGTK 4.1, o carregador do Linux recusa o binario com "error while loading shared libraries".
// Roda como nobody: o carregador e as bibliotecas graficas nao precisam de root para isso.
func checkLibraries(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, trayPath(), "--version")
	cmd.Dir = "/"
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 65534, Gid: 65534}}
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	msg := strings.TrimSpace(string(out))
	if strings.Contains(msg, "error while loading shared libraries") {
		return fmt.Errorf("%w: %s", errMissingLibraries, msg)
	}
	return fmt.Errorf("%v: %s", err, msg)
}

// libraryInstallers instala a WebKitGTK 4.1 (que traz o GTK 3) pelo gerenciador de pacotes da distribuicao.
// Pacotes conferidos no Ubuntu 22.04 e 24.04, Debian 12, Fedora, openSUSE Leap 15.6 e Arch.
// Cada tentativa e uma lista de comandos; a primeira tentativa que funcionar encerra a instalacao.
var libraryInstallers = []struct {
	tool     string
	env      []string
	attempts [][][]string
}{
	{"apt-get", []string{"DEBIAN_FRONTEND=noninteractive"}, [][][]string{
		{{"apt-get", "install", "-y", "--no-install-recommends", "-o", "DPkg::Lock::Timeout=300", "libwebkit2gtk-4.1-0"}},
		// Lista de pacotes antiga ou vazia: atualiza e tenta de novo.
		{
			{"apt-get", "update", "-o", "DPkg::Lock::Timeout=300"},
			{"apt-get", "install", "-y", "--no-install-recommends", "-o", "DPkg::Lock::Timeout=300", "libwebkit2gtk-4.1-0"},
		},
	}},
	{"dnf", nil, [][][]string{{{"dnf", "install", "-y", "webkit2gtk4.1"}}}},
	{"zypper", nil, [][][]string{{{"zypper", "--non-interactive", "install", "--no-recommends", "libwebkit2gtk-4_1-0"}}}},
	{"pacman", nil, [][][]string{{{"pacman", "-S", "--noconfirm", "--needed", "webkit2gtk-4.1"}}}},
}

// installLibraries usa o primeiro gerenciador de pacotes encontrado.
func installLibraries(ctx context.Context) error {
	for _, inst := range libraryInstallers {
		if _, err := exec.LookPath(inst.tool); err != nil {
			continue
		}
		var last error
		for _, attempt := range inst.attempts {
			if last = runAll(ctx, inst.env, attempt); last == nil {
				return nil
			}
		}
		return last
	}
	return errors.New("gerenciador de pacotes nao suportado (apt-get, dnf, zypper ou pacman)")
}

func runAll(ctx context.Context, env []string, cmds [][]string) error {
	for _, c := range cmds {
		path, err := exec.LookPath(c[0])
		if err != nil {
			return err
		}
		r := execx.Run(ctx, execx.Spec{Path: path, Args: c[1:], Env: env, Timeout: 10 * time.Minute})
		if r.Err != nil || r.ExitCode != 0 {
			return fmt.Errorf("%s: codigo %d: %s", strings.Join(c, " "), r.ExitCode, tail(r.Combined(), 400))
		}
	}
	return nil
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return "..." + strings.ToValidUTF8(s[len(s)-n:], "")
	}
	return s
}
