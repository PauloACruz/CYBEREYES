package terminal

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/bus"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// fakePub guarda os quadros publicados ja codificados, como iriam para o NATS.
type fakePub struct {
	mu     sync.Mutex
	frames map[string][][]byte
	notify chan struct{}
}

func newFakePub() *fakePub {
	return &fakePub{frames: map[string][][]byte{}, notify: make(chan struct{}, 1)}
}

func (p *fakePub) Publish(suffix string, body any) error {
	data, err := bus.Encode(body)
	if err != nil {
		return err
	}
	p.mu.Lock()
	p.frames[suffix] = append(p.frames[suffix], data)
	p.mu.Unlock()
	select {
	case p.notify <- struct{}{}:
	default:
	}
	return nil
}

// decoded le os quadros como o servidor (TerminalSessions.Decode): bin = saida; mapa = fim.
type decoded struct {
	output []byte
	frames int
	done   bool
	code   int
	extra  int // quadros depois do fim
	big    int // maior quadro de saida
}

func (p *fakePub) decode(t *testing.T, id string) decoded {
	t.Helper()
	p.mu.Lock()
	frames := append([][]byte(nil), p.frames["terminal."+id]...)
	p.mu.Unlock()
	var d decoded
	for _, f := range frames {
		if d.done {
			d.extra++
			continue
		}
		switch {
		case f[0] == 0xc4 || f[0] == 0xc5 || f[0] == 0xc6: // bin8/16/32
			var b []byte
			if err := msgpack.Unmarshal(f, &b); err != nil {
				t.Fatalf("quadro bin invalido: %v", err)
			}
			d.output = append(d.output, b...)
			d.frames++
			d.big = max(d.big, len(b))
		case f[0]&0xf0 == 0x80 || f[0] == 0xde: // mapa
			var m map[string]any
			if err := msgpack.Unmarshal(f, &m); err != nil {
				t.Fatalf("mapa invalido: %v", err)
			}
			if _, ok := m["output"]; ok {
				t.Errorf("mapa de fim nao deve ter output: %v", m)
			}
			done, _ := m["done"].(bool)
			d.done = done
			d.code = int(toInt64(m["exit_code"]))
		default:
			t.Fatalf("tipo de quadro inesperado: 0x%x", f[0])
		}
	}
	return d
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case int8:
		return int64(x)
	case int16:
		return int64(x)
	case int32:
		return int64(x)
	case int64:
		return x
	case uint8:
		return int64(x)
	case uint16:
		return int64(x)
	case uint32:
		return int64(x)
	case uint64:
		return int64(x)
	}
	return -999
}

// waitFor espera ate cond ser verdadeira com os quadros atuais.
func (p *fakePub) waitFor(t *testing.T, id string, timeout time.Duration, what string, cond func(decoded) bool) decoded {
	t.Helper()
	deadline := time.After(timeout)
	for {
		d := p.decode(t, id)
		if cond(d) {
			return d
		}
		select {
		case <-p.notify:
		case <-time.After(50 * time.Millisecond):
		case <-deadline:
			t.Fatalf("tempo esgotado esperando %s; saida ate agora: %q (done=%v)", what, d.output, d.done)
		}
	}
}

func newTestManager(pub *fakePub) *Manager {
	m := NewManager(pub, slog.New(slog.NewTextHandler(io.Discard, nil)))
	m.FlushInterval = 5 * time.Millisecond
	return m
}

const sid = "0123456789abcdef0123456789abcdef"

// fakeConsole simula um shell: entrega a saida programada e termina com o codigo dado.
type fakeConsole struct {
	out     chan []byte
	pending []byte
	exit    chan int
	once    sync.Once
	closed  chan struct{}
	mu      sync.Mutex
	input   bytes.Buffer
	size    [2]int
}

func newFakeConsole() *fakeConsole {
	return &fakeConsole{out: make(chan []byte, 1024), exit: make(chan int, 1), closed: make(chan struct{})}
}

func (f *fakeConsole) Read(p []byte) (int, error) {
	if len(f.pending) == 0 {
		select {
		case b, ok := <-f.out:
			if !ok {
				return 0, io.EOF
			}
			f.pending = b
		case <-f.closed:
			return 0, io.EOF
		}
	}
	n := copy(p, f.pending)
	f.pending = f.pending[n:]
	return n, nil
}

func (f *fakeConsole) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.input.Write(p)
}

func (f *fakeConsole) Resize(c, r int) error {
	f.mu.Lock()
	f.size = [2]int{c, r}
	f.mu.Unlock()
	return nil
}

func (f *fakeConsole) Kill() {
	select {
	case f.exit <- 137:
	default:
	}
}
func (f *fakeConsole) Wait() int      { return <-f.exit }
func (f *fakeConsole) CloseOutput()   { f.once.Do(func() { close(f.closed) }) }
func (f *fakeConsole) Close()         { f.CloseOutput() }
func (f *fakeConsole) inputs() string { f.mu.Lock(); defer f.mu.Unlock(); return f.input.String() }

