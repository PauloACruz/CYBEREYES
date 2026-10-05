//go:build linux

package tray

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestParseSession(t *testing.T) {
	cases := []struct {
		name string
		out  string
		ok   bool
	}{
		{"wayland ativa", "Id=3\nUser=1000\nType=wayland\nClass=user\nActive=yes\nState=active\n", true},
		{"x11 remota ativa", "Id=c2\nUser=1001\nType=x11\nClass=user\nActive=yes\nState=active\n", true},
		{"tela de login", "Id=c1\nUser=120\nType=wayland\nClass=greeter\nActive=yes\nState=active\n", false},
		{"terminal", "Id=5\nUser=1000\nType=tty\nClass=user\nActive=yes\nState=active\n", false},
		{"em segundo plano", "Id=4\nUser=1000\nType=x11\nClass=user\nActive=no\nState=online\n", false},
		{"fechando", "Id=4\nUser=1000\nType=x11\nClass=user\nActive=yes\nState=closing\n", false},
		{"root", "Id=6\nUser=0\nType=x11\nClass=user\nActive=yes\nState=active\n", false},
		{"sem id", "User=1000\nType=x11\nClass=user\nActive=yes\n", false},
	}
	for _, c := range cases {
		s, ok := parseSession(c.out)
		if ok != c.ok {
			t.Errorf("%s: ok=%v, esperado %v", c.name, ok, c.ok)
		}
		if ok && (s.ID == "" || s.UID == 0) {
			t.Errorf("%s: sessao incompleta %+v", c.name, s)
		}
	}
	if s, _ := parseSession("Id=3\nUser=1000\nType=wayland\nClass=user\nActive=yes\nState=active\n"); s != (session{ID: "3", UID: 1000}) {
		t.Errorf("sessao: %+v", s)
	}
}

// fakeProcess e um processo do /proc falso: usuario, ambiente e destino do link exe.
type fakeProcess struct {
	uid     int
	environ []string
	exe     string
}

// fakeProc monta um /proc com status, environ e o link exe de cada processo.
func fakeProc(t *testing.T, procs map[int]fakeProcess) {
	t.Helper()
	root := t.TempDir()
	for pid, p := range procs {
		dir := filepath.Join(root, strconv.Itoa(pid))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		status := "Name:\tx\nUid:\t" + strconv.Itoa(p.uid) + "\t" + strconv.Itoa(p.uid) + "\t" + strconv.Itoa(p.uid) + "\t" + strconv.Itoa(p.uid) + "\n"
		if err := os.WriteFile(filepath.Join(dir, "status"), []byte(status), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "environ"), []byte(strings.Join(p.environ, "\x00")+"\x00"), 0o644); err != nil {
			t.Fatal(err)
		}
		if p.exe != "" {
			if err := os.Symlink(p.exe, filepath.Join(dir, "exe")); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Entradas que nao sao processos sao ignoradas.
	_ = os.MkdirAll(filepath.Join(root, "sys"), 0o755)
	old := procRoot
	procRoot = root
	t.Cleanup(func() { procRoot = old })
}

func TestSessionsEnvAndTrayProcessesFromProc(t *testing.T) {
	tray := "/opt/cybereyes/eyes-tray"
	fakeProc(t, map[int]fakeProcess{
		// gnome-shell da sessao 7: ambiente completo.
		100: {1000, []string{"DISPLAY=:0", "WAYLAND_DISPLAY=wayland-0", "XDG_SESSION_ID=7", "XDG_SESSION_TYPE=wayland",
			"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus", "XDG_CURRENT_DESKTOP=ubuntu:GNOME", "LANG=pt_BR.UTF-8",
			"SEGREDO=nao-repassar"}, "/usr/bin/gnome-shell"},
		// Terminal antigo do mesmo usuario, sem barramento.
		101: {1000, []string{"DISPLAY=:1"}, "/usr/bin/bash"},
		// App de bandeja atual e um da versao substituida.
		102: {1000, []string{"DISPLAY=:0"}, tray},
		103: {1001, []string{"DISPLAY=:0"}, tray + " (deleted)"},
		200: {0, []string{"DISPLAY=:0"}, "/usr/bin/Xorg"},
		300: {1002, []string{"PATH=/usr/bin"}, "/usr/bin/sshd"},
		400: {65534, []string{"DISPLAY=:0"}, "/usr/bin/x"},
	})

	sessions := sessionsFromProc()
	if len(sessions) != 2 {
		t.Fatalf("sessoes pelo /proc: %+v (esperado uid 1000 e 1001)", sessions)
	}
	for _, s := range sessions {
		if s.UID != 1000 && s.UID != 1001 {
			t.Errorf("sessao inesperada: %+v", s)
		}
	}

	env := sessionEnv(session{ID: "7", UID: 1000})
	if env["DISPLAY"] != ":0" || env["WAYLAND_DISPLAY"] != "wayland-0" || env["XDG_CURRENT_DESKTOP"] != "ubuntu:GNOME" ||
		env["DBUS_SESSION_BUS_ADDRESS"] != "unix:path=/run/user/1000/bus" || env["LANG"] != "pt_BR.UTF-8" || env["XDG_SESSION_TYPE"] != "wayland" {
		t.Errorf("ambiente da sessao: %v", env)
	}
	if _, ok := env["SEGREDO"]; ok {
		t.Error("variavel fora da lista repassada ao app")
	}
	if env["XDG_RUNTIME_DIR"] != "/run/user/1000" {
		t.Errorf("XDG_RUNTIME_DIR padrao: %q", env["XDG_RUNTIME_DIR"])
	}
	if sessionEnv(session{ID: "9", UID: 1002}) != nil {
		t.Error("usuario sem processo grafico nao deveria ter ambiente")
	}

	current, stale := trayProcesses(tray)
	if len(current) != 1 || current[0].pid != 102 || current[0].uid != 1000 {
		t.Errorf("processos atuais: %+v", current)
	}
	if len(stale) != 1 || stale[0].pid != 103 || stale[0].uid != 1001 {
		t.Errorf("processos da versao antiga: %+v", stale)
	}
}

func TestDesktopEntry(t *testing.T) {
	d := desktopEntry()
	for _, want := range []string{"[Desktop Entry]\n", "Name=EYES\n", "Exec=" + trayPath() + "\n", "Icon=" + iconPath() + "\n",
		"StartupWMClass=eyes-tray\n", "Terminal=false\n"} {
		if !strings.Contains(d, want) {
			t.Errorf("atalho sem %q:\n%s", want, d)
		}
	}
	if strings.Contains(d, "--hidden") {
		t.Error("abrir pelo menu deve mostrar a janela (sem --hidden)")
	}
}

func TestWriteIfChanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "eyes-tray.desktop")
	if err := writeIfChanged(path, []byte("a")); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	if err := writeIfChanged(path, []byte("a")); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(path); !st.ModTime().Equal(old) {
		t.Error("arquivo igual nao deveria ser regravado")
	}
	if err := writeIfChanged(path, []byte("b")); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(path); string(data) != "b" {
		t.Errorf("conteudo: %q", data)
	}
}

