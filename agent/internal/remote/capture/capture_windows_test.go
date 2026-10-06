//go:build windows

package capture

import (
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/windesk"
)

// openScreen abre a captura ou pula o teste sem area de trabalho interativa (servico na sessao 0).
func openScreen(t *testing.T) (*screen, Display) {
	t.Helper()
	sc, err := Open()
	if err != nil {
		t.Skipf("sem area de trabalho interativa: %v", err)
	}
	t.Cleanup(func() { sc.Close() })
	ds, err := sc.Displays()
	if err != nil || len(ds) == 0 {
		t.Skipf("sem monitores: %v %v", ds, err)
	}
	return sc.(*screen), Primary(ds)
}

func TestWindowsGrab(t *testing.T) {
	s, d := openScreen(t)
	g := AsGrabber(s)
	var f Frame
	for _, separate := range []bool{true, false, true} {
		start := time.Now()
		if err := g.Grab(d, &f, separate); err != nil {
			t.Fatalf("captura: %v", err)
		}
		if f.Img == nil || f.Img.Bounds().Dx() != d.W || f.Img.Bounds().Dy() != d.H {
			t.Fatalf("imagem %v, monitor %dx%d", f.Img.Bounds(), d.W, d.H)
		}
		t.Logf("metodo %s, cursor separado %v: %v", g.Backend(), separate, time.Since(start))
	}
	for i := 0; i < 5; i++ {
		start := time.Now()
		if err := g.Grab(d, &f, true); err != nil {
			t.Fatal(err)
		}
		t.Logf("captura %d: metodo %s, mudou %v, regioes %d, %v", i, g.Backend(), f.Changed, len(f.Dirty), time.Since(start))
		time.Sleep(50 * time.Millisecond)
	}
	c, err := g.Pointer(d)
	t.Logf("cursor: visivel %v em %d,%d, desenho %v, erro %v", c.Visible, c.X, c.Y, c.Shape != nil, err)
}

// TestDXGIMatchesGDI compara a imagem do DXGI com a do GDI: canais trocados ou passo de linha errado na conversao
// deixariam as duas muito diferentes.
func TestDXGIMatchesGDI(t *testing.T) {
	s, d := openScreen(t)
	var dup *dxgiDup
	err := windesk.Do(func(gen uint64) error {
		var err error
		dup, err = openDXGI(d)
		return err
	})
	if err != nil {
		t.Skipf("DXGI indisponivel: %v", err)
	}
	defer windesk.Do(func(uint64) error {
		dup.release()
		return nil
	})
	var fd Frame
	deadline := time.Now().Add(5 * time.Second)
	for dup.fresh && time.Now().Before(deadline) {
		var gerr error
		_ = windesk.Do(func(uint64) error {
			_, _, _, gerr = dup.grab(&fd)
			return nil
		})
		if gerr != nil {
			t.Skipf("DXGI falhou: %v", gerr)
		}
		time.Sleep(30 * time.Millisecond)
	}
	if dup.fresh {
		t.Skip("o DXGI nao entregou a primeira imagem em 5 s")
	}
	var fg Frame
	if err := s.gdi.grab(d, &fg, false); err != nil {
		t.Fatalf("GDI: %v", err)
	}
	if fd.Img.Bounds() != fg.Img.Bounds() {
		t.Fatalf("tamanhos diferentes: DXGI %v, GDI %v", fd.Img.Bounds(), fg.Img.Bounds())
	}
	same := 0
	px := len(fd.Img.Pix) / 4
	for i := 0; i < px; i++ {
		a, b := fd.Img.Pix[i*4:i*4+3], fg.Img.Pix[i*4:i*4+3]
		if a[0] == b[0] && a[1] == b[1] && a[2] == b[2] {
			same++
		}
	}
	pct := 100 * same / max(1, px)
	t.Logf("DXGI %v: %d%% dos pixels iguais ao GDI", fd.Img.Bounds(), pct)
	if pct < 60 {
		t.Fatalf("imagens do DXGI e do GDI muito diferentes (%d%% iguais)", pct)
	}
}