func TestBatching_PreservesOrderAndFrameLimit(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.MaxFrame = 4096
	fc := newFakeConsole()
	m.start = func(string, int, int) (console, error) { return fc, nil }

	var want []byte
	for i := 0; i < 300; i++ {
		chunk := bytes.Repeat([]byte{byte(i)}, 1000+i)
		want = append(want, chunk...)
		fc.out <- chunk
	}
	m.Start(sid, "")
	// Espera toda a saida antes de terminar o "shell".
	pub.waitFor(t, sid, 10*time.Second, "saida completa", func(d decoded) bool { return len(d.output) == len(want) })
	fc.exit <- 5
	d := pub.waitFor(t, sid, 10*time.Second, "fim", func(d decoded) bool { return d.done })
	if !bytes.Equal(d.output, want) {
		t.Fatalf("saida fora de ordem ou incompleta: %d bytes, esperado %d", len(d.output), len(want))
	}
	if d.big > m.MaxFrame {
		t.Fatalf("quadro de %d bytes passou do limite %d", d.big, m.MaxFrame)
	}
	if d.frames < len(want)/m.MaxFrame {
		t.Fatalf("poucos quadros: %d", d.frames)
	}
	if d.code != 5 || d.extra != 0 {
		t.Fatalf("fim: code=%d extra=%d", d.code, d.extra)
	}
	if m.Count() != 0 {
		t.Fatalf("sessao nao foi removida")
	}
}

func TestHandlers_ParsePayloadAndResizeBeforeStart(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	fc := newFakeConsole()
	var gotCols, gotRows int
	m.start = func(_ string, c, r int) (console, error) { gotCols, gotRows = c, r; return fc, nil }
	reg := rpc.NewRegistry(slog.New(slog.NewTextHandler(io.Discard, nil)))
	m.register(reg)
	ctx := context.Background()

	// O resize inicial pode chegar antes do start (comandos despachados em paralelo).
	reg.Dispatch(ctx, rpc.Request{"func": "terminal_resize", "payload": map[string]any{"session_id": sid, "cols": "132", "rows": "43"}})
	reg.Dispatch(ctx, rpc.Request{"func": "terminal_start", "payload": map[string]any{"session_id": sid, "shell": "/bin/bash"}, "run_as_user": false})
	if gotCols != 132 || gotRows != 43 {
		t.Fatalf("tamanho inicial %dx%d, esperado 132x43", gotCols, gotRows)
	}
	reg.Dispatch(ctx, rpc.Request{"func": "terminal_resize", "payload": map[string]any{"session_id": sid, "cols": "90", "rows": "30"}})
	fc.mu.Lock()
	size := fc.size
	fc.mu.Unlock()
	if size != [2]int{90, 30} {
		t.Fatalf("resize nao aplicado: %v", size)
	}
	reg.Dispatch(ctx, rpc.Request{"func": "terminal_input", "payload": map[string]any{"session_id": sid, "data": "ls\r"}})
	deadline := time.Now().Add(5 * time.Second)
	for fc.inputs() != "ls\r" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if fc.inputs() != "ls\r" {
		t.Fatalf("entrada nao chegou: %q", fc.inputs())
	}
	reg.Dispatch(ctx, rpc.Request{"func": "terminal_kill", "payload": map[string]any{"session_id": sid}})
	d := pub.waitFor(t, sid, 10*time.Second, "fim", func(d decoded) bool { return d.done })
	if d.code != 137 {
		t.Fatalf("exit_code %d", d.code)
	}
}

func TestKillBeforeStart_DoesNotOpenShell(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	opened := false
	m.start = func(string, int, int) (console, error) { opened = true; return newFakeConsole(), nil }
	m.Kill(sid)
	m.Start(sid, "")
	if opened || m.Count() != 0 {
		t.Fatal("shell aberto depois de terminal_kill")
	}
}

func TestStartFailure_PublishesEnd(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.start = func(string, int, int) (console, error) { return nil, errors.New("sem pty") }
	m.Start(sid, "")
	d := pub.waitFor(t, sid, time.Second, "fim", func(d decoded) bool { return d.done })
	if d.code != 1 || !strings.Contains(string(d.output), "sem pty") {
		t.Fatalf("fim inesperado: %+v", d)
	}
	if m.Count() != 0 {
		t.Fatal("sessao ficou registrada")
	}
}

func TestSessionLimit(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.MaxSessions = 1
	fc := newFakeConsole()
	m.start = func(string, int, int) (console, error) { return fc, nil }
	m.Start(sid, "")
	other := "ffffffffffffffffffffffffffffffff"
	m.Start(other, "")
	d := pub.waitFor(t, other, time.Second, "recusa", func(d decoded) bool { return d.done })
	if d.code != 1 || !strings.Contains(string(d.output), "limite") {
		t.Fatalf("recusa inesperada: %+v", d)
	}
	m.Kill(sid)
	pub.waitFor(t, sid, 5*time.Second, "fim", func(d decoded) bool { return d.done })
}

func TestInvalidSessionID(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.start = func(string, int, int) (console, error) { t.Fatal("nao deveria abrir"); return nil, nil }
	m.Start("a.b", "")
	m.Start("", "")
	m.Start("x>", "")
	if len(pub.frames) != 0 {
		t.Fatalf("publicou para id invalido: %v", pub.frames)
	}
}

func TestIdleTimeout_EndsWithNote(t *testing.T) {
	pub := newFakePub()
	m := newTestManager(pub)
	m.IdleTimeout = 150 * time.Millisecond
	fc := newFakeConsole()
	m.start = func(string, int, int) (console, error) { return fc, nil }
	m.Start(sid, "")
	d := pub.waitFor(t, sid, 5*time.Second, "fim por inatividade", func(d decoded) bool { return d.done })
	if !strings.Contains(string(d.output), "inatividade") {
		t.Fatalf("sem aviso de inatividade: %q", d.output)
	}
}
