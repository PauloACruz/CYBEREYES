//go:build linux

package tray

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// procRoot permite testar a leitura de processos com um /proc falso.
var procRoot = "/proc"

// session e uma sessao grafica de usuario.
type session struct {
	// ID e o id do logind, ou "uid-<uid>" quando a sessao foi achada pelos processos.
	ID  string
	UID uint32
}

// graphicalSessions lista as sessoes graficas ativas de usuarios (X11, Wayland ou Mir) pelo logind.
// Sem loginctl (sistema sem systemd), usa os processos que tem DISPLAY ou WAYLAND_DISPLAY.
func graphicalSessions(ctx context.Context) []session {
	out, err := exec.CommandContext(ctx, "loginctl", "list-sessions", "--no-legend").Output()
	if err != nil {
		return sessionsFromProc()
	}
	var list []session
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		props, err := exec.CommandContext(ctx, "loginctl", "show-session", f[0],
			"-p", "Id", "-p", "User", "-p", "Type", "-p", "Class", "-p", "Active", "-p", "State").Output()
		if err != nil {
			continue
		}
		if s, ok := parseSession(string(props)); ok {
			list = append(list, s)
		}
	}
	return list
}

// parseSession interpreta a saida de "loginctl show-session" (chave=valor) e aceita so sessoes
// graficas ativas de usuarios comuns (a tela de login tem a classe greeter).
func parseSession(out string) (session, bool) {
	p := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			p[k] = v
		}
	}
	uid, err := strconv.ParseUint(p["User"], 10, 32)
	if err != nil || uid == 0 || p["Id"] == "" {
		return session{}, false
	}
	switch p["Type"] {
	case "x11", "wayland", "mir":
	default:
		return session{}, false
	}
	if p["Class"] != "user" || p["Active"] != "yes" || p["State"] == "closing" {
		return session{}, false
	}
	return session{ID: p["Id"], UID: uint32(uid)}, true
}

// localDisplay diz se o processo usa uma tela local: Wayland ou X11 ":N"/"unix:N". Tela X11 de outra
// maquina (por exemplo "localhost:10.0", do X11 encaminhado pelo SSH) nao e sessao grafica da estacao.
func localDisplay(env map[string]string) bool {
	if env["WAYLAND_DISPLAY"] != "" {
		return true
	}
	d := env["DISPLAY"]
	return strings.HasPrefix(d, ":") || strings.HasPrefix(d, "unix:")
}

// sessionsFromProc acha usuarios comuns com processos graficos locais quando nao ha logind.
func sessionsFromProc() []session {
	seen := map[uint32]bool{}
	var list []session
	for _, p := range processes() {
		if p.uid < 1000 || p.uid == 65534 || seen[p.uid] {
			continue
		}
		if !localDisplay(readEnviron(p.pid)) {
			continue
		}
		seen[p.uid] = true
		list = append(list, session{ID: "uid-" + strconv.FormatUint(uint64(p.uid), 10), UID: p.uid})
	}
	return list
}

type proc struct {
	pid int
	uid uint32
}

// processes lista os processos com o usuario real de cada um.
func processes() []proc {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	var out []proc
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		if uid, ok := procUID(pid); ok {
			out = append(out, proc{pid: pid, uid: uid})
		}
	}
	return out
}

// procUID le o usuario real ("Uid:", primeiro campo) de /proc/<pid>/status.
func procUID(pid int) (uint32, bool) {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "status"))
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if rest, ok := strings.CutPrefix(line, "Uid:"); ok {
			if f := strings.Fields(rest); len(f) > 0 {
				n, err := strconv.ParseUint(f[0], 10, 32)
				return uint32(n), err == nil
			}
		}
	}
	return 0, false
}

func readEnviron(pid int) map[string]string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "environ"))
	if err != nil {
		return nil
	}
	env := map[string]string{}
	for _, kv := range strings.Split(string(data), "\x00") {
		if k, v, ok := strings.Cut(kv, "="); ok && k != "" {
			env[k] = v
		}
	}
	return env
}

// sessionVars sao as variaveis da sessao grafica repassadas ao app (tela, barramento D-Bus, area de trabalho e idioma).
var sessionVars = []string{
	"DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR",
	"XDG_SESSION_TYPE", "XDG_SESSION_DESKTOP", "XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS",
	"LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_NUMERIC", "LC_TIME",
}

// sessionEnv monta o ambiente do app a partir de um processo grafico do usuario: de preferencia um da
// propria sessao (XDG_SESSION_ID), com barramento D-Bus. Devolve nil enquanto a area de trabalho
// ainda nao tem processo grafico (sessao subindo).
func sessionEnv(s session) map[string]string {
	var best map[string]string
	bestScore := 0
	for _, p := range processes() {
		if p.uid != s.UID {
			continue
		}
		env := readEnviron(p.pid)
		if !localDisplay(env) {
			continue
		}
		score := 1
		if env["XDG_SESSION_ID"] == s.ID {
			score += 4
		}
		if env["DBUS_SESSION_BUS_ADDRESS"] != "" {
			score += 2
		}
		if env["XDG_CURRENT_DESKTOP"] != "" {
			score++
		}
		if score > bestScore {
			best, bestScore = env, score
		}
	}
	if best == nil {
		return nil
	}
	out := map[string]string{}
	for _, k := range sessionVars {
		if v := best[k]; v != "" {
			out[k] = v
		}
	}
	if !localDisplay(map[string]string{"DISPLAY": out["DISPLAY"]}) {
		delete(out, "DISPLAY") // sessao Wayland com DISPLAY remoto: so o Wayland
	}
	if out["XDG_RUNTIME_DIR"] == "" {
		out["XDG_RUNTIME_DIR"] = "/run/user/" + strconv.FormatUint(uint64(s.UID), 10)
	}
	if out["DBUS_SESSION_BUS_ADDRESS"] == "" {
		if bus := filepath.Join(out["XDG_RUNTIME_DIR"], "bus"); exists(bus) {
			out["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=" + bus
		}
	}
	return out
}

// trayProcesses devolve os processos do app: current roda o binario atual; stale roda um binario
// substituido ou apagado (o kernel mostra " (deleted)" no link do executavel).
func trayProcesses(path string) (current, stale []proc) {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		exe, err := os.Readlink(filepath.Join(procRoot, e.Name(), "exe"))
		if err != nil || (exe != path && exe != path+" (deleted)") {
			continue
		}
		uid, ok := procUID(pid)
		if !ok {
			continue
		}
		if exe == path {
			current = append(current, proc{pid: pid, uid: uid})
		} else {
			stale = append(stale, proc{pid: pid, uid: uid})
		}
	}
	return current, stale
}

func signalAll(list []proc, sig syscall.Signal) {
	for _, p := range list {
		_ = syscall.Kill(p.pid, sig)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
