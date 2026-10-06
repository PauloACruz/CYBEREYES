// Package encode transforma quadros de tela em blocos JPEG para o canal desktop do acesso remoto
// (docs/remoto/contrato-remoto.md, secao 5.1): so os blocos alterados desde o quadro anterior sao
// codificados, e blocos vizinhos na mesma faixa sao juntados ate 256 px de largura.
package encode

import (
	"bytes"
	"image"
	"image/jpeg"
)

// TileSize e o lado do bloco usado na comparacao entre quadros.
const TileSize = 64

// MaxRectWidth e a largura maxima de um retangulo enviado (contrato: blocos de ate 256 x 256).
const MaxRectWidth = 256

// Tile e um retangulo codificado em JPEG, em coordenadas do quadro ja escalado.
type Tile struct {
	X, Y, W, H int
	JPEG       []byte
}

// Encoder guarda o ultimo quadro enviado para calcular a diferenca.
type Encoder struct {
	prev *image.RGBA
	buf  bytes.Buffer
}

// Reset descarta o quadro anterior: o proximo Encode envia a tela inteira.
func (e *Encoder) Reset() { e.prev = nil }

// Encode compara frame com o anterior e devolve os retangulos alterados em JPEG.
// quality vai de 1 a 100. frame nao pode ser alterado pelo chamador depois da chamada.
func (e *Encoder) Encode(frame *image.RGBA, quality int) ([]Tile, error) {
	quality = max(1, min(100, quality))
	b := frame.Bounds()
	if e.prev == nil || e.prev.Bounds() != b {
		e.prev = nil
	}
	cols := (b.Dx() + TileSize - 1) / TileSize
	rows := (b.Dy() + TileSize - 1) / TileSize
	var tiles []Tile
	for ty := 0; ty < rows; ty++ {
		y0 := b.Min.Y + ty*TileSize
		y1 := min(y0+TileSize, b.Max.Y)
		start := -1
		flush := func(endCol int) error {
			x0 := b.Min.X + start*TileSize
			x1 := min(b.Min.X+endCol*TileSize, b.Max.X)
			t, err := e.encodeRect(frame, image.Rect(x0, y0, x1, y1), quality)
			if err != nil {
				return err
			}
			tiles = append(tiles, t)
			start = -1
			return nil
		}
		for tx := 0; tx < cols; tx++ {
			x0 := b.Min.X + tx*TileSize
			r := image.Rect(x0, y0, min(x0+TileSize, b.Max.X), y1)
			if e.changed(frame, r) {
				if start < 0 {
					start = tx
				}
				if (tx-start+1)*TileSize >= MaxRectWidth {
					if err := flush(tx + 1); err != nil {
						return nil, err
					}
				}
				continue
			}
			if start >= 0 {
				if err := flush(tx); err != nil {
					return nil, err
				}
			}
		}
		if start >= 0 {
			if err := flush(cols); err != nil {
				return nil, err
			}
		}
	}
	e.prev = frame
	return tiles, nil
}

// changed compara o retangulo r entre o quadro novo e o anterior, linha a linha.
func (e *Encoder) changed(frame *image.RGBA, r image.Rectangle) bool {
	if e.prev == nil {
		return true
	}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		a := frame.PixOffset(r.Min.X, y)
		p := e.prev.PixOffset(r.Min.X, y)
		n := r.Dx() * 4
		if !bytes.Equal(frame.Pix[a:a+n], e.prev.Pix[p:p+n]) {
			return true
		}
	}
	return false
}

func (e *Encoder) encodeRect(frame *image.RGBA, r image.Rectangle, quality int) (Tile, error) {
	e.buf.Reset()
	sub := frame.SubImage(r)
	if err := jpeg.Encode(&e.buf, sub, &jpeg.Options{Quality: quality}); err != nil {
		return Tile{}, err
	}
	data := make([]byte, e.buf.Len())
	copy(data, e.buf.Bytes())
	b := frame.Bounds()
	return Tile{X: r.Min.X - b.Min.X, Y: r.Min.Y - b.Min.Y, W: r.Dx(), H: r.Dy(), JPEG: data}, nil
}

// Scale reduz src pela fracao s (0 < s <= 1) com media de area. Com s >= 1 devolve src.
func Scale(src *image.RGBA, s float64) *image.RGBA {
	if s >= 1 || s <= 0 {
		return src
	}
	b := src.Bounds()
	w := max(1, int(float64(b.Dx())*s))
	h := max(1, int(float64(b.Dy())*s))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		sy0 := b.Min.Y + y*b.Dy()/h
		sy1 := max(sy0+1, b.Min.Y+(y+1)*b.Dy()/h)
		for x := 0; x < w; x++ {
			sx0 := b.Min.X + x*b.Dx()/w
			sx1 := max(sx0+1, b.Min.X+(x+1)*b.Dx()/w)
			var r, g, bl, n uint32
			for sy := sy0; sy < sy1; sy++ {
				o := src.PixOffset(sx0, sy)
				for sx := sx0; sx < sx1; sx++ {
					r += uint32(src.Pix[o])
					g += uint32(src.Pix[o+1])
					bl += uint32(src.Pix[o+2])
					n++
					o += 4
				}
			}
			d := dst.PixOffset(x, y)
			dst.Pix[d] = uint8(r / n)
			dst.Pix[d+1] = uint8(g / n)
			dst.Pix[d+2] = uint8(bl / n)
			dst.Pix[d+3] = 0xff
		}
	}
	return dst
}
