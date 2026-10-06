package capture

import "image"

// shapeFromBackgrounds monta o cursor em RGBA a partir de dois desenhos dele em BGRA: sobre preto e sobre branco.
// Sobre preto um pixel vale a*C; sobre branco vale a*C + (1-a)*255; a diferenca da a transparencia a. Pixels que
// ficam mais escuros sobre o branco que sobre o preto sao de inversao (cursor de texto): viram preto opaco com um
// contorno branco, para aparecer em qualquer fundo.
func shapeFromBackgrounds(dst *image.RGBA, black, white []byte) {
	b := dst.Bounds()
	w, h := b.Dx(), b.Dy()
	invert := make([]bool, w*h)
	for i := 0; i < w*h; i++ {
		o := i * 4
		if o+3 >= len(black) || o+3 >= len(white) {
			break
		}
		bb, bg, br := int(black[o]), int(black[o+1]), int(black[o+2])
		wb, wg, wr := int(white[o]), int(white[o+1]), int(white[o+2])
		diff := ((wr - br) + (wg - bg) + (wb - bb)) / 3
		d := dst.Pix[i*4 : i*4+4]
		switch {
		case diff < -64:
			invert[i] = true
			d[0], d[1], d[2], d[3] = 0, 0, 0, 0xff
		case diff >= 255:
			d[0], d[1], d[2], d[3] = 0, 0, 0, 0
		default:
			a := 255 - max(0, diff)
			d[0] = uint8(min(255, br*255/a))
			d[1] = uint8(min(255, bg*255/a))
			d[2] = uint8(min(255, bb*255/a))
			d[3] = uint8(a)
		}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if !invert[y*w+x] {
				continue
			}
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := x+dx, y+dy
					if nx < 0 || ny < 0 || nx >= w || ny >= h || invert[ny*w+nx] {
						continue
					}
					p := dst.Pix[(ny*w+nx)*4:]
					if p[3] == 0 {
						p[0], p[1], p[2], p[3] = 0xff, 0xff, 0xff, 0xff
					}
				}
			}
		}
	}
}

// cursorPatch guarda os pixels da imagem que ficaram sob o cursor desenhado.
type cursorPatch struct {
	rect image.Rectangle
	pix  []byte
}

// restore devolve os pixels guardados para a imagem (apaga o cursor desenhado antes).
func (p *cursorPatch) restore(img *image.RGBA) {
	if p.rect.Empty() || !p.rect.In(img.Bounds()) {
		return
	}
	n := p.rect.Dx() * 4
	for y := p.rect.Min.Y; y < p.rect.Max.Y; y++ {
		o := img.PixOffset(p.rect.Min.X, y)
		copy(img.Pix[o:o+n], p.pix[(y-p.rect.Min.Y)*n:])
	}
}

// compositeCursor desenha o cursor na imagem (mistura pela transparencia) e devolve os pixels de baixo.
func compositeCursor(img *image.RGBA, c Cursor) cursorPatch {
	s := c.Shape
	if s == nil || s.Img == nil {
		return cursorPatch{}
	}
	sb := s.Img.Bounds()
	at := image.Rect(c.X-s.HotX, c.Y-s.HotY, c.X-s.HotX+sb.Dx(), c.Y-s.HotY+sb.Dy())
	r := at.Intersect(img.Bounds())
	if r.Empty() {
		return cursorPatch{}
	}
	n := r.Dx() * 4
	p := cursorPatch{rect: r, pix: make([]byte, n*r.Dy())}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		o := img.PixOffset(r.Min.X, y)
		copy(p.pix[(y-r.Min.Y)*n:], img.Pix[o:o+n])
		for x := r.Min.X; x < r.Max.X; x++ {
			sp := s.Img.Pix[s.Img.PixOffset(x-at.Min.X, y-at.Min.Y):]
			a := int(sp[3])
			if a == 0 {
				continue
			}
			dp := img.Pix[img.PixOffset(x, y):]
			for k := 0; k < 3; k++ {
				dp[k] = uint8((int(sp[k])*a + int(dp[k])*(255-a)) / 255)
			}
		}
	}
	return p
}
