package capture

import (
	"hash/fnv"
	"image"
)

// Frame e o resultado de uma captura, reaproveitado entre chamadas para nao alocar a tela inteira a cada quadro.
type Frame struct {
	// Img e a imagem do monitor (RGBA). O buffer pertence ao Frame e e reescrito na proxima captura.
	Img *image.RGBA
	// Changed falso garante que nada mudou desde a captura anterior neste Frame (o quadro pode ser pulado).
	Changed bool
	// Dirty, quando nao nulo, lista as unicas regioes que podem ter mudado desde a captura anterior.
	// Nulo significa "qualquer parte pode ter mudado" (o codificador compara a imagem inteira).
	Dirty []image.Rectangle
	// Cursor e o estado do ponteiro (preenchido quando a captura foi pedida com o cursor separado).
	Cursor Cursor
}

// Cursor e o ponteiro do mouse em coordenadas do monitor (pixels fisicos). X e Y sao a posicao do ponto
// ativo (hotspot); Shape e nil quando o desenho nao e conhecido.
type Cursor struct {
	Visible bool
	X, Y    int
	Shape   *CursorShape
}

// CursorShape e o desenho do ponteiro em RGBA sem pre-multiplicacao, com o ponto ativo.
type CursorShape struct {
	ID         uint32
	Img        *image.RGBA
	HotX, HotY int
}

// NewCursorShape calcula o ID pelo conteudo, para o visualizador reaproveitar desenhos ja recebidos.
func NewCursorShape(img *image.RGBA, hotX, hotY int) *CursorShape {
	h := fnv.New32a()
	b := img.Bounds()
	h.Write([]byte{byte(b.Dx()), byte(b.Dx() >> 8), byte(b.Dy()), byte(b.Dy() >> 8), byte(hotX), byte(hotY)})
	h.Write(img.Pix)
	return &CursorShape{ID: h.Sum32(), Img: img, HotX: hotX, HotY: hotY}
}

// Grabber e a captura rapida: escreve no Frame reaproveitado, informa as regioes alteradas e, com
// separateCursor, nao desenha o ponteiro na imagem (o visualizador desenha o cursor recebido a parte).
type Grabber interface {
	Grab(d Display, f *Frame, separateCursor bool) error
	// Pointer devolve so o estado do ponteiro (barato), para acompanhar o cursor entre capturas.
	Pointer(d Display) (Cursor, error)
	// Backend nomeia o metodo de captura em uso ("dxgi", "gdi", "x11", "quartz"), para log e telemetria.
	Backend() string
	// Polling informa se a captura precisa reler a tela para descobrir mudancas (GDI, X11): nesse caso a
	// frequencia cai com a tela parada. Falso quando o sistema avisa as mudancas (DXGI).
	Polling() bool
}

// AsGrabber adapta uma captura simples (que aloca a imagem e desenha o cursor) a interface Grabber.
func AsGrabber(s Screen) Grabber {
	if g, ok := s.(Grabber); ok {
		return g
	}
	return simple{s}
}

type simple struct{ s Screen }

func (a simple) Grab(d Display, f *Frame, _ bool) error {
	img, err := a.s.Capture(d)
	if err != nil {
		return err
	}
	f.Img, f.Changed, f.Dirty = img, true, nil
	f.Cursor = Cursor{}
	return nil
}

func (a simple) Pointer(Display) (Cursor, error) { return Cursor{}, ErrUnsupported }
func (a simple) Backend() string                 { return "simples" }
func (a simple) Polling() bool                   { return true }

// ensureImage devolve f.Img com o tamanho pedido, alocando so quando muda.
func ensureImage(f *Frame, w, h int) *image.RGBA {
	if f.Img == nil || f.Img.Bounds().Dx() != w || f.Img.Bounds().Dy() != h || f.Img.Bounds().Min != (image.Point{}) {
		f.Img = image.NewRGBA(image.Rect(0, 0, w, h))
	}
	return f.Img
}
