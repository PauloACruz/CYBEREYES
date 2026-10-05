//go:build linux

package capture

import (
	"image"
	"testing"
)

func TestDrawCursorBlendsPremultipliedARGB(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 3, 1))
	for i := range img.Pix {
		img.Pix[i] = 200
	}
	// Opaco vermelho, transparente, meio branco pre-multiplicado; o terceiro pixel cai fora da imagem.
	drawCursor(img, 0, 0, 4, 1, []uint32{0xffff0000, 0x00000000, 0x80808080, 0xff00ff00})
	if got := img.Pix[0:3]; got[0] != 255 || got[1] != 0 || got[2] != 0 {
		t.Fatalf("pixel opaco: %v", got)
	}
	if got := img.Pix[4:7]; got[0] != 200 || got[1] != 200 || got[2] != 200 {
		t.Fatalf("pixel transparente mudou: %v", got)
	}
	if got := img.Pix[8]; got != 128+uint8(200*127/255) {
		t.Fatalf("mistura: %d", got)
	}
}
