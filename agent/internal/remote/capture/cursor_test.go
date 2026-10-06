package capture

import (
	"bytes"
	"image"
	"testing"
)

// px monta um pixel BGRA.
func px(b, g, r byte) []byte { return []byte{b, g, r, 0xff} }

func TestShapeFromBackgrounds(t *testing.T) {
	// 4 pixels: transparente, vermelho opaco, cinza 50% (preto sobre fundo), inversao.
	black := bytes.Join([][]byte{px(0, 0, 0), px(0, 0, 0xff), px(0, 0, 0), px(0xff, 0xff, 0xff)}, nil)
	white := bytes.Join([][]byte{px(0xff, 0xff, 0xff), px(0, 0, 0xff), px(0x80, 0x80, 0x80), px(0, 0, 0)}, nil)
	img := image.NewRGBA(image.Rect(0, 0, 4, 1))
	shapeFromBackgrounds(img, black, white)
	want := [][4]byte{{0xff, 0xff, 0xff, 0xff}, {0xff, 0, 0, 0xff}, {0, 0, 0, 0x7f}, {0, 0, 0, 0xff}}
	for i, w := range want {
		got := [4]byte(img.Pix[i*4 : i*4+4])
		if i == 0 {
			// Vizinho de um pixel de inversao? Nao: o pixel 0 nao e vizinho do 3. Deve ficar transparente.
			w = [4]byte{0, 0, 0, 0}
		}
		if got != w {
			t.Fatalf("pixel %d: %v, esperado %v", i, got, w)
		}
	}
}

func TestInvertPixelsGetWhiteOutline(t *testing.T) {
	// 3x1: transparente, inversao, transparente -> contorno branco nos dois lados.
	black := bytes.Join([][]byte{px(0, 0, 0), px(0xff, 0xff, 0xff), px(0, 0, 0)}, nil)
	white := bytes.Join([][]byte{px(0xff, 0xff, 0xff), px(0, 0, 0), px(0xff, 0xff, 0xff)}, nil)
	img := image.NewRGBA(image.Rect(0, 0, 3, 1))
	shapeFromBackgrounds(img, black, white)
	if img.Pix[3] != 0xff || img.Pix[0] != 0xff || img.Pix[4] != 0 || img.Pix[8] != 0xff {
		t.Fatalf("contorno: %v", img.Pix)
	}
}

func TestCompositeAndRestore(t *testing.T) {
	desk := image.NewRGBA(image.Rect(0, 0, 10, 10))
	for i := range desk.Pix {
		desk.Pix[i] = 0x40
	}
	orig := append([]byte(nil), desk.Pix...)
	shapeImg := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for i := 0; i < len(shapeImg.Pix); i += 4 {
		shapeImg.Pix[i], shapeImg.Pix[i+3] = 0xff, 0xff
	}
	c := Cursor{Visible: true, X: 9, Y: 9, Shape: NewCursorShape(shapeImg, 1, 1)}
	p := compositeCursor(desk, c)
	if p.rect != image.Rect(8, 8, 10, 10) {
		t.Fatalf("retangulo %v", p.rect)
	}
	if desk.Pix[desk.PixOffset(9, 9)] != 0xff {
		t.Fatal("cursor nao foi desenhado")
	}
	p.restore(desk)
	if !bytes.Equal(desk.Pix, orig) {
		t.Fatal("restauracao deveria devolver a imagem original")
	}
	// Cursor fora da tela nao desenha nada.
	if q := compositeCursor(desk, Cursor{Visible: true, X: 50, Y: 50, Shape: c.Shape}); !q.rect.Empty() {
		t.Fatalf("fora da tela: %v", q.rect)
	}
}

func TestCursorShapeIDDependsOnContent(t *testing.T) {
	a := image.NewRGBA(image.Rect(0, 0, 2, 2))
	b := image.NewRGBA(image.Rect(0, 0, 2, 2))
	if NewCursorShape(a, 0, 0).ID != NewCursorShape(b, 0, 0).ID {
		t.Fatal("desenhos iguais devem ter o mesmo id")
	}
	b.Pix[0] = 1
	if NewCursorShape(a, 0, 0).ID == NewCursorShape(b, 0, 0).ID {
		t.Fatal("desenhos diferentes devem ter ids diferentes")
	}
	if NewCursorShape(a, 0, 0).ID == NewCursorShape(a, 1, 0).ID {
		t.Fatal("ponto ativo diferente deve mudar o id")
	}
}
