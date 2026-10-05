//go:build linux

package input

import (
	"fmt"
	"image"
	"sync"
	"time"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/xproto"
	"github.com/jezek/xgb/xtest"

	_ "github.com/pauloacruz/cybereyes/agent/internal/remote/x11util"
)

// x11 injeta eventos pela extensao XTEST, em Go puro.
type x11 struct {
	mu       sync.Mutex
	conn     *xgb.Conn
	root     xproto.Window
	minCode  xproto.Keycode
	maxCode  xproto.Keycode
	buttons  int
	mapping  []xproto.Keysym
	perCode  int
	spare    xproto.Keycode
	shiftKey xproto.Keycode
}

// Open conecta ao servidor X do DISPLAY atual.
func Open() (Injector, error) {
	conn, err := xgb.NewConn()
	if err != nil {
		return nil, fmt.Errorf("conexao X11: %w", err)
	}
	if err := xtest.Init(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("extensao XTEST ausente: %w", err)
	}
	setup := xproto.Setup(conn)
	x := &x11{conn: conn, root: setup.DefaultScreen(conn).Root, minCode: setup.MinKeycode, maxCode: setup.MaxKeycode}
	if err := x.loadMapping(); err != nil {
		conn.Close()
		return nil, err
	}
	return x, nil
}

func (x *x11) loadMapping() error {
	count := byte(x.maxCode - x.minCode + 1)
	reply, err := xproto.GetKeyboardMapping(x.conn, x.minCode, count).Reply()
	if err != nil {
		return fmt.Errorf("mapa do teclado: %w", err)
	}
	x.mapping, x.perCode = reply.Keysyms, int(reply.KeysymsPerKeycode)
	x.spare = 0
	for code := int(x.maxCode); code >= int(x.minCode); code-- {
		if x.symsOf(xproto.Keycode(code))[0] == 0 {
			x.spare = xproto.Keycode(code)
			break
		}
	}
	x.shiftKey = 42 + 8
	return nil
}

func (x *x11) symsOf(code xproto.Keycode) []xproto.Keysym {
	i := int(code-x.minCode) * x.perCode
	return x.mapping[i : i+x.perCode]
}

func (x *x11) fake(kind byte, detail byte, rx, ry int16) error {
	return xtest.FakeInputChecked(x.conn, kind, detail, 0, x.root, rx, ry, 0).Check()
}

func (x *x11) Key(code string, down bool) error {
	k, ok := lookup(code)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownKey, code)
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	kind := byte(xproto.KeyPress)
	if !down {
		kind = xproto.KeyRelease
	}
	return x.fake(kind, byte(k.evdev+8), 0, 0)
}

// keysymFor converte um rune no keysym do X11 (Latin-1 direto; demais com o prefixo Unicode 0x01000000).
func keysymFor(r rune) xproto.Keysym {
	switch r {
	case '\n', '\r':
		return 0xff0d
	case '\t':
		return 0xff09
	case '\b':
		return 0xff08
	}
	if r >= 0x20 && r <= 0xff {
		return xproto.Keysym(r)
	}
	return xproto.Keysym(0x01000000 | uint32(r))
}

func (x *x11) Text(s string) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	for _, r := range s {
		if err := x.typeRune(r); err != nil {
			return err
		}
	}
	return nil
}

func (x *x11) typeRune(r rune) error {
	sym := keysymFor(r)
	for code := x.minCode; ; code++ {
		syms := x.symsOf(code)
		for col := 0; col < min(2, len(syms)); col++ {
			if syms[col] == sym {
				return x.tap(code, col == 1)
			}
		}
		if code == x.maxCode {
			break
		}
	}
	// Sem tecla para o caractere: usa uma tecla livre remapeada so durante o toque.
	if x.spare == 0 {
		return fmt.Errorf("sem tecla livre para digitar %q", r)
	}
	syms := make([]xproto.Keysym, x.perCode)
	syms[0], syms[1] = sym, sym
	if err := xproto.ChangeKeyboardMappingChecked(x.conn, 1, x.spare, byte(x.perCode), syms).Check(); err != nil {
		return err
	}
	// O servidor precisa ver o mapa novo antes do toque.
	time.Sleep(15 * time.Millisecond)
	err := x.tap(x.spare, false)
	time.Sleep(15 * time.Millisecond)
	_ = xproto.ChangeKeyboardMappingChecked(x.conn, 1, x.spare, byte(x.perCode), make([]xproto.Keysym, x.perCode)).Check()
	return err
}

func (x *x11) tap(code xproto.Keycode, shift bool) error {
	if shift {
		if err := x.fake(xproto.KeyPress, byte(x.shiftKey), 0, 0); err != nil {
			return err
		}
		defer x.fake(xproto.KeyRelease, byte(x.shiftKey), 0, 0)
	}
	if err := x.fake(xproto.KeyPress, byte(code), 0, 0); err != nil {
		return err
	}
	return x.fake(xproto.KeyRelease, byte(code), 0, 0)
}

// xButtons liga os bits de MouseEvent.buttons aos botoes do X11 (1 esquerdo, 2 meio, 3 direito).
var xButtons = []struct{ bit, button int }{{1, 1}, {2, 3}, {4, 2}}

func (x *x11) Mouse(area image.Rectangle, px, py, buttons int) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	rx := int16(area.Min.X + max(0, min(px, area.Dx()-1)))
	ry := int16(area.Min.Y + max(0, min(py, area.Dy()-1)))
	if err := x.fake(xproto.MotionNotify, 0, rx, ry); err != nil {
		return err
	}
	for _, b := range xButtons {
		was, now := x.buttons&b.bit != 0, buttons&b.bit != 0
		if was == now {
			continue
		}
		kind := byte(xproto.ButtonPress)
		if !now {
			kind = xproto.ButtonRelease
		}
		if err := x.fake(kind, byte(b.button), 0, 0); err != nil {
			return err
		}
	}
	x.buttons = buttons
	return nil
}

func (x *x11) Wheel(dx, dy int) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	click := func(button byte, n int) error {
		for i := 0; i < n; i++ {
			if err := x.fake(xproto.ButtonPress, button, 0, 0); err != nil {
				return err
			}
			if err := x.fake(xproto.ButtonRelease, button, 0, 0); err != nil {
				return err
			}
		}
		return nil
	}
	steps := func(v int) int { return max(1, abs(v)/120) }
	if dy != 0 {
		b := byte(5)
		if dy < 0 {
			b = 4
		}
		if err := click(b, steps(dy)); err != nil {
			return err
		}
	}
	if dx != 0 {
		b := byte(7)
		if dx < 0 {
			b = 6
		}
		return click(b, steps(dx))
	}
	return nil
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func (x *x11) Close() error {
	x.conn.Close()
	return nil
}