func TestAllowLimitaInicios(t *testing.T) {
	s := &supervisor{launches: map[uint32][]time.Time{}}
	for i := 0; i < 5; i++ {
		if !s.allow(1000) {
			t.Fatalf("inicio %d recusado", i+1)
		}
	}
	if s.allow(1000) {
		t.Error("sexto inicio na mesma hora deveria ser recusado")
	}
	if !s.allow(1001) {
		t.Error("o limite e por usuario")
	}
	s.launches[1000] = []time.Time{time.Now().Add(-2 * time.Hour)}
	if !s.allow(1000) {
		t.Error("inicios antigos nao contam")
	}
}

func TestWaitExitEsperaOProcessoSair(t *testing.T) {
	fakeProc(t, map[int]fakeProcess{500: {1000, nil, ""}})
	go func() {
		time.Sleep(200 * time.Millisecond)
		_ = os.RemoveAll(filepath.Join(procRoot, "500"))
	}()
	start := time.Now()
	if alive := waitExit([]proc{{pid: 500, uid: 1000}, {pid: 501, uid: 1000}}, 3*time.Second); len(alive) != 0 {
		t.Errorf("processos vivos: %+v", alive)
	}
	if d := time.Since(start); d < 150*time.Millisecond || d > 2*time.Second {
		t.Errorf("espera de %s (esperado logo apos o processo sair)", d)
	}
	// Processo que nao sai dentro do limite volta na lista (o supervisor forca o encerramento).
	fakeProc(t, map[int]fakeProcess{502: {1000, nil, ""}})
	if alive := waitExit([]proc{{pid: 502, uid: 1000}}, 200*time.Millisecond); len(alive) != 1 {
		t.Errorf("processo que nao saiu deveria voltar: %+v", alive)
	}
}

func TestLocalDisplayIgnoraX11PeloSSH(t *testing.T) {
	cases := map[string]bool{":0": true, ":1.0": true, "unix:0": true, "localhost:10.0": false, "10.0.0.5:0": false, "": false}
	for d, want := range cases {
		if got := localDisplay(map[string]string{"DISPLAY": d}); got != want {
			t.Errorf("DISPLAY=%q: %v, esperado %v", d, got, want)
		}
	}
	if !localDisplay(map[string]string{"WAYLAND_DISPLAY": "wayland-0", "DISPLAY": "localhost:10.0"}) {
		t.Error("sessao Wayland e local")
	}

	fakeProc(t, map[int]fakeProcess{
		600: {1003, []string{"DISPLAY=localhost:10.0", "SSH_CONNECTION=10.0.0.9 5000 10.0.0.2 22"}, "/usr/bin/xterm"},
		601: {1004, []string{"WAYLAND_DISPLAY=wayland-0", "DISPLAY=localhost:10.0"}, "/usr/bin/gnome-shell"},
	})
	sessions := sessionsFromProc()
	if len(sessions) != 1 || sessions[0].UID != 1004 {
		t.Fatalf("sessoes: %+v (o X11 pelo SSH nao conta)", sessions)
	}
	env := sessionEnv(sessions[0])
	if env["WAYLAND_DISPLAY"] != "wayland-0" || env["DISPLAY"] != "" {
		t.Errorf("ambiente: %v (DISPLAY remoto nao deve ser repassado)", env)
	}
}
