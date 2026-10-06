//go:build linux

package capture

import (
	"fmt"
	"image"
	"os"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/randr"
	"github.com/jezek/xgb/xfixes"
	"github.com/jezek/xgb/xproto"

	_ "github.com/pauloacruz/cybereyes/agent/internal/remote/x11util"
)

// x11 captura pelo protocolo X11 (GetImage na janela raiz), em Go puro.
type x11 struct {
	conn  *xgb.Conn
	root  xproto.Window
	width int
	heigh int
	depth byte
	randr bool
	// cursor: XFixes disponivel para desenhar o ponteiro (o GetImage nao inclui o cursor).
	cursor      bool
	shape       *CursorShape
	shapeSerial uint32
}

// Open conecta ao servidor X do DISPLAY atual. Sessoes Wayland sem Xwayland na tela inteira
// nao sao suportadas na v1 (RFC-001, D-06).
func Open() (Screen, error) {
	if os.Getenv("WAYLAND_DISPLAY") != "" && os.Getenv("XDG_SESSION_TYPE") == "wayland" {
		return nil, fmt.Errorf("%w: sessao Wayland", ErrUnsupported)
	}
	conn, err := xgb.NewConn()
	if err != nil {
		return nil, fmt.Errorf("conexao X11: %w", err)
	}
	setup := xproto.Setup(conn)
	scr := setup.DefaultScreen(conn)
	s := &x11{conn: conn, root: scr.Root, width: int(scr.WidthInPixels), heigh: int(scr.HeightInPixels), depth: scr.RootDepth}
	if randr.Init(conn) == nil {
		s.randr = true
	}
	if xfixes.Init(conn) == nil {
		if _, err := xfixes.QueryVersion(conn, 4, 0).Reply(); err == nil {
			s.cursor = true
		}
	}
	return s, nil
}

func (s *x11) Displays() ([]Display, error) {
	if s.randr {
		if reply, err := randr.GetMonitors(s.conn, s.root, true).Reply(); err == nil && len(reply.Monitors) > 0 {
			out := make([]Display, 0, len(reply.Monitors))
			for i, m := range reply.Monitors {
				name := ""
				if n, err := xproto.GetAtomName(s.conn, m.Name).Reply(); err == nil {
					name = n.Name
				}
				out = append(out, Display{ID: i, Name: name, X: int(m.X), Y: int(m.Y), W: int(m.Width), H: int(m.Height), Scale: 1, Primary: m.Primary})
			}
			if !anyPrimary(out) {
				out[0].Primary = true
			}
			return out, nil
		}
	}
	return []Display{{ID: 0, Name: "screen", W: s.width, H: s.heigh, Scale: 1, Primary: true}}, nil
}

func anyPrimary(ds []Display) bool {
	for _, d := range ds {
		if d.Primary {
			return true
		}
	}
	return false
}

func (s *x11) Capture(d Display) (*image.RGBA, error) {
	var f Frame
	if err := s.Grab(d, &f, false); err != nil {
		return nil, err
	}
	return f.Img, nil
}

// Backend e Polling: o X11 precisa reler a tela para descobrir mudancas.
func (s *x11) Backend() string { return "x11" }
func (s *x11) Polling() bool   { return true }

// Grab captura o monitor no Frame reaproveitado. Com separateCursor o ponteiro nao entra na imagem e vai em
// f.Cursor (desenho do XFixes).
func (s *x11) Grab(d Display, f *Frame, separateCursor bool) error {
	if d.W <= 0 || d.H <= 0 {
		d = Display{W: s.width, H: s.heigh}
	}
	img := ensureImage(f, d.W, d.H)
	// Faixas de ate 256 linhas: mantem cada resposta abaixo do limite de requisicao sem BIG-REQUESTS.
	const band = 256
	for y := 0; y < d.H; y += band {
		h := min(band, d.H-y)
		reply, err := xproto.GetImage(s.conn, xproto.ImageFormatZPixmap, xproto.Drawable(s.root),
			int16(d.X), int16(d.Y+y), uint16(d.W), uint16(h), 0xffffffff).Reply()
		if err != nil {
			return fmt.Errorf("GetImage: %w", err)
		}
		if err := bgrxToRGBA(img, y, d.W, h, reply.Data); err != nil {
			return err
		}
	}
	f.Changed, f.Dirty, f.Cursor = true, nil, Cursor{}
	if !s.cursor {
		return nil
	}
	c, err := xfixes.GetCursorImage(s.conn).Reply()
	if err != nil {
		return nil
	}
	if separateCursor {
		f.Cursor = s.toCursor(c, d)
		return nil
	}
	drawCursor(img, int(c.X)-int(c.Xhot)-d.X, int(c.Y)-int(c.Yhot)-d.Y, int(c.Width), int(c.Height), c.CursorImage)
	return nil
}

