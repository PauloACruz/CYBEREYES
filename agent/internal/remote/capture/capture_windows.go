//go:build windows

package capture

import (
	"errors"
	"fmt"
	"image"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/windesk"
)

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	gdi32                   = windows.NewLazySystemDLL("gdi32.dll")
	shcore                  = windows.NewLazySystemDLL("shcore.dll")
	procGetDC               = user32.NewProc("GetDC")
	procReleaseDC           = user32.NewProc("ReleaseDC")
	procEnumDisplayMonitors = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	procGetDpiForMonitor    = shcore.NewProc("GetDpiForMonitor")
	procCreateCompatibleDC  = gdi32.NewProc("CreateCompatibleDC")
	procCreateDIBSection    = gdi32.NewProc("CreateDIBSection")
	procSelectObject        = gdi32.NewProc("SelectObject")
	procDeleteObject        = gdi32.NewProc("DeleteObject")
	procDeleteDC            = gdi32.NewProc("DeleteDC")
	procBitBlt              = gdi32.NewProc("BitBlt")
	procGdiFlush            = gdi32.NewProc("GdiFlush")
	procGetObject           = gdi32.NewProc("GetObjectW")
	procGetCursorInfo       = user32.NewProc("GetCursorInfo")
	procGetIconInfo         = user32.NewProc("GetIconInfo")
	procDrawIconEx          = user32.NewProc("DrawIconEx")
)

const (
	srcCopy           = 0x00CC0020
	captureBlt        = 0x40000000
	monitorInfoFPrim  = 1
	mdtEffectiveDPI   = 0
	biRGB             = 0
	dibRGBColors      = 0
	ccDeviceName      = 32
	bitmapInfoHdrSize = 40
	cursorShowing     = 1
	diNormal          = 3
)

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfoEx struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
	Device  [ccDeviceName]uint16
}

type cursorInfo struct {
	Size   uint32
	Flags  uint32
	Cursor uintptr
	X, Y   int32
}

type iconInfo struct {
	Icon     int32
	HotX     uint32
	HotY     uint32
	MaskBmp  uintptr
	ColorBmp uintptr
}

