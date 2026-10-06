// Package encode transforma quadros de tela em blocos JPEG para o canal desktop do acesso remoto
// (docs/remoto/contrato-remoto.md, secao 5.1). So os blocos de 64 px alterados desde o ultimo quadro enviado
// sao codificados; blocos alterados vizinhos sao juntados em retangulos de ate 256 x 256 px e os retangulos
// sao codificados em paralelo.
//
// O Encoder guarda a propria copia do ultimo quadro enviado (o chamador pode reaproveitar o buffer da captura)
// e a qualidade usada em cada bloco, para o refinamento: com a tela parada, os blocos enviados com perda sao
// reenviados em qualidade alta (texto nitido sem gastar banda durante o movimento).
package encode

import (
	"bytes"
	"image"
	"image/jpeg"
	"runtime"
	"sync"
)

// TileSize e o lado do bloco usado na comparacao entre quadros.
const TileSize = 64

// MaxRectWidth e MaxRectHeight limitam o retangulo enviado (contrato: blocos de ate 256 x 256).
const (
	MaxRectWidth  = 256
	MaxRectHeight = 256
)

// Tile e um retangulo codificado em JPEG, em coordenadas do quadro ja escalado.
type Tile struct {
	X, Y, W, H int
	JPEG       []byte
}

// Encoder guarda o ultimo quadro enviado para calcular a diferenca. O valor zero esta pronto para uso.
type Encoder struct {
	prev    *image.RGBA // copia propria do ultimo quadro enviado
	quality []uint8     // qualidade usada no ultimo envio de cada bloco (0: nunca enviado)
	mark    []bool      // rascunho: blocos a enviar neste quadro
	cols    int
	rows    int
	scaled  *image.RGBA
	// Workers limita a codificacao em paralelo (0: ate 4 nucleos).
	Workers int
}

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// Reset descarta o quadro anterior: o proximo Encode envia a tela inteira.
func (e *Encoder) Reset() { e.prev = nil }

// Bounds devolve o tamanho do ultimo quadro enviado (vazio antes do primeiro).
func (e *Encoder) Bounds() image.Rectangle {
	if e.prev == nil {
		return image.Rectangle{}
	}
	return e.prev.Bounds()
}

func (e *Encoder) workers() int {
	if e.Workers > 0 {
		return e.Workers
	}
	return max(1, min(runtime.NumCPU(), 4))
}

// Encode compara frame com o ultimo quadro enviado e devolve os retangulos alterados em JPEG.
// hint, quando nao nulo, lista as unicas regioes que podem ter mudado (por exemplo os retangulos sujos do
// DXGI); o resto do quadro e considerado igual ao anterior. quality vai de 1 a 100.
func (e *Encoder) Encode(frame *image.RGBA, quality int, hint []image.Rectangle) ([]Tile, error) {
	quality = max(1, min(100, quality))
	b := frame.Bounds()
	full := e.prev == nil || e.prev.Bounds() != b
	if full {
		e.prev = image.NewRGBA(b)
		e.cols = (b.Dx() + TileSize - 1) / TileSize
		e.rows = (b.Dy() + TileSize - 1) / TileSize
		e.quality = make([]uint8, e.cols*e.rows)
		e.mark = make([]bool, e.cols*e.rows)
	}
	clear(e.mark)
	dirty := false
	if full {
		for i := range e.mark {
			e.mark[i] = true
		}
		dirty = len(e.mark) > 0
	} else if hint == nil {
		for ty := 0; ty < e.rows; ty++ {
			for tx := 0; tx < e.cols; tx++ {
				if e.changed(frame, e.tileRect(tx, ty)) {
					e.mark[ty*e.cols+tx] = true
					dirty = true
				}
			}
		}
	} else {
		for _, h := range hint {
			h = h.Intersect(b)
			if h.Empty() {
				continue
			}
			tx0, ty0 := (h.Min.X-b.Min.X)/TileSize, (h.Min.Y-b.Min.Y)/TileSize
			tx1, ty1 := (h.Max.X-b.Min.X-1)/TileSize, (h.Max.Y-b.Min.Y-1)/TileSize
			for ty := ty0; ty <= ty1; ty++ {
				for tx := tx0; tx <= tx1; tx++ {
					i := ty*e.cols + tx
					if !e.mark[i] && e.changed(frame, e.tileRect(tx, ty)) {
						e.mark[i] = true
						dirty = true
					}
				}
			}
		}
	}
	if !dirty {
		return nil, nil
	}
	tiles, err := e.encodeMarked(frame, quality)
	if err != nil {
		return nil, err
	}
	// Atualiza a copia do quadro enviado so nos blocos alterados.
	for i, m := range e.mark {
		if m {
			copyRect(e.prev, frame, e.tileRect(i%e.cols, i/e.cols))
			e.quality[i] = uint8(quality)
		}
	}
	return tiles, nil
}

