//go:build linux

package remote

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// findDesktop acha a sessao X11 do usuario: o DISPLAY do proprio EYES (execucao em primeiro plano, testes) ou o
// de algum processo de usuario em /proc. Sessoes so Wayland respondem errWayland (RFC-001, D-06) junto com o alvo
// da sessao Wayland (usuario, DBus e Wayland), que o canal rdp usa para o aviso e o pedido de acesso.
func findDesktop(allowLogin bool) (target, error) {
	if d := os.Getenv("DISPLAY"); d != "" && os.Getenv("XDG_SESSION_TYPE") != "wayland" {
		return target{Env: []string{"DISPLAY=" + d, "XAUTHORITY=" + os.Getenv("XAUTHORITY")}}, nil
	}
	procs, _ := filepath.Glob("/proc/[0-9]*/environ")
	var wayland *target
	var fallback *target
	for _, p := range procs {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		vars := parseEnviron(data)
		if vars["XDG_SESSION_TYPE"] == "wayland" || (vars["WAYLAND_DISPLAY"] != "" && vars["DISPLAY"] == "") {
			// Xwayland so mostra as janelas X: a tela inteira do usuario nao aparece.
			if wayland == nil && (vars["WAYLAND_DISPLAY"] != "" || vars["DISPLAY"] != "") {
				if uid, owner := procOwner(filepath.Dir(p)); uid != 0 {
					t := target{User: owner}
					for _, k := range []string{"WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "XAUTHORITY"} {
						if v := vars[k]; v != "" {
							t.Env = append(t.Env, k+"="+v)
						}
					}
					wayland = &t
				}
			}
			continue
		}
		display := vars["DISPLAY"]
		if display == "" {
			continue
		}
		uid, owner := procOwner(filepath.Dir(p))
		xauth := vars["XAUTHORITY"]
		if xauth == "" {
			if u, err := user.LookupId(strconv.Itoa(uid)); err == nil {
				xauth = filepath.Join(u.HomeDir, ".Xauthority")
			}
		}
		t := target{Env: []string{"DISPLAY=" + display, "XAUTHORITY=" + xauth}, User: owner}
		if uid != 0 {
			return t, nil
		}
		if fallback == nil {
			fallback = &t
		}
	}
	if fallback != nil && allowLogin {
		// Tela de login (gerenciador de exibicao rodando como root).
		return *fallback, nil
	}
	if wayland != nil {
		return *wayland, errWayland
	}
	return target{}, errNoSession
}

func parseEnviron(data []byte) map[string]string {
	out := map[string]string{}
	for _, kv := range bytes.Split(data, []byte{0}) {
		if i := bytes.IndexByte(kv, '='); i > 0 {
			out[string(kv[:i])] = string(kv[i+1:])
		}
	}
	return out
}

func procOwner(dir string) (int, string) {
	st, err := os.Stat(dir)
	if err != nil {
		return 0, ""
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, ""
	}
	name := strconv.Itoa(int(sys.Uid))
	if u, err := user.LookupId(name); err == nil {
		name = u.Username
	}
	return int(sys.Uid), name
}

// launchHelper roda o remote-helper como root com o DISPLAY e o XAUTHORITY da sessao do usuario.
func launchHelper(ctx context.Context, t target, p HelperParams, control <-chan Control, log *slog.Logger) error {
	exe, err := Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "remote-helper")
	cmd.Env = append(filterEnv(os.Environ(), "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE"), t.Env...)
	return runHelperProcess(ctx, cmd, p, control, func(line string) { log.Info("remote-helper", "linha", line) })
}

func filterEnv(in []string, drop ...string) []string {
	out := in[:0:0]
	for _, kv := range in {
		keep := true
		for _, d := range drop {
			if strings.HasPrefix(kv, d+"=") {
				keep = false
				break
			}
		}
		if keep {
			out = append(out, kv)
		}
	}
	return out
}
