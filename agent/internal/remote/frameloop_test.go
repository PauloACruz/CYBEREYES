package remote

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/jpeg"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/capture"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// fakeScreen e uma tela em memoria com cursor separado, para testar o laco de quadros sem servidor grafico.
type fakeScreen struct {
	mu     sync.Mutex
	img    *image.RGBA
	cursor capture.Cursor
}

func newFakeScreen(w, h int) *fakeScreen {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = byte(i * 7 % 251)
	}
	shape := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for i := 3; i < len(shape.Pix); i += 4 {
		shape.Pix[i] = 0xff
	}
	return &fakeScreen{img: img, cursor: capture.Cursor{Visible: true, X: 10, Y: 10, Shape: capture.NewCursorShape(shape, 1, 1)}}
}

func (f *fakeScreen) Displays() ([]capture.Display, error) {
	b := f.img.Bounds()
	return []capture.Display{{ID: 0, Name: "teste", W: b.Dx(), H: b.Dy(), Scale: 1, Primary: true}}, nil
}

func (f *fakeScreen) Capture(capture.Display) (*image.RGBA, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := image.NewRGBA(f.img.Bounds())
	copy(out.Pix, f.img.Pix)
	return out, nil
}

func (f *fakeScreen) Close() error { return nil }

func (f *fakeScreen) Grab(_ capture.Display, fr *capture.Frame, separate bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if fr.Img == nil || fr.Img.Bounds() != f.img.Bounds() {
		fr.Img = image.NewRGBA(f.img.Bounds())
	}
	copy(fr.Img.Pix, f.img.Pix)
	fr.Changed, fr.Dirty, fr.Cursor = true, nil, capture.Cursor{}
	if separate {
		fr.Cursor = f.cursor
	}
	return nil
}

func (f *fakeScreen) Pointer(capture.Display) (capture.Cursor, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cursor, nil
}

func (f *fakeScreen) Backend() string { return "teste" }
func (f *fakeScreen) Polling() bool   { return true }

func (f *fakeScreen) paint(r image.Rectangle, v byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			o := f.img.PixOffset(x, y)
			f.img.Pix[o], f.img.Pix[o+1], f.img.Pix[o+2] = v, v, v
		}
	}
}

func (f *fakeScreen) moveCursor(x, y int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cursor.X, f.cursor.Y = x, y
}

// viewerFrame e um quadro recebido pelo visualizador de teste: blocos e o FRAME_END.
type viewerFrame struct {
	id    uint32
	tiles []image.Rectangle
	area  int
}

// testViewer le o que o laco de quadros envia e responde ACK quando ack e verdadeiro.
type testViewer struct {
	t       *testing.T
	conn    *websocket.Conn
	frames  chan viewerFrame
	cursors chan proto.CursorBody
	audios  chan []byte
}

func (v *testViewer) run(ctx context.Context) {
	cur := viewerFrame{}
	for {
		_, msg, err := v.conn.Read(ctx)
		if err != nil {
			return
		}
		switch msg[0] {
		case proto.Tile:
			x, y := binary.BigEndian.Uint16(msg[5:]), binary.BigEndian.Uint16(msg[7:])
			w, h := binary.BigEndian.Uint16(msg[9:]), binary.BigEndian.Uint16(msg[11:])
			img, err := jpeg.Decode(bytes.NewReader(msg[13:]))
			if err != nil || img.Bounds().Dx() != int(w) || img.Bounds().Dy() != int(h) {
				v.t.Errorf("bloco invalido %dx%d: %v", w, h, err)
			}
			cur.tiles = append(cur.tiles, image.Rect(int(x), int(y), int(x+w), int(y+h)))
			cur.area += int(w) * int(h)
		case proto.FrameEnd:
			cur.id = binary.BigEndian.Uint32(msg[1:])
			v.frames <- cur
			cur = viewerFrame{}
		case proto.Audio:
			select {
			case v.audios <- msg:
			default:
			}
		case proto.Cursor:
			var c proto.CursorBody
			if err := json.Unmarshal(msg[1:], &c); err != nil {
				v.t.Errorf("CURSOR: %v", err)
			}
			v.cursors <- c
		}
	}
}

func (v *testViewer) ack(ctx context.Context, id uint32) {
	out := make([]byte, 9)
	out[0] = proto.Ack
	binary.BigEndian.PutUint32(out[1:], id)
	if err := v.conn.Write(ctx, websocket.MessageBinary, out); err != nil {
		v.t.Errorf("ACK: %v", err)
	}
}

func (v *testViewer) nextFrame(timeout time.Duration) (viewerFrame, bool) {
	select {
	case f := <-v.frames:
		return f, true
	case <-time.After(timeout):
		return viewerFrame{}, false
	}
}

