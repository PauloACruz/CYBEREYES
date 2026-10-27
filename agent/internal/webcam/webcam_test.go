package webcam

import (
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"
)

// fakeCamera serve os quadros programados ate o teste pedir uma falha ou fechar.
type fakeCamera struct {
	mu     sync.Mutex
	frames [][]byte
	fail   error
	closed bool
	ready  chan struct{}
}

func newFakeCamera(frames [][]byte) *fakeCamera {
	return &fakeCamera{frames: frames, ready: make(chan struct{})}
}

func (c *fakeCamera) NextFrame() ([]byte, error) {
	c.mu.Lock()
	if c.fail != nil {
		err := c.fail
		c.mu.Unlock()
		return nil, err
	}
	if len(c.frames) == 0 {
		c.mu.Unlock()
		// Bloqueia ate falha ou fechamento.
		<-c.ready
		return nil, errors.New("camera parou")
	}
	frame := c.frames[0]
	c.frames = c.frames[1:]
	c.mu.Unlock()
	return frame, nil
}

func (c *fakeCamera) Close() {
	c.mu.Lock()
	if !c.closed {
		c.closed = true
		close(c.ready)
	}
	c.mu.Unlock()
}

func (c *fakeCamera) setFail(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fail = err
	if !c.closed {
		c.closed = true
		close(c.ready)
	}
}

// fakePublisher guarda tudo que foi publicado para o teste conferir.
type fakePublisher struct {
	mu   sync.Mutex
	msgs []publishedMsg
}

type publishedMsg struct {
	suffix string
	body   any
}

func (p *fakePublisher) Publish(suffix string, body any) error {
	p.mu.Lock()
	p.msgs = append(p.msgs, publishedMsg{suffix: suffix, body: body})
	p.mu.Unlock()
	return nil
}

func (p *fakePublisher) wait(t *testing.T, cond func([]publishedMsg) bool) []publishedMsg {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		p.mu.Lock()
		msgs := append([]publishedMsg(nil), p.msgs...)
		p.mu.Unlock()
		if cond(msgs) {
			return msgs
		}
		if time.Now().After(deadline) {
			t.Fatalf("mensagens publicadas: %+v", msgs)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func newManager(pub publisher, cam Camera) *Manager {
	m := NewManager(pub, slog.Default())
	m.open = func(Options) (Camera, error) { return cam, nil }
	return m
}

func lastEndFrame(msgs []publishedMsg, suffix string) *endFrame {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].suffix != suffix {
			continue
		}
		if e, ok := msgs[i].body.(endFrame); ok {
			return &e
		}
	}
	return nil
}

func countFrames(msgs []publishedMsg, suffix string) int {
	n := 0
	for _, msg := range msgs {
		if msg.suffix == suffix {
			if _, ok := msg.body.([]byte); ok {
				n++
			}
		}
	}
	return n
}

func TestStartPublicaQuadrosEEncerra(t *testing.T) {
	pub := &fakePublisher{}
	cam := newFakeCamera([][]byte{[]byte("quadro1"), []byte("quadro2"), []byte("quadro3")})
	m := newManager(pub, cam)

	go m.Start("sess1")

	// Espera os tres quadros chegarem.
	pub.wait(t, func(msgs []publishedMsg) bool { return countFrames(msgs, "webcam.sess1") >= 3 })
	m.Stop("sess1")

	// E o endFrame.
	msgs := pub.wait(t, func(msgs []publishedMsg) bool { return lastEndFrame(msgs, "webcam.sess1") != nil })
	end := lastEndFrame(msgs, "webcam.sess1")
	if !end.Done {
		t.Fatalf("endFrame deveria ter Done=true, veio %+v", *end)
	}
	if end.Error != "" {
		t.Fatalf("Stop normal nao deveria publicar erro, publicou %q", end.Error)
	}
}

func TestFalhaDeCameraNoQuadroDeFim(t *testing.T) {
	pub := &fakePublisher{}
	cam := newFakeCamera(nil)
	m := newManager(pub, cam)

	go m.Start("sess2")
	for m.Active() != "sess2" {
		time.Sleep(5 * time.Millisecond)
	}
	cam.setFail(errors.New("USB desconectado"))

	msgs := pub.wait(t, func(msgs []publishedMsg) bool { return lastEndFrame(msgs, "webcam.sess2") != nil })
	end := lastEndFrame(msgs, "webcam.sess2")
	if !end.Done || end.Error == "" {
		t.Fatalf("endFrame com Error esperado, veio %+v", *end)
	}
}

func TestFalhaAoAbrirCameraSoPublicaFim(t *testing.T) {
	pub := &fakePublisher{}
	m := NewManager(pub, slog.Default())
	m.open = func(Options) (Camera, error) { return nil, errors.New("sem camera") }
	m.Start("sess3")
	if m.Active() != "" {
		t.Fatalf("sessao nao deveria ficar ativa")
	}
	if len(pub.msgs) != 1 {
		t.Fatalf("deveria publicar so o fim, publicou %d", len(pub.msgs))
	}
	end, ok := pub.msgs[0].body.(endFrame)
	if !ok || !end.Done || end.Error == "" {
		t.Fatalf("endFrame com erro esperado, veio %+v", pub.msgs[0].body)
	}
}

func TestIDInvalidoEIgnorado(t *testing.T) {
	pub := &fakePublisher{}
	m := newManager(pub, newFakeCamera(nil))
	m.Start("id com espaco")
	m.Start("tem.ponto")
	m.Start("")
	if m.Active() != "" {
		t.Fatalf("ids invalidos nao deveriam abrir sessao")
	}
	if len(pub.msgs) != 0 {
		t.Fatalf("nenhum quadro deveria ser publicado, foram %d", len(pub.msgs))
	}
}

func TestSegundoStartSubstituiAPrimeiraSessao(t *testing.T) {
	pub := &fakePublisher{}
	first := newFakeCamera(nil) // Nunca entrega quadro; so sai quando substituida.
	m := NewManager(pub, slog.Default())
	opens := 0
	m.open = func(Options) (Camera, error) {
		opens++
		if opens == 1 {
			return first, nil
		}
		return newFakeCamera([][]byte{[]byte("x")}), nil
	}

	go m.Start("primeira")
	for m.Active() != "primeira" {
		time.Sleep(5 * time.Millisecond)
	}
	go m.Start("segunda")

	msgs := pub.wait(t, func(msgs []publishedMsg) bool { return lastEndFrame(msgs, "webcam.primeira") != nil })
	firstEnd := lastEndFrame(msgs, "webcam.primeira")
	if firstEnd == nil || !firstEnd.Done || firstEnd.Error == "" {
		t.Fatalf("primeira sessao deveria ter sido encerrada com nota, estado: %+v", firstEnd)
	}

	m.Shutdown()
}

// Smoke test: o endFrame serializa como esperado em JSON (o msgpack do agente usa as mesmas tags).
func TestEndFrameJSONTags(t *testing.T) {
	b, err := json.Marshal(endFrame{Done: true, Error: "foo"})
	if err != nil {
		t.Fatal(err)
	}
	if got := string(b); got != `{"done":true,"error":"foo"}` {
		t.Fatalf("JSON inesperado: %s", got)
	}
	b, err = json.Marshal(endFrame{Done: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := string(b); got != `{"done":true}` {
		t.Fatalf("JSON inesperado sem erro: %s", got)
	}
}
