//go:build linux

package rdp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

func grdctl() (string, error) {
	if p, err := exec.LookPath("grdctl"); err == nil {
		return p, nil
	}
	for _, p := range []string{"/usr/bin/grdctl", "/usr/libexec/grdctl"} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("gnome-remote-desktop nao instalado nesta maquina (pacote gnome-remote-desktop)")
}

// asUser executa um comando na sessao do usuario conectado (DBus e XDG_RUNTIME_DIR da sessao).
func asUser(ctx context.Context, path string, args ...string) (string, error) {
	r := execx.Run(ctx, execx.Spec{Path: path, Args: args, AsUser: true, Timeout: 30 * time.Second})
	out := strings.TrimSpace(r.Stdout + "\n" + r.Stderr)
	if r.Err != nil {
		return out, r.Err
	}
	if r.ExitCode != 0 {
		return out, fmt.Errorf("%s %s: codigo %d: %s", filepath.Base(path), strings.Join(args, " "), r.ExitCode, out)
	}
	return out, nil
}

func enable(ctx context.Context, viewOnly bool) (Access, error) {
	grd, err := grdctl()
	if err != nil {
		return Access{}, err
	}
	name, err := execx.ConsoleUser()
	if err != nil {
		return Access{}, errors.New("nenhum usuario com sessao grafica: o compartilhamento RDP precisa de alguem logado")
	}
	u, err := user.Lookup(name)
	if err != nil {
		return Access{}, err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)

	// Certificado proprio na pasta do gnome-remote-desktop do usuario (gerado uma vez).
	dir := filepath.Join(u.HomeDir, ".local", "share", "gnome-remote-desktop")
	certPath, keyPath := filepath.Join(dir, "eyes-tls.crt"), filepath.Join(dir, "eyes-tls.key")
	if _, err := os.Stat(certPath); err != nil {
		host, _ := os.Hostname()
		cert, key, err := selfSigned(host)
		if err != nil {
			return Access{}, err
		}
		for _, d := range []string{filepath.Join(u.HomeDir, ".local"), filepath.Join(u.HomeDir, ".local", "share"), dir} {
			if _, err := os.Stat(d); err != nil {
				if err := os.Mkdir(d, 0o700); err != nil {
					return Access{}, err
				}
				_ = os.Chown(d, uid, gid)
			}
		}
		if err := os.WriteFile(certPath, cert, 0o600); err != nil {
			return Access{}, err
		}
		if err := os.WriteFile(keyPath, key, 0o600); err != nil {
			return Access{}, err
		}
		_ = os.Chown(certPath, uid, gid)
		_ = os.Chown(keyPath, uid, gid)
	}

	password := newPassword(16)
	viewMode := "disable-view-only"
	if viewOnly {
		viewMode = "enable-view-only"
	}
	steps := [][]string{
		{"rdp", "set-tls-key", keyPath},
		{"rdp", "set-tls-cert", certPath},
		{"rdp", "set-auth-methods", "credentials"},
		{"rdp", "set-credentials", Username, password},
		{"rdp", viewMode},
		{"rdp", "enable"},
	}
	for _, s := range steps {
		if out, err := asUser(ctx, grd, s...); err != nil {
			return Access{}, fmt.Errorf("configuracao do gnome-remote-desktop falhou: %v (%s)", err, out)
		}
	}
	// Inicia (ou reinicia) o servico do usuario para aplicar credencial e certificado novos. Sem "enable": o servico
	// so roda durante a sessao e nao volta sozinho no proximo login.
	if _, err := asUser(ctx, "systemctl", "--user", "restart", ServiceUnit); err != nil {
		return Access{}, fmt.Errorf("falha ao iniciar o gnome-remote-desktop do usuario: %w", err)
	}
	time.Sleep(2 * time.Second)
	status, _ := asUser(ctx, grd, "status")
	return Access{Port: parsePort(status), Username: Username, Password: password, User: name}, nil
}

func disable(ctx context.Context) error {
	grd, err := grdctl()
	if err != nil {
		return err
	}
	var first error
	for _, step := range disableSteps() {
		path := step[0]
		if path == "grdctl" {
			path = grd
		}
		// Segue mesmo com falha (servico ja parado, sem credencial): o objetivo e nao sobrar nada ligado.
		if _, err := asUser(ctx, path, step[1:]...); err != nil && first == nil && step[0] == "grdctl" && step[2] == "disable" {
			first = err
		}
	}
	return first
}

// cleanupAtStart desliga, uma vez por partida do EYES, o RDP que tenha ficado ligado. So age onde o EYES ja usou o
// RDP (certificado proprio na pasta do usuario) e espera alguem logado, porque o servico e da sessao do usuario.
func cleanupAtStart(ctx context.Context, e *env.Env) {
	for wait := 20 * time.Second; ; wait = 5 * time.Minute {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if active.Load() > 0 {
			return // um tecnico ja abriu sessao; o fim dela desliga o RDP
		}
		if _, err := grdctl(); err != nil {
			return
		}
		name, err := execx.ConsoleUser()
		if err != nil {
			continue
		}
		u, err := user.Lookup(name)
		if err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(u.HomeDir, ".local", "share", "gnome-remote-desktop", "eyes-tls.crt")); err != nil {
			return // o EYES nunca ligou o RDP nesta maquina
		}
		if active.Load() > 0 {
			return
		}
		if err := disable(ctx); err != nil {
			e.Log.Warn("RDP: falha ao desligar o compartilhamento que ficou ligado", "erro", err)
			continue
		}
		e.Log.Info("RDP do GNOME desligado na partida (so liga durante o acesso remoto)", "usuario", name)
		return
	}
}