// Pointer le so o cursor (posicao e desenho) pelo XFixes.
func (s *x11) Pointer(d Display) (Cursor, error) {
	if !s.cursor {
		return Cursor{}, ErrUnsupported
	}
	c, err := xfixes.GetCursorImage(s.conn).Reply()
	if err != nil {
		return Cursor{}, err
	}
	return s.toCursor(c, d), nil
}

func (s *x11) toCursor(c *xfixes.GetCursorImageReply, d Display) Cursor {
	out := Cursor{Visible: true, X: int(c.X) - d.X, Y: int(c.Y) - d.Y}
	if s.shape != nil && s.shapeSerial == c.CursorSerial {
		out.Shape = s.shape
		return out
	}
	w, h := int(c.Width), int(c.Height)
	if w <= 0 || h <= 0 || w > 256 || h > 256 || len(c.CursorImage) < w*h {
		return out
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i, v := range c.CursorImage[:w*h] {
		a := v >> 24
		p := img.Pix[i*4 : i*4+4]
		if a == 0 {
			continue
		}
		// ARGB pre-multiplicado para RGBA comum.
		p[0] = uint8(min(255, ((v>>16)&0xff)*255/a))
		p[1] = uint8(min(255, ((v>>8)&0xff)*255/a))
		p[2] = uint8(min(255, (v&0xff)*255/a))
		p[3] = uint8(a)
	}
	s.shape, s.shapeSerial = NewCursorShape(img, int(c.Xhot), int(c.Yhot)), c.CursorSerial
	out.Shape = s.shape
	return out
}

// drawCursor mistura o cursor do XFixes (ARGB pre-multiplicado, um uint32 por pixel) na imagem, em (x, y).
func drawCursor(img *image.RGBA, x, y, w, h int, argb []uint32) {
	b := img.Bounds()
	for cy := 0; cy < h; cy++ {
		for cx := 0; cx < w; cx++ {
			px, py := x+cx, y+cy
			i := cy*w + cx
			if px < b.Min.X || py < b.Min.Y || px >= b.Max.X || py >= b.Max.Y || i >= len(argb) {
				continue
			}
			v := argb[i]
			a := v >> 24
			if a == 0 {
				continue
			}
			o := img.PixOffset(px, py)
			inv := 255 - a
			img.Pix[o] = uint8((v>>16)&0xff + uint32(img.Pix[o])*inv/255)
			img.Pix[o+1] = uint8((v>>8)&0xff + uint32(img.Pix[o+1])*inv/255)
			img.Pix[o+2] = uint8(v&0xff + uint32(img.Pix[o+2])*inv/255)
		}
	}
}

// bgrxToRGBA converte o formato ZPixmap de 32 bits (B, G, R, x) usado em profundidade 24 e 32.
func bgrxToRGBA(img *image.RGBA, y0, w, h int, data []byte) error {
	if len(data) < w*h*4 {
		return fmt.Errorf("imagem X11 em formato nao suportado (%d bytes para %dx%d)", len(data), w, h)
	}
	for y := 0; y < h; y++ {
		src := data[y*w*4 : (y+1)*w*4]
		dst := img.Pix[img.PixOffset(0, y0+y):]
		for x := 0; x < w; x++ {
			dst[x*4] = src[x*4+2]
			dst[x*4+1] = src[x*4+1]
			dst[x*4+2] = src[x*4]
			dst[x*4+3] = 0xff
		}
	}
	return nil
}

func (s *x11) Close() error {
	s.conn.Close()
	return nil
}