// startFrameLoop liga um desktopSession com a tela falsa a um visualizador de teste por WebSocket.
func startFrameLoop(t *testing.T, screen *fakeScreen, settings proto.SettingsBody) (*testViewer, *desktopSession) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	viewerConn := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		c.SetReadLimit(8 << 20)
		viewerConn <- c
		<-ctx.Done()
	}))
	t.Cleanup(srv.Close)
	agent, _, err := websocket.Dial(ctx, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	agent.SetReadLimit(8 << 20)
	v := &testViewer{t: t, conn: <-viewerConn, frames: make(chan viewerFrame, 64), cursors: make(chan proto.CursorBody, 256), audios: make(chan []byte, 64)}
	go v.run(ctx)
	ds, _ := screen.Displays()
	s := &desktopSession{conn: agent, screen: screen, grabber: screen, log: slog.New(slog.DiscardHandler), quality: settings.Quality,
		flow: newFlowControl(), wake: make(chan struct{}, 1), cursorShapes: map[uint32]bool{}, displays: ds, display: ds[0], settings: settings, ctx: ctx}
	go func() { _ = s.readLoop(ctx) }()
	go func() { _ = s.frameLoop(ctx) }()
	return v, s
}

func TestFrameLoopSendsChangesCursorAndRefinement(t *testing.T) {
	screen := newFakeScreen(320, 240)
	v, _ := startFrameLoop(t, screen, proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 30, Cursor: true})
	ctx := context.Background()

	first, ok := v.nextFrame(3 * time.Second)
	if !ok || first.area != 320*240 {
		t.Fatalf("primeiro quadro deveria cobrir a tela: %+v", first)
	}
	c := <-v.cursors
	if !c.Visible || c.PNG == nil || c.X != 10 || c.Y != 10 {
		t.Fatalf("primeiro CURSOR com o desenho: %+v", c)
	}
	v.ack(ctx, first.id)

	// Mudanca pequena: so os blocos dela.
	screen.paint(image.Rect(100, 100, 110, 110), 0x20)
	small, ok := v.nextFrame(3 * time.Second)
	if !ok || small.area > 64*64*4 {
		t.Fatalf("mudanca pequena deveria mandar poucos blocos: %+v", small)
	}
	v.ack(ctx, small.id)

	// Cursor movido: CURSOR sem o PNG, sem quadro de imagem.
	screen.moveCursor(50, 60)
	deadline := time.After(2 * time.Second)
	for moved := false; !moved; {
		select {
		case c := <-v.cursors:
			if c.X == 50 && c.Y == 60 {
				if c.PNG != nil {
					t.Fatal("desenho ja enviado nao deve voltar")
				}
				moved = true
			}
		case <-deadline:
			t.Fatal("CURSOR do movimento nao chegou")
		}
	}

	// Tela parada: o refinamento reenvia os blocos com perda (toda a tela, em qualidade 60).
	refined := 0
	for refined < 320*240 {
		f, ok := v.nextFrame(3 * time.Second)
		if !ok {
			t.Fatalf("refinamento incompleto: %d px", refined)
		}
		refined += f.area
		v.ack(ctx, f.id)
	}
	if extra, ok := v.nextFrame(1500 * time.Millisecond); ok {
		t.Fatalf("depois do refinamento a tela parada nao manda nada: %+v", extra)
	}
}

func TestFrameLoopRespectsWindowWithoutAcks(t *testing.T) {
	screen := newFakeScreen(320, 240)
	_, s := startFrameLoop(t, screen, proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 30})
	// Sem ACK: muda a tela sem parar; o laco deve parar na janela (sem medida, 300 ms / 33 ms + 2 = 11 quadros).
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-time.After(10 * time.Millisecond):
				screen.paint(image.Rect(0, 0, 32, 32), byte(i))
			}
		}
	}()
	time.Sleep(1500 * time.Millisecond)
	s.mu.Lock()
	inflight := len(s.flow.inflight)
	s.mu.Unlock()
	if inflight == 0 || inflight > maxWindowFrames {
		t.Fatalf("quadros sem ACK: %d", inflight)
	}
	if want := s.flow.window(time.Second/30, time.Now()); inflight > want {
		t.Fatalf("janela de %d quadros, %d sem ACK", want, inflight)
	}
}

// Servico EYES caiu (entrada padrao do remote-helper fechada): a sessao termina com BYE, sem seguir mostrando a tela.
func TestWatchControlEndsWhenServiceGoes(t *testing.T) {
	screen := newFakeScreen(64, 64)
	v, s := startFrameLoop(t, screen, proto.SettingsBody{Quality: 60, Scale: 1, MaxFPS: 5})
	_ = v
	control := make(chan Control)
	close(control)
	done := make(chan error, 1)
	go func() { done <- s.watchControl(context.Background(), control) }()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatalf("erro = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("o remote-helper seguiu com a sessao sem o servico")
	}
}
