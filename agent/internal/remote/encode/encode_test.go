package encode

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand/v2"
	"testing"
)

// officeFrame imita uma tela de escritorio: fundo claro, barras e "linhas de texto".
func officeFrame(w, h int, seed uint64) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewPCG(seed, 1))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 0xf3, 0xf3, 0xf3, 0xff
	}
	fill(img, image.Rect(0, 0, w, 40), color.RGBA{0x20, 0x40, 0x80, 0xff})
	for y := 60; y < h-20; y += 18 {
		for x := 20; x < w-200; x += 7 + rng.IntN(5) {
			if rng.IntN(6) != 0 {
				fill(img, image.Rect(x, y, x+5, y+11), color.RGBA{0x22, 0x22, 0x22, 0xff})
			}
		}
	}
	return img
}

func fill(img *image.RGBA, r image.Rectangle, c color.RGBA) {
	r = r.Intersect(img.Bounds())
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			img.SetRGBA(x, y, c)
		}
	}
}

func clone(img *image.RGBA) *image.RGBA {
	c := image.NewRGBA(img.Bounds())
	copy(c.Pix, img.Pix)
	return c
}

func TestFirstFrameCoversScreen(t *testing.T) {
	var e Encoder
	tiles, err := e.Encode(officeFrame(300, 130, 1), 60)
	if err != nil {
		t.Fatal(err)
	}
	area := 0
	for _, tl := range tiles {
		if tl.W > MaxRectWidth || tl.H > TileSize {
			t.Fatalf("bloco grande demais: %+v", tl)
		}
		if _, err := jpeg.Decode(bytes.NewReader(tl.JPEG)); err != nil {
			t.Fatalf("JPEG invalido: %v", err)
		}
		area += tl.W * tl.H
	}
	if area != 300*130 {
		t.Fatalf("area coberta %d, esperado %d", area, 300*130)
	}
}

func TestOnlyChangedTilesAreSent(t *testing.T) {
	var e Encoder
	a := officeFrame(640, 480, 2)
	if _, err := e.Encode(a, 60); err != nil {
		t.Fatal(err)
	}
	same, _ := e.Encode(clone(a), 60)
	if len(same) != 0 {
		t.Fatalf("quadro igual gerou %d blocos", len(same))
	}
	b := clone(a)
	fill(b, image.Rect(130, 200, 135, 205), color.RGBA{0xff, 0, 0, 0xff})
	diff, _ := e.Encode(b, 60)
	if len(diff) != 1 || diff[0].X != 128 || diff[0].Y != 192 || diff[0].W != TileSize {
		t.Fatalf("esperado um bloco em (128,192): %+v", diff)
	}
}

func TestResetSendsEverything(t *testing.T) {
	var e Encoder
	a := officeFrame(200, 100, 3)
	_, _ = e.Encode(a, 60)
	e.Reset()
	tiles, _ := e.Encode(clone(a), 60)
	if len(tiles) == 0 {
		t.Fatal("depois de Reset o quadro inteiro deve ser enviado")
	}
}

func TestScale(t *testing.T) {
	src := officeFrame(1920, 1080, 4)
	dst := Scale(src, 0.5)
	if dst.Bounds().Dx() != 960 || dst.Bounds().Dy() != 540 {
		t.Fatalf("escala: %v", dst.Bounds())
	}
	if Scale(src, 1) != src {
		t.Fatal("escala 1 deve devolver o mesmo quadro")
	}
}

// Prova S2: custo de codificar a tela inteira (primeiro quadro, troca de janela).
func BenchmarkFullFrame1080p(b *testing.B) {
	frame := officeFrame(1920, 1080, 5)
	b.ReportAllocs()
	var bytesOut int
	for b.Loop() {
		var e Encoder
		tiles, err := e.Encode(frame, 50)
		if err != nil {
			b.Fatal(err)
		}
		bytesOut = 0
		for _, t := range tiles {
			bytesOut += len(t.JPEG)
		}
	}
	b.ReportMetric(float64(bytesOut)/1024, "KiB/quadro")
}

// Prova S2: uso tipico (digitacao e cursor alterando poucos blocos).
func BenchmarkTypingUpdate1080p(b *testing.B) {
	base := officeFrame(1920, 1080, 6)
	var e Encoder
	if _, err := e.Encode(base, 50); err != nil {
		b.Fatal(err)
	}
	next := clone(base)
	var bytesOut int
	b.ResetTimer()
	for i := 0; b.Loop(); i++ {
		fill(next, image.Rect(300+i%400, 500, 306+i%400, 512), color.RGBA{0, 0, 0, 0xff})
		tiles, err := e.Encode(next, 50)
		if err != nil {
			b.Fatal(err)
		}
		bytesOut = 0
		for _, t := range tiles {
			bytesOut += len(t.JPEG)
		}
		next = clone(next)
	}
	b.ReportMetric(float64(bytesOut)/1024, "KiB/quadro")
}

// Prova S2: comparacao sem mudancas (tela parada), o caso mais comum.
func BenchmarkIdleCompare1080p(b *testing.B) {
	base := officeFrame(1920, 1080, 7)
	var e Encoder
	_, _ = e.Encode(base, 50)
	same := clone(base)
	for b.Loop() {
		if _, err := e.Encode(same, 50); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkScaleHalf1080p(b *testing.B) {
	src := officeFrame(1920, 1080, 8)
	for b.Loop() {
		Scale(src, 0.5)
	}
}