// NeedsRefine informa se ha blocos enviados com qualidade menor que quality.
func (e *Encoder) NeedsRefine(quality int) bool {
	if e.prev == nil {
		return false
	}
	q := uint8(max(1, min(100, quality)))
	for _, v := range e.quality {
		if v != 0 && v < q {
			return true
		}
	}
	return false
}

// Refine reenvia em quality ate maxTiles blocos (0: todos) que foram enviados com qualidade menor, a partir da
// copia do ultimo quadro enviado, na ordem da tela. Em partes, o refinamento nao segura por muito tempo um quadro
// novo que chegue no meio. Devolve nil quando nao ha nada a refinar.
func (e *Encoder) Refine(quality, maxTiles int) ([]Tile, error) {
	if !e.NeedsRefine(quality) {
		return nil, nil
	}
	q := uint8(max(1, min(100, quality)))
	left := maxTiles
	for i, v := range e.quality {
		e.mark[i] = v != 0 && v < q && (maxTiles <= 0 || left > 0)
		if e.mark[i] {
			left--
		}
	}
	tiles, err := e.encodeMarked(e.prev, int(q))
	if err != nil {
		return nil, err
	}
	for i, m := range e.mark {
		if m {
			e.quality[i] = q
		}
	}
	return tiles, nil
}

func (e *Encoder) tileRect(tx, ty int) image.Rectangle {
	b := e.prev.Bounds()
	x0, y0 := b.Min.X+tx*TileSize, b.Min.Y+ty*TileSize
	return image.Rect(x0, y0, min(x0+TileSize, b.Max.X), min(y0+TileSize, b.Max.Y))
}

// changed compara o retangulo r entre o quadro novo e o ultimo enviado, linha a linha.
func (e *Encoder) changed(frame *image.RGBA, r image.Rectangle) bool {
	n := r.Dx() * 4
	for y := r.Min.Y; y < r.Max.Y; y++ {
		a := frame.PixOffset(r.Min.X, y)
		p := e.prev.PixOffset(r.Min.X, y)
		if !bytes.Equal(frame.Pix[a:a+n], e.prev.Pix[p:p+n]) {
			return true
		}
	}
	return false
}

// rects junta os blocos marcados em retangulos: faixas horizontais de ate MaxRectWidth, e faixas iguais em
// linhas seguidas viram um retangulo de ate MaxRectHeight.
func (e *Encoder) rects() []image.Rectangle {
	maxCols, maxRows := MaxRectWidth/TileSize, MaxRectHeight/TileSize
	type open struct {
		c0, c1, r0, rows int
	}
	var out []image.Rectangle
	b := e.prev.Bounds()
	toRect := func(o open) image.Rectangle {
		x0, y0 := b.Min.X+o.c0*TileSize, b.Min.Y+o.r0*TileSize
		return image.Rect(x0, y0, min(b.Min.X+o.c1*TileSize, b.Max.X), min(b.Min.Y+(o.r0+o.rows)*TileSize, b.Max.Y))
	}
	var prevRow []open
	for ty := 0; ty < e.rows; ty++ {
		var row []open
		for tx := 0; tx < e.cols; {
			if !e.mark[ty*e.cols+tx] {
				tx++
				continue
			}
			c0 := tx
			for tx < e.cols && e.mark[ty*e.cols+tx] && tx-c0 < maxCols {
				tx++
			}
			row = append(row, open{c0: c0, c1: tx, r0: ty, rows: 1})
		}
		// Estende para baixo os retangulos da linha anterior com a mesma faixa.
		next := make([]open, 0, len(row))
		used := make([]bool, len(prevRow))
		for _, r := range row {
			merged := false
			for i, p := range prevRow {
				if !used[i] && p.c0 == r.c0 && p.c1 == r.c1 && p.rows < maxRows {
					p.rows++
					used[i] = true
					next = append(next, p)
					merged = true
					break
				}
			}
			if !merged {
				next = append(next, r)
			}
		}
		for i, p := range prevRow {
			if !used[i] {
				out = append(out, toRect(p))
			}
		}
		prevRow = next
	}
	for _, p := range prevRow {
		out = append(out, toRect(p))
	}
	return out
}

