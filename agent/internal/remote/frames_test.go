package remote

import (
	"image"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/capture"
)

func TestWindowCoversRoundTrip(t *testing.T) {
	now := time.Now()
	f := newFlowControl()
	interval := time.Second / 15
	if got := f.window(interval, now); got != int(300*time.Millisecond/interval)+2 {
		t.Fatalf("sem medicao a janela usa 300 ms: %d", got)
	}
	f.rtt.add(0.4, now)
	if got := f.window(interval, now); got != 8 {
		t.Fatalf("400 ms a 15 q/s: janela %d, esperado 8", got)
	}
	f.rtt.add(0.01, now)
	if got := f.window(interval, now); got != minWindowFrames {
		t.Fatalf("rede local: janela %d", got)
	}
	g := newFlowControl()
	g.rtt.add(5, now)
	if got := g.window(interval, now); got != maxWindowFrames {
		t.Fatalf("limite superior: %d", got)
	}
}

func TestWindowedFilterKeepsRecentExtreme(t *testing.T) {
	t0 := time.Now()
	w := windowed{span: time.Second, keepMax: true}
	w.add(10, t0)
	w.add(50, t0.Add(100*time.Millisecond))
	w.add(20, t0.Add(1500*time.Millisecond))
	if v, _ := w.get(t0.Add(2 * time.Second)); v != 50 {
		t.Fatalf("maximo recente: %v", v)
	}
	// Depois de 4 baldes o 50 expira.
	if v, _ := w.get(t0.Add(4200 * time.Millisecond)); v != 20 {
		t.Fatalf("o maximo antigo deveria expirar: %v", v)
	}
	if _, ok := w.get(t0.Add(10 * time.Second)); ok {
		t.Fatal("sem amostras recentes nao ha valor")
	}
	m := windowed{span: time.Second}
	m.add(0.3, t0)
	m.add(0.2, t0.Add(1100*time.Millisecond))
	m.add(0.5, t0.Add(2200*time.Millisecond))
	if v, _ := m.get(t0.Add(2300 * time.Millisecond)); v != 0.2 {
		t.Fatalf("minimo recente: %v", v)
	}
}

// simulate envia quadros de size bytes a cada every, e cada um e confirmado rtt depois do envio mais o tempo de
// transmissao no enlace de bw bytes/s (fila no enlace incluida).
func simulate(f *flowControl, t0 time.Time, n, size int, every, rtt time.Duration, bw float64) time.Time {
	linkFree := t0
	type ackAt struct {
		id uint32
		at time.Time
	}
	var acks []ackAt
	now := t0
	for i := 0; i < n; i++ {
		now = t0.Add(time.Duration(i) * every)
		for len(acks) > 0 && !acks[0].at.After(now) {
			f.acked(acks[0].id, acks[0].at)
			acks = acks[1:]
		}
		f.sent(uint32(i+1), size, now)
		start := now
		if linkFree.After(start) {
			start = linkFree
		}
		linkFree = start.Add(time.Duration(float64(size) / bw * float64(time.Second)))
		acks = append(acks, ackAt{uint32(i + 1), linkFree.Add(rtt)})
	}
	for _, a := range acks {
		f.acked(a.id, a.at)
		now = a.at
	}
	return now
}

func TestByteWindowFollowsBandwidth(t *testing.T) {
	t0 := time.Now()
	f := newFlowControl()
	if got := f.byteWindow(t0); got != maxInflightBytes {
		t.Fatalf("sem medida vale o maximo: %d", got)
	}
	// Enlace de 1 MB/s com 200 ms de ida e volta, quadros de 50 KB a cada 20 ms (mais que o enlace aguenta).
	end := simulate(&f, t0, 100, 50_000, 20*time.Millisecond, 200*time.Millisecond, 1_000_000)
	bw := f.bandwidth(end)
	if bw < 800_000 || bw > 1_100_000 {
		t.Fatalf("banda estimada %.0f, esperado perto de 1 MB/s", bw)
	}
	if rtt := f.minRTT(end); rtt < 200*time.Millisecond || rtt > 260*time.Millisecond {
		t.Fatalf("ida e volta minima %v", rtt)
	}
	// Janela ~ 2 x 1 MB/s x 0,25 s.
	if got := f.byteWindow(end); got < 350_000 || got > 600_000 {
		t.Fatalf("janela de bytes %d", got)
	}
	if f.bytes != 0 || len(f.inflight) != 0 {
		t.Fatalf("tudo confirmado: %d bytes, %d quadros", f.bytes, len(f.inflight))
	}
}

func TestAckAdjustsQualityByQueueAndLimit(t *testing.T) {
	f := newFlowControl()
	t0 := time.Now()
	f.sent(1, 1000, t0)
	if d, ok := f.acked(1, t0.Add(100*time.Millisecond)); !ok || d != 5 {
		t.Fatalf("sem fila a qualidade sobe: %d %v", d, ok)
	}
	f.sent(2, 1000, t0.Add(time.Second))
	if d, _ := f.acked(2, t0.Add(1500*time.Millisecond)); d != -10 {
		t.Fatalf("fila de 400 ms deveria baixar a qualidade: %d", d)
	}
	f.limited = true
	f.sent(3, 1000, t0.Add(2*time.Second))
	if d, _ := f.acked(3, t0.Add(2100*time.Millisecond)); d != -5 {
		t.Fatalf("janela cheia deveria baixar a qualidade: %d", d)
	}
	if f.limited {
		t.Fatal("o ajuste consome o aviso de janela cheia")
	}
	f.sent(4, 1000, t0.Add(2200*time.Millisecond))
	if d, _ := f.acked(4, t0.Add(2300*time.Millisecond)); d != 0 {
		t.Fatalf("subida espera 1 s depois do ultimo ajuste: %d", d)
	}
	if _, ok := f.acked(99, t0); ok {
		t.Fatal("ACK desconhecido deve ser ignorado")
	}
}

func TestCursorUpdateSendsChangesAndShapeOnce(t *testing.T) {
	s := &desktopSession{cursorShapes: map[uint32]bool{}}
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Pix[3] = 0xff
	shape := capture.NewCursorShape(img, 1, 2)
	d := capture.Display{W: 800, H: 600}
	first, err := s.cursorUpdate(capture.Cursor{Visible: true, X: 100, Y: 50, Shape: shape}, d, 0.5)
	if err != nil || first == nil || first.PNG == nil || first.X != 50 || first.Y != 25 || first.HotX != 1 || first.HotY != 2 {
		t.Fatalf("primeiro cursor: %+v %v", first, err)
	}
	if again, _ := s.cursorUpdate(capture.Cursor{Visible: true, X: 100, Y: 50, Shape: shape}, d, 0.5); again != nil {
		t.Fatalf("cursor parado nao deve gerar mensagem: %+v", again)
	}
	moved, _ := s.cursorUpdate(capture.Cursor{Visible: true, X: 102, Y: 50, Shape: shape}, d, 0.5)
	if moved == nil || moved.PNG != nil || moved.X != 51 {
		t.Fatalf("movimento deve ir sem o PNG: %+v", moved)
	}
	hidden, _ := s.cursorUpdate(capture.Cursor{Visible: true, X: 900, Y: 5, Shape: shape}, d, 1)
	if hidden == nil || hidden.Visible {
		t.Fatalf("cursor em outro monitor fica escondido: %+v", hidden)
	}
	if again, _ := s.cursorUpdate(capture.Cursor{Visible: false, X: 9, Y: 9}, d, 1); again != nil {
		t.Fatal("cursor escondido que so mudou de posicao nao gera mensagem")
	}
}
