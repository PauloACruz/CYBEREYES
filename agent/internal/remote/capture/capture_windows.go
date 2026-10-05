//go:build windows

package capture

import (
	"errors"
	"fmt"
	"image"
	"syscall"
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

const (
	cursorShowing = 1
	diNormal      = 3
)

// drawCursor desenha o ponteiro do mouse na imagem (o BitBlt nao inclui o cursor).
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

// gdi captura com BitBlt da area de trabalho virtual para uma DIB de 32 bits de cima para baixo.
type gdi struct {
	screenDC uintptr
	memDC    uintptr
	bitmap   uintptr
	bits     unsafe.Pointer
	w, h     int
}

// Open prepara a captura pelo GDI na area de trabalho de entrada.
func Open() (Screen, error) {
	g := &gdi{}
	if err := windesk.Do(func(changed bool) error { return g.refresh(changed) }); err != nil {
		return nil, err
	}
	return g, nil
}

// refresh recria os DCs quando a area de trabalho de entrada mudou (o DC antigo fica preso a anterior).
func (g *gdi) refresh(changed bool) error {
	if !changed && g.screenDC != 0 {
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
	g.screenDC, g.memDC = dc, mem
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

func (g *gdi) Displays() ([]Display, error) {
	var out []Display
	err := windesk.Do(func(changed bool) error {
		if err := g.refresh(changed); err != nil {
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

func (g *gdi) ensureBitmap(w, h int) error {
	if g.bitmap != 0 && g.w == w && g.h == h {
		return nil
	}
	if g.bitmap != 0 {
		procDeleteObject.Call(g.bitmap)
		g.bitmap, g.bits = 0, nil
	}
	hdr := bitmapInfoHeader{Size: bitmapInfoHdrSize, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32, Compression: biRGB}
	var bits unsafe.Pointer
	bmp, _, err := procCreateDIBSection.Call(g.memDC, uintptr(unsafe.Pointer(&hdr)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 || bits == nil {
		return fmt.Errorf("CreateDIBSection: %w", err)
	}
	procSelectObject.Call(g.memDC, bmp)
	g.bitmap, g.bits, g.w, g.h = bmp, bits, w, h
	return nil
}

func (g *gdi) Capture(d Display) (*image.RGBA, error) {
	if d.W <= 0 || d.H <= 0 {
		return nil, errors.New("monitor sem tamanho")
	}
	img := image.NewRGBA(image.Rect(0, 0, d.W, d.H))
	err := windesk.Do(func(changed bool) error {
		if err := g.refresh(changed); err != nil {
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
		drawCursor(g.memDC, d)
		procGdiFlush.Call()
		src := unsafe.Slice((*byte)(g.bits), d.W*d.H*4)
		bgraToRGBA(img.Pix, src)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return img, nil
}

// bgraToRGBA troca os canais azul e vermelho e fixa o alfa (a DIB do GDI vem em BGRX).
func bgraToRGBA(dst, src []byte) {
	for i := 0; i+3 < len(src) && i+3 < len(dst); i += 4 {
		dst[i], dst[i+1], dst[i+2], dst[i+3] = src[i+2], src[i+1], src[i], 0xff
	}
}

func (g *gdi) Close() error {
	return windesk.Do(func(bool) error {
		g.release()
		return nil
	})
}