// encodeMarked codifica os blocos marcados de src, em paralelo, preservando a ordem dos retangulos.
func (e *Encoder) encodeMarked(src *image.RGBA, quality int) ([]Tile, error) {
	rects := e.rects()
	tiles := make([]Tile, len(rects))
	errs := make([]error, len(rects))
	work := func(i int) {
		buf := bufPool.Get().(*bytes.Buffer)
		buf.Reset()
		r := rects[i]
		if err := jpeg.Encode(buf, src.SubImage(r), &jpeg.Options{Quality: quality}); err != nil {
			errs[i] = err
		} else {
			b := src.Bounds()
			tiles[i] = Tile{X: r.Min.X - b.Min.X, Y: r.Min.Y - b.Min.Y, W: r.Dx(), H: r.Dy(), JPEG: bytes.Clone(buf.Bytes())}
		}
		bufPool.Put(buf)
	}
	if n := e.workers(); n <= 1 || len(rects) == 1 {
		for i := range rects {
			work(i)
		}
	} else {
		var wg sync.WaitGroup
		sem := make(chan struct{}, n)
		for i := range rects {
			sem <- struct{}{}
			wg.Add(1)
			go func() {
				defer wg.Done()
				work(i)
				<-sem
			}()
		}
		wg.Wait()
	}
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return tiles, nil
}

func copyRect(dst, src *image.RGBA, r image.Rectangle) {
	n := r.Dx() * 4
	for y := r.Min.Y; y < r.Max.Y; y++ {
		d := dst.PixOffset(r.Min.X, y)
		s := src.PixOffset(r.Min.X, y)
		copy(dst.Pix[d:d+n], src.Pix[s:s+n])
	}
}

// Scale reduz src pela fracao s (0 < s <= 1) com media de area num buffer reaproveitado pelo Encoder.
// Com s >= 1 devolve src. O resultado vale ate a proxima chamada.
func (e *Encoder) Scale(src *image.RGBA, s float64) *image.RGBA {
	if s >= 1 || s <= 0 {
		return src
	}
	b := src.Bounds()
	w := max(1, int(float64(b.Dx())*s))
	h := max(1, int(float64(b.Dy())*s))
	if e.scaled == nil || e.scaled.Bounds().Dx() != w || e.scaled.Bounds().Dy() != h {
		e.scaled = image.NewRGBA(image.Rect(0, 0, w, h))
	}
	scaleInto(e.scaled, src, e.workers())
	return e.scaled
}

// Scale reduz src pela fracao s (0 < s <= 1) com media de area. Com s >= 1 devolve src.
func Scale(src *image.RGBA, s float64) *image.RGBA {
	var e Encoder
	return e.Scale(src, s)
}

// scaleInto preenche dst com a media de area de src, dividindo as linhas entre workers.
func scaleInto(dst, src *image.RGBA, workers int) {
	h := dst.Bounds().Dy()
	band := max(1, (h+workers-1)/workers)
	var wg sync.WaitGroup
	for y0 := 0; y0 < h; y0 += band {
		wg.Add(1)
		go func(y0, y1 int) {
			defer wg.Done()
			scaleRows(dst, src, y0, y1)
		}(y0, min(h, y0+band))
	}
	wg.Wait()
}

func scaleRows(dst, src *image.RGBA, y0, y1 int) {
	b := src.Bounds()
	w, h := dst.Bounds().Dx(), dst.Bounds().Dy()
	for y := y0; y < y1; y++ {
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
}
