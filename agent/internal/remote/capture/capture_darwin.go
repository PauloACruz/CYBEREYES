//go:build darwin

package capture

import (
	"errors"
	"fmt"
	"image"
	"math"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/macos"
)

// quartz captura pelo CoreGraphics (CGDisplayCreateImage). X e Y de cada monitor ficam em pontos (coordenadas
// globais do macOS, usadas pela entrada); W e H em pixels da imagem (Retina tem Scale 2).
type quartz struct {
	ids []uint32
}

// Open confere a permissao de Gravacao de Tela; sem ela, pede ao usuario e responde com erro.
func Open() (Screen, error) {
	if err := macos.Load(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	if !macos.CGPreflightScreenCaptureAccess() {
		macos.CGRequestScreenCaptureAccess()
		return nil, errors.New("o EYES precisa da permissao de Gravacao de Tela (Ajustes do Sistema > Privacidade e Seguranca)")
	}
	return &quartz{}, nil
}

func (q *quartz) Displays() ([]Display, error) {
	ids := make([]uint32, 16)
	var n uint32
	if r := macos.CGGetActiveDisplayList(uint32(len(ids)), &ids[0], &n); r != 0 || n == 0 {
		return nil, fmt.Errorf("CGGetActiveDisplayList: %d", r)
	}
	q.ids = ids[:n]
	main := macos.CGMainDisplayID()
	out := make([]Display, 0, n)
	for i, id := range q.ids {
		b := macos.CGDisplayBounds(id)
		w, h := int(b.Size.W), int(b.Size.H)
		scale := 1.0
		if img := macos.CGDisplayCreateImage(id); img != 0 {
			w, h = int(macos.CGImageGetWidth(img)), int(macos.CGImageGetHeight(img))
			macos.CGImageRelease(img)
			if b.Size.W > 0 {
				scale = math.Round(float64(w)/b.Size.W*100) / 100
			}
		}
		out = append(out, Display{ID: i, Name: fmt.Sprintf("Monitor %d", i+1), X: int(b.Origin.X), Y: int(b.Origin.Y), W: w, H: h, Scale: scale, Primary: id == main})
	}
	for i, d := range out {
		if d.Primary && i > 0 {
			out[0], out[i] = out[i], out[0]
		}
	}
	return out, nil
}

func (q *quartz) Capture(d Display) (*image.RGBA, error) {
	if d.ID < 0 || d.ID >= len(q.ids) {
		return nil, errors.New("monitor desconhecido")
	}
	img := macos.CGDisplayCreateImage(q.ids[d.ID])
	if img == 0 {
		return nil, errors.New("CGDisplayCreateImage falhou (permissao de Gravacao de Tela?)")
	}
	defer macos.CGImageRelease(img)
	w, h := int(macos.CGImageGetWidth(img)), int(macos.CGImageGetHeight(img))
	stride := int(macos.CGImageGetBytesPerRow(img))
	if macos.CGImageGetBitsPerPixel(img) != 32 {
		return nil, errors.New("formato de imagem do CoreGraphics nao suportado")
	}
	data := macos.CGDataProviderCopyData(macos.CGImageGetDataProvider(img))
	if data == 0 {
		return nil, errors.New("CGDataProviderCopyData falhou")
	}
	defer macos.CFRelease(data)
	src := macos.Bytes(macos.CFDataGetBytePtr(data), macos.CFDataGetLength(data))
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	// Formato do monitor: 32 bits BGRA (little-endian, alfa primeiro).
	for y := 0; y < h && y*stride+w*4 <= len(src); y++ {
		row := src[y*stride:]
		dst := out.Pix[out.PixOffset(0, y):]
		for x := 0; x < w; x++ {
			dst[x*4], dst[x*4+1], dst[x*4+2], dst[x*4+3] = row[x*4+2], row[x*4+1], row[x*4], 0xff
		}
	}
	return out, nil
}

func (q *quartz) Close() error { return nil }
