//go:build linux

package capture

import (
	"fmt"
	"image"
	"os"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/randr"
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
	if d.W <= 0 || d.H <= 0 {
		d = Display{W: s.width, H: s.heigh}
	}
	img := image.NewRGBA(image.Rect(0, 0, d.W, d.H))
	// Faixas de ate 256 linhas: mantem cada resposta abaixo do limite de requisicao sem BIG-REQUESTS.
	const band = 256
	for y := 0; y < d.H; y += band {
		h := min(band, d.H-y)
		reply, err := xproto.GetImage(s.conn, xproto.ImageFormatZPixmap, xproto.Drawable(s.root),
			int16(d.X), int16(d.Y+y), uint16(d.W), uint16(h), 0xffffffff).Reply()
		if err != nil {
			return nil, fmt.Errorf("GetImage: %w", err)
		}
		if err := bgrxToRGBA(img, y, d.W, h, reply.Data); err != nil {
			return nil, err
		}
	}
	return img, nil
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
