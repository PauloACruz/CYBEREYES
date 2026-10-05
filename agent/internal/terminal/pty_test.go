//go:build linux || darwin

package terminal

import (
	"strings"
	"testing"
	"time"
)

// Sessoes reais num PTY com /bin/sh.

func TestPTY_EchoResizeAndExit(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.Resize(sid, 100, 30) // antes do start, como pode acontecer no despacho paralelo
	m.Start(sid, "/bin/sh")
	if m.Count() != 1 {
		t.Fatal("sessao nao abriu")
	}
	m.Input(sid, "echo hi\n")
	pub.waitFor(t, sid, 10*time.Second, "saida do echo", func(d decoded) bool {
		// "hi" sozinho numa linha (o eco do PTY mostra "echo hi").
		return strings.Contains(strings.ReplaceAll(string(d.output), "echo hi", ""), "hi\r\n")
	})

	m.Input(sid, "stty size\n")
	pub.waitFor(t, sid, 10*time.Second, "tamanho inicial", func(d decoded) bool { return strings.Contains(string(d.output), "30 100") })
	m.Resize(sid, 120, 40)
	m.Input(sid, "stty size\n")
	pub.waitFor(t, sid, 10*time.Second, "tamanho novo", func(d decoded) bool { return strings.Contains(string(d.output), "40 120") })

	m.Input(sid, "exit 3\n")
	d := pub.waitFor(t, sid, 10*time.Second, "fim", func(d decoded) bool { return d.done })
	if d.code != 3 {
		t.Fatalf("exit_code %d, esperado 3", d.code)
	}
	if d.extra != 0 {
		t.Fatalf("%d quadros depois do fim", d.extra)
	}
	if m.Count() != 0 {
		t.Fatal("sessao nao removida")
	}
}

func TestPTY_KillEndsSessionWithChildren(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.Start(sid, "/bin/sh")
	m.Input(sid, "sleep 300\n")
	time.Sleep(300 * time.Millisecond)
	start := time.Now()
	m.Kill(sid)
	d := pub.waitFor(t, sid, 10*time.Second, "fim depois do kill", func(d decoded) bool { return d.done })
	if d.code == 0 {
		t.Fatalf("exit_code 0 depois do kill")
	}
	if time.Since(start) > 8*time.Second {
		t.Fatalf("kill demorou %s", time.Since(start))
	}
	if m.Count() != 0 {
		t.Fatal("sessao nao removida")
	}
}

func TestPTY_EnvAndUTF8(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.Start(sid, "/bin/sh")
	m.Input(sid, "echo \"T=$TERM\"; printf 'a\\303\\247\\303\\243o\\n'\n")
	pub.waitFor(t, sid, 10*time.Second, "TERM e UTF-8", func(d decoded) bool {
		s := string(d.output)
		return strings.Contains(s, "T=xterm-256color") && strings.Contains(s, "ação")
	})
	m.Kill(sid)
	pub.waitFor(t, sid, 10*time.Second, "fim", func(d decoded) bool { return d.done })
}

func TestPTY_UnsupportedShell(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.Start(sid, "/usr/bin/python3")
	d := pub.waitFor(t, sid, time.Second, "recusa", func(d decoded) bool { return d.done })
	if d.code != 1 || !strings.Contains(string(d.output), "nao suportado") {
		t.Fatalf("recusa inesperada: %+v", d)
	}
}