type bitmap struct {
	Type       int32
	Width      int32
	Height     int32
	WidthBytes int32
	Planes     uint16
	BitsPixel  uint16
	Bits       uintptr
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// screen escolhe o metodo de captura: DXGI Desktop Duplication (a GPU entrega so o que mudou e nada e gasto com a
// tela parada) e, quando o DXGI nao estiver disponivel (sessao de Area de Trabalho Remota, driver sem suporte,
// algumas telas seguras), o GDI.
type screen struct {
	gdi       gdi
	dxgi      *dxgiDup
	dxgiRetry time.Time // proxima tentativa de usar o DXGI depois de uma falha
	dxgiErr   error     // por que o DXGI nao esta em uso (log)
	backend   string

	shapes     map[uintptr]*CursorShape
	under      cursorPatch // pixels sob o cursor desenhado na imagem do DXGI
	underShape uint32
}

// Open prepara a captura na area de trabalho de entrada.
func Open() (Screen, error) {
	s := &screen{shapes: map[uintptr]*CursorShape{}, backend: "gdi"}
	if err := windesk.Do(s.gdi.refresh); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *screen) Backend() string {
	if s.backend == "gdi" && s.dxgiErr != nil {
		return "gdi (dxgi: " + s.dxgiErr.Error() + ")"
	}
	return s.backend
}

// Polling: o DXGI avisa as mudancas; o GDI precisa reler a tela.
func (s *screen) Polling() bool { return s.backend != "dxgi" }

func (s *screen) Displays() ([]Display, error) {
	var out []Display
	err := windesk.Do(func(gen uint64) error {
		if err := s.gdi.refresh(gen); err != nil {
			return err
		}
		enumerated = nil
		if r, _, err := procEnumDisplayMonitors.Call(0, 0, monitorCallback, 0); r == 0 {
			return fmt.Errorf("EnumDisplayMonitors: %w", err)
		}
		out = enumerated
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, errors.New("nenhum monitor encontrado")
	}
	// O principal primeiro (contrato, secao 5.1); os ids seguem a ordem da enumeracao.
	for i, d := range out {
		if d.Primary && i > 0 {
			out[0], out[i] = out[i], out[0]
			break
		}
	}
	return out, nil
}

// enumerated recebe os monitores do monitorCallback. So e usado na thread do windesk, uma enumeracao por vez.
var enumerated []Display

// monitorCallback e criado uma vez: o Windows limita a quantidade de callbacks por processo.
var monitorCallback = syscall.NewCallback(func(h, _, _, _ uintptr) uintptr {
	info := monitorInfoEx{}
	info.Size = uint32(unsafe.Sizeof(info))
	if r, _, _ := procGetMonitorInfo.Call(h, uintptr(unsafe.Pointer(&info))); r == 0 {
		return 1
	}
	scale := 1.0
	if procGetDpiForMonitor.Find() == nil {
		var dx, dy uint32
		if r, _, _ := procGetDpiForMonitor.Call(h, mdtEffectiveDPI, uintptr(unsafe.Pointer(&dx)), uintptr(unsafe.Pointer(&dy))); r == 0 && dx > 0 {
			scale = float64(dx) / 96
		}
	}
	m := info.Monitor
	enumerated = append(enumerated, Display{
		ID: len(enumerated), Name: windows.UTF16ToString(info.Device[:]), X: int(m.Left), Y: int(m.Top),
		W: int(m.Right - m.Left), H: int(m.Bottom - m.Top), Scale: scale, Primary: info.Flags&monitorInfoFPrim != 0,
	})
	return 1
})

// Capture devolve uma imagem nova com o cursor desenhado (interface Screen).
func (s *screen) Capture(d Display) (*image.RGBA, error) {
	var f Frame
	if err := s.Grab(d, &f, false); err != nil {
		return nil, err
	}
	return f.Img, nil
}

// Grab captura o monitor d no Frame reaproveitado.
func (s *screen) Grab(d Display, f *Frame, separateCursor bool) error {
	if d.W <= 0 || d.H <= 0 {
		return errors.New("monitor sem tamanho")
	}
	if s.tryDXGI() {
		err := s.grabDXGI(d, f, separateCursor)
		if err == nil {
			s.backend, s.dxgiErr = "dxgi", nil
			return nil
		}
		s.dxgiErr = err
		if !errors.Is(err, errDXGINoImage) {
			// DXGI fora agora (troca de area de trabalho, resolucao, tela segura): este quadro vai pelo GDI e o DXGI
			// e tentado de novo em alguns segundos; sem suporte (sessao remota, driver, monitor girado), em 1 minuto.
			s.closeDXGI()
			wait := 3 * time.Second
			if errors.Is(err, errDXGIUnavailable) {
				wait = time.Minute
			}
			s.dxgiRetry = time.Now().Add(wait)
		}
		// Sem a primeira imagem do DXGI ainda, o GDI cobre este quadro; a primeira imagem do DXGI e completa.
	}
	s.backend = "gdi"
	s.under, s.underShape = cursorPatch{}, 0
	if err := s.gdi.grab(d, f, !separateCursor); err != nil {
		return err
	}
	if separateCursor {
		c, _ := s.Pointer(d)
		f.Cursor = c
	}
	return nil
}

func (s *screen) tryDXGI() bool {
	if s.dxgi != nil {
		return true
	}
	return time.Now().After(s.dxgiRetry) && procD3D11CreateDevice.Find() == nil && procCreateDXGIFactory1.Find() == nil
}

func (s *screen) closeDXGI() {
	if s.dxgi != nil {
		dup := s.dxgi
		s.dxgi = nil
		_ = windesk.Do(func(uint64) error {
			dup.release()
			return nil
		})
	}
}

// errDXGINoImage: a duplicacao existe, mas a primeira imagem da tela ainda nao chegou.
var errDXGINoImage = errors.New("DXGI sem imagem ainda")

// grabDXGI le as regioes alteradas pelo DXGI. Sem cursor separado, desenha o ponteiro na imagem guardando os
// pixels de baixo, que voltam antes do proximo quadro.
func (s *screen) grabDXGI(d Display, f *Frame, separateCursor bool) error {
	var regions []image.Rectangle
	var changed, full, fresh bool
	restored := false
	old, oldShape := s.under.rect, s.underShape
	err := windesk.Do(func(gen uint64) error {
		if s.dxgi != nil && (s.dxgi.gen != gen || s.dxgi.name != d.Name) {
			s.dxgi.release()
			s.dxgi = nil
		}
		if s.dxgi == nil {
			dup, err := openDXGI(d)
			if err != nil {
				return err
			}
			dup.gen = gen
			s.dxgi = dup
		}
		if !s.dxgi.fresh && !old.Empty() && f.Img != nil {
			// Apaga o cursor desenhado no quadro anterior antes de aplicar as regioes novas.
			s.under.restore(f.Img)
			restored = true
		}
		var err error
		regions, changed, full, err = s.dxgi.grab(f)
		fresh = s.dxgi.fresh
		return err
	})
	if err != nil {
		return err
	}
	if fresh {
		return errDXGINoImage
	}
	if !restored {
		// Primeira imagem do DXGI: a tela inteira foi copiada, sem cursor desenhado.
		old, oldShape = image.Rectangle{}, 0
	}
	s.under, s.underShape = cursorPatch{}, 0
	if full {
		regions = nil
	}
	f.Changed, f.Dirty = changed, regions
	c, _ := s.Pointer(d)
	if separateCursor {
		f.Cursor = c
		if !old.Empty() {
			f.Changed = true
			if f.Dirty != nil {
				f.Dirty = append(f.Dirty, old)
			}
		}
		return nil
	}
	f.Cursor = Cursor{}
	if c.Visible && c.Shape != nil && f.Img != nil {
		s.under, s.underShape = compositeCursor(f.Img, c), c.Shape.ID
	}
	if old != s.under.rect || oldShape != s.underShape {
		f.Changed = true
		if f.Dirty != nil {
			f.Dirty = append(f.Dirty, old, s.under.rect)
		}
	}
	return nil
}

// Pointer le a posicao e o desenho do ponteiro (GetCursorInfo), com cache por cursor.
func (s *screen) Pointer(d Display) (Cursor, error) {
	var c Cursor
	err := windesk.Do(func(uint64) error {
		ci := cursorInfo{}
		ci.Size = uint32(unsafe.Sizeof(ci))
		if r, _, err := procGetCursorInfo.Call(uintptr(unsafe.Pointer(&ci))); r == 0 {
			return fmt.Errorf("GetCursorInfo: %w", err)
		}
		c.Visible = ci.Flags&cursorShowing != 0 && ci.Cursor != 0
		c.X, c.Y = int(ci.X)-d.X, int(ci.Y)-d.Y
		if !c.Visible {
			return nil
		}
		shape, ok := s.shapes[ci.Cursor]
		if !ok {
			shape = cursorShape(ci.Cursor)
			if len(s.shapes) > 64 {
				clear(s.shapes)
			}
			s.shapes[ci.Cursor] = shape
		}
		c.Shape = shape
		return nil
	})
	return c, err
}

func (s *screen) Close() error {
	s.closeDXGI()
	return windesk.Do(func(uint64) error {
		s.gdi.release()
		return nil
	})
}

// gdi captura com BitBlt da area de trabalho virtual para uma DIB de 32 bits de cima para baixo.
type gdi struct {
	screenDC uintptr
	memDC    uintptr
	bitmap   uintptr
	bits     unsafe.Pointer
	w, h     int
	gen      uint64 // area de trabalho dos DCs (windesk)
}

// refresh recria os DCs quando a area de trabalho de entrada mudou (o DC antigo fica preso a anterior).
func (g *gdi) refresh(gen uint64) error {
	if g.screenDC != 0 && g.gen == gen {
		return nil
	}
	g.release()
	dc, _, err := procGetDC.Call(0)
	if dc == 0 {
		return fmt.Errorf("GetDC: %w", err)
	}
	mem, _, err := procCreateCompatibleDC.Call(dc)
	if mem == 0 {
		procReleaseDC.Call(0, dc)
		return fmt.Errorf("CreateCompatibleDC: %w", err)
	}
	g.screenDC, g.memDC, g.gen = dc, mem, gen
	return nil
}

func (g *gdi) release() {
	if g.bitmap != 0 {
		procDeleteObject.Call(g.bitmap)
		g.bitmap, g.bits, g.w, g.h = 0, nil, 0, 0
	}
	if g.memDC != 0 {
		procDeleteDC.Call(g.memDC)
		g.memDC = 0
	}
	if g.screenDC != 0 {
		procReleaseDC.Call(0, g.screenDC)
		g.screenDC = 0
	}
}

func (g *gdi) ensureBitmap(w, h int) error {
	if g.bitmap != 0 && g.w == w && g.h == h {
		return nil
	}
	if g.bitmap != 0 {
		procDeleteObject.Call(g.bitmap)
		g.bitmap, g.bits = 0, nil
	}
	bmp, bits, err := newDIB(g.memDC, w, h)
	if err != nil {
		return err
	}
	procSelectObject.Call(g.memDC, bmp)
	g.bitmap, g.bits, g.w, g.h = bmp, bits, w, h
	return nil
}

func newDIB(dc uintptr, w, h int) (uintptr, unsafe.Pointer, error) {
	hdr := bitmapInfoHeader{Size: bitmapInfoHdrSize, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32, Compression: biRGB}
	var bits unsafe.Pointer
	bmp, _, err := procCreateDIBSection.Call(dc, uintptr(unsafe.Pointer(&hdr)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 || bits == nil {
		return 0, nil, fmt.Errorf("CreateDIBSection: %w", err)
	}
	return bmp, bits, nil
}

// grab faz o BitBlt na thread da area de trabalho e converte para RGBA fora dela (a entrada nao espera a conversao).
func (g *gdi) grab(d Display, f *Frame, drawPointer bool) error {
	err := windesk.Do(func(gen uint64) error {
		if err := g.refresh(gen); err != nil {
			return err
		}
		if err := g.ensureBitmap(d.W, d.H); err != nil {
			return err
		}
		if r, _, err := procBitBlt.Call(g.memDC, 0, 0, uintptr(d.W), uintptr(d.H), g.screenDC, uintptr(int32(d.X)), uintptr(int32(d.Y)), srcCopy|captureBlt); r == 0 {
			// A area de trabalho pode ter mudado no meio (UAC); a proxima chamada recria os DCs.
			g.release()
			return fmt.Errorf("BitBlt: %w", err)
		}
		if drawPointer {
			drawCursor(g.memDC, d)
		}
		procGdiFlush.Call()
		return nil
	})
	if err != nil {
		return err
	}
	img := ensureImage(f, d.W, d.H)
	src := unsafe.Slice((*byte)(g.bits), d.W*d.H*4)
	convertBGRA(img, src, d.W*4, image.Rect(0, 0, d.W, d.H))
	f.Changed, f.Dirty = true, nil
	f.Cursor = Cursor{}
	return nil
}

// drawCursor desenha o ponteiro do mouse na imagem do GDI (o BitBlt nao inclui o cursor).
func drawCursor(memDC uintptr, d Display) {
	ci := cursorInfo{}
	ci.Size = uint32(unsafe.Sizeof(ci))
	if r, _, _ := procGetCursorInfo.Call(uintptr(unsafe.Pointer(&ci))); r == 0 || ci.Flags&cursorShowing == 0 || ci.Cursor == 0 {
		return
	}
	var ii iconInfo
	if r, _, _ := procGetIconInfo.Call(ci.Cursor, uintptr(unsafe.Pointer(&ii))); r == 0 {
		return
	}
	if ii.MaskBmp != 0 {
		procDeleteObject.Call(ii.MaskBmp)
	}
	if ii.ColorBmp != 0 {
		procDeleteObject.Call(ii.ColorBmp)
	}
	x := int(ci.X) - int(ii.HotX) - d.X
	y := int(ci.Y) - int(ii.HotY) - d.Y
	if x < -64 || y < -64 || x > d.W || y > d.H {
		return
	}
	procDrawIconEx.Call(memDC, uintptr(int32(x)), uintptr(int32(y)), ci.Cursor, 0, 0, 0, 0, diNormal)
}

// cursorShape extrai o desenho do cursor desenhando-o sobre fundo preto e sobre fundo branco: a diferenca da a
// transparencia de cada pixel, para cursores coloridos, com mascara e monocromaticos. Pixels de inversao (o
// cursor de texto) viram preto com contorno branco, visivel em qualquer fundo.
func cursorShape(h uintptr) *CursorShape {
	var ii iconInfo
	if r, _, _ := procGetIconInfo.Call(h, uintptr(unsafe.Pointer(&ii))); r == 0 {
		return nil
	}
	var bm bitmap
	w, ht := 32, 32
	if ii.ColorBmp != 0 {
		if r, _, _ := procGetObject.Call(ii.ColorBmp, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm))); r != 0 {
			w, ht = int(bm.Width), int(bm.Height)
		}
	} else if ii.MaskBmp != 0 {
		if r, _, _ := procGetObject.Call(ii.MaskBmp, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm))); r != 0 {
			w, ht = int(bm.Width), int(bm.Height)/2
		}
	}
	if ii.MaskBmp != 0 {
		procDeleteObject.Call(ii.MaskBmp)
	}
	if ii.ColorBmp != 0 {
		procDeleteObject.Call(ii.ColorBmp)
	}
	if w <= 0 || ht <= 0 || w > 256 || ht > 256 {
		return nil
	}
	dc, _, _ := procCreateCompatibleDC.Call(0)
	if dc == 0 {
		return nil
	}
	defer procDeleteDC.Call(dc)
	bmp, bits, err := newDIB(dc, w, ht)
	if err != nil {
		return nil
	}
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(dc, bmp)
	defer procSelectObject.Call(dc, old)
	px := unsafe.Slice((*byte)(bits), w*ht*4)
	render := func(bg byte) []byte {
		for i := range px {
			px[i] = bg
		}
		procDrawIconEx.Call(dc, 0, 0, h, uintptr(w), uintptr(ht), 0, 0, diNormal)
		procGdiFlush.Call()
		return append([]byte(nil), px...)
	}
	black, white := render(0x00), render(0xff)
	img := image.NewRGBA(image.Rect(0, 0, w, ht))
	shapeFromBackgrounds(img, black, white)
	return NewCursorShape(img, int(ii.HotX), int(ii.HotY))
}

// convertBGRA copia a regiao r de src (BGRA, pitch bytes por linha) para dst em RGBA, em paralelo por faixas.
func convertBGRA(dst *image.RGBA, src []byte, pitch int, r image.Rectangle) {
	rows := r.Dy()
	workers := 1
	if rows*r.Dx() > 256*256 {
		workers = max(1, min(runtime.NumCPU(), 4))
	}
	band := (rows + workers - 1) / workers
	var wg sync.WaitGroup
	for y0 := r.Min.Y; y0 < r.Max.Y; y0 += band {
		y1 := min(r.Max.Y, y0+band)
		wg.Add(1)
		go func() {
			defer wg.Done()
			for y := y0; y < y1; y++ {
				s := src[y*pitch+r.Min.X*4 : y*pitch+r.Max.X*4]
				d := dst.Pix[dst.PixOffset(r.Min.X, y):]
				for i := 0; i+3 < len(s); i += 4 {
					d[i], d[i+1], d[i+2], d[i+3] = s[i+2], s[i+1], s[i], 0xff
				}
			}
		}()
	}
	wg.Wait()
}
