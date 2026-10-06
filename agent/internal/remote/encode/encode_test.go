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
	tiles, err := e.Encode(officeFrame(300, 130, 1), 60, nil)
	if err != nil {
		t.Fatal(err)
	}
	area := 0
	for _, tl := range tiles {
		if tl.W > MaxRectWidth || tl.H > MaxRectHeight {
			t.Fatalf("bloco grande demais: %+v", tl)
		}
		img, err := jpeg.Decode(bytes.NewReader(tl.JPEG))
		if err != nil {
			t.Fatalf("JPEG invalido: %v", err)
		}
		if img.Bounds().Dx() != tl.W || img.Bounds().Dy() != tl.H {
			t.Fatalf("JPEG %v para bloco %dx%d", img.Bounds(), tl.W, tl.H)
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
	if _, err := e.Encode(a, 60, nil); err != nil {
		t.Fatal(err)
	}
	same, _ := e.Encode(clone(a), 60, nil)
	if len(same) != 0 {
		t.Fatalf("quadro igual gerou %d blocos", len(same))
	}
	b := clone(a)
	fill(b, image.Rect(130, 200, 135, 205), color.RGBA{0xff, 0, 0, 0xff})
	diff, _ := e.Encode(b, 60, nil)
	if len(diff) != 1 || diff[0].X != 128 || diff[0].Y != 192 || diff[0].W != TileSize || diff[0].H != TileSize {
		t.Fatalf("esperado um bloco em (128,192): %+v", diff)
	}
}

func TestCallerMayReuseFrameBuffer(t *testing.T) {
	// A captura reaproveita o mesmo buffer a cada quadro: o Encoder guarda a propria copia.
	var e Encoder
	buf := officeFrame(320, 200, 9)
	if _, err := e.Encode(buf, 60, nil); err != nil {
		t.Fatal(err)
	}
	fill(buf, image.Rect(10, 10, 20, 20), color.RGBA{0, 0xff, 0, 0xff})
	diff, _ := e.Encode(buf, 60, nil)
	if len(diff) != 1 || diff[0].X != 0 || diff[0].Y != 0 {
		t.Fatalf("mudanca no mesmo buffer nao detectada: %+v", diff)
	}
	if again, _ := e.Encode(buf, 60, nil); len(again) != 0 {
		t.Fatalf("quadro repetido gerou %d blocos", len(again))
	}
}

func TestHintLimitsComparison(t *testing.T) {
	var e Encoder
	a := officeFrame(640, 480, 10)
	_, _ = e.Encode(a, 60, nil)
	b := clone(a)
	fill(b, image.Rect(10, 10, 20, 20), color.RGBA{0xff, 0, 0, 0xff})
	fill(b, image.Rect(400, 300, 410, 310), color.RGBA{0xff, 0, 0, 0xff})
	tiles, _ := e.Encode(b, 60, []image.Rectangle{image.Rect(390, 290, 420, 320)})
	if len(tiles) != 1 || tiles[0].X != 384 || tiles[0].Y != 256 {
		t.Fatalf("so a regiao indicada deveria ser enviada: %+v", tiles)
	}
	// A regiao fora da dica continua pendente e aparece numa comparacao completa.
	rest, _ := e.Encode(b, 60, nil)
	if len(rest) != 1 || rest[0].X != 0 || rest[0].Y != 0 {
		t.Fatalf("mudanca fora da dica: %+v", rest)
	}
}

func TestNeighbourTilesMergeUpTo256(t *testing.T) {
	var e Encoder
	a := officeFrame(1024, 768, 11)
	_, _ = e.Encode(a, 60, nil)
	b := clone(a)
	fill(b, image.Rect(256, 256, 768, 768), color.RGBA{0x10, 0x20, 0x30, 0xff})
	tiles, _ := e.Encode(b, 60, nil)
	if len(tiles) != 4 {
		t.Fatalf("area de 512x512 deveria virar 4 blocos de 256x256: %d", len(tiles))
	}
	for _, tl := range tiles {
		if tl.W != 256 || tl.H != 256 {
			t.Fatalf("bloco %+v", tl)
		}
	}
}

func TestRefineResendsLossyTilesOnce(t *testing.T) {
	var e Encoder
	a := officeFrame(512, 256, 12)
	first, _ := e.Encode(a, 40, nil)
	if !e.NeedsRefine(90) {
		t.Fatal("blocos em qualidade 40 deveriam pedir refinamento")
	}
	refined, err := e.Refine(90, 0)
	if err != nil {
		t.Fatal(err)
	}
	area := 0
	for _, tl := range refined {
		area += tl.W * tl.H
	}
	if area != 512*256 || len(first) == 0 {
		t.Fatalf("refinamento cobriu %d px", area)
	}
	if e.NeedsRefine(90) {
		t.Fatal("depois do refinamento nada deveria ficar pendente")
	}
	b := clone(a)
	fill(b, image.Rect(5, 5, 9, 9), color.RGBA{0xff, 0xff, 0, 0xff})
	_, _ = e.Encode(b, 40, nil)
	again, _ := e.Refine(90, 0)
	if len(again) != 1 || again[0].W != TileSize || again[0].H != TileSize {
		t.Fatalf("so o bloco alterado deveria ser refinado: %+v", again)
	}
	if hi, _ := e.Refine(30, 0); hi != nil {
		t.Fatal("refinar para qualidade menor nao deve gerar blocos")
	}
}

func TestRefineInParts(t *testing.T) {
	var e Encoder
	_, _ = e.Encode(officeFrame(512, 256, 14), 40, nil) // 8x4 = 32 blocos
	total := 0
	for step := 0; e.NeedsRefine(90); step++ {
		if step > 4 {
			t.Fatal("refinamento em partes de 10 blocos deveria terminar em 4 passos")
		}
		part, err := e.Refine(90, 10)
		if err != nil {
			t.Fatal(err)
		}
		area := 0
		for _, tl := range part {
			area += tl.W * tl.H
		}
		if area > 10*TileSize*TileSize {
			t.Fatalf("passo %d refinou %d px, acima de 10 blocos", step, area)
		}
		total += area
	}
	if total != 512*256 {
		t.Fatalf("as partes deveriam cobrir a tela: %d px", total)
	}
}

func TestParallelMatchesSequential(t *testing.T) {
	frame := officeFrame(1280, 720, 13)
	seq := Encoder{Workers: 1}
	par := Encoder{Workers: 4}
	a, _ := seq.Encode(frame, 55, nil)
	b, _ := par.Encode(frame, 55, nil)
	if len(a) != len(b) {
		t.Fatalf("%d x %d blocos", len(a), len(b))
	}
	for i := range a {
		if a[i].X != b[i].X || a[i].Y != b[i].Y || !bytes.Equal(a[i].JPEG, b[i].JPEG) {
			t.Fatalf("bloco %d difere", i)
		}
	}
}

func TestResetSendsEverything(t *testing.T) {
	var e Encoder
	a := officeFrame(200, 100, 3)
	_, _ = e.Encode(a, 60, nil)
	e.Reset()
	tiles, _ := e.Encode(clone(a), 60, nil)
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
	var e Encoder
	if e.Scale(src, 0.5) != e.Scale(src, 0.5) {
		t.Fatal("o Encoder deve reaproveitar o buffer da escala")
	}
}

// Prova S2: custo de codificar a tela inteira (primeiro quadro, troca de janela).
func benchmarkFull(b *testing.B, workers int) {
	frame := officeFrame(1920, 1080, 5)
	b.ReportAllocs()
	var bytesOut int
	for b.Loop() {
		e := Encoder{Workers: workers}
		tiles, err := e.Encode(frame, 50, nil)
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

func BenchmarkFullFrame1080p(b *testing.B)         { benchmarkFull(b, 1) }
func BenchmarkFullFrame1080pParallel(b *testing.B) { benchmarkFull(b, 0) }

// Prova S2: uso tipico (digitacao alterando poucos blocos), com o mesmo buffer de captura reaproveitado.
func BenchmarkTypingUpdate1080p(b *testing.B) {
	next := officeFrame(1920, 1080, 6)
	var e Encoder
	if _, err := e.Encode(next, 50, nil); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	var bytesOut int
	b.ResetTimer()
	for i := 0; b.Loop(); i++ {
		fill(next, image.Rect(300+i%400, 500, 306+i%400, 512), color.RGBA{0, 0, 0, 0xff})
		tiles, err := e.Encode(next, 50, nil)
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

// Prova S2: comparacao sem mudancas (tela parada), o caso mais comum.
func BenchmarkIdleCompare1080p(b *testing.B) {
	base := officeFrame(1920, 1080, 7)
	var e Encoder
	_, _ = e.Encode(base, 50, nil)
	same := clone(base)
	b.ReportAllocs()
	for b.Loop() {
		if _, err := e.Encode(same, 50, nil); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkScaleHalf1080p(b *testing.B) {
	src := officeFrame(1920, 1080, 8)
	var e Encoder
	b.ReportAllocs()
	for b.Loop() {
		e.Scale(src, 0.5)
	}
}
