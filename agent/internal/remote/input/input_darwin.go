//go:build darwin

package input

import (
	"errors"
	"image"
	"sync"
	"unicode/utf16"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/macos"
)

// Tipos de evento e campos do CoreGraphics.
const (
	evLeftDown     = 1
	evLeftUp       = 2
	evRightDown    = 3
	evRightUp      = 4
	evMoved        = 5
	evLeftDragged  = 6
	evRightDragged = 7
	evOtherDown    = 25
	evOtherUp      = 26
	evOtherDragged = 27
	hidTap         = 0
	scrollLine     = 1

	flagShift   = 0x20000
	flagControl = 0x40000
	flagOption  = 0x80000
	flagCommand = 0x100000
)

var modifierFlags = map[string]uint64{
	"ShiftLeft": flagShift, "ShiftRight": flagShift, "ControlLeft": flagControl, "ControlRight": flagControl,
	"AltLeft": flagOption, "AltRight": flagOption, "MetaLeft": flagCommand, "MetaRight": flagCommand,
}

// quartz injeta eventos pelo CGEventPost. As coordenadas sao em pontos: o monitor vem da captura com a origem em
// pontos e o tamanho em pixels, e a escala sai do CGDisplayBounds.
type quartz struct {
	mu      sync.Mutex
	held    map[string]bool
	buttons int
	x, y    float64
}

// Open confere a permissao de Acessibilidade, sem a qual o macOS descarta os eventos.
func Open() (Injector, error) {
	if err := macos.Load(); err != nil {
		return nil, err
	}
	if !macos.AXIsProcessTrusted() {
		return nil, errors.New("o EYES precisa da permissao de Acessibilidade (Ajustes do Sistema > Privacidade e Seguranca)")
	}
	return &quartz{held: map[string]bool{}}, nil
}

func (q *quartz) flags() uint64 {
	var f uint64
	for code := range q.held {
		f |= modifierFlags[code]
	}
	return f
}

func (q *quartz) post(ev uintptr) error {
	if ev == 0 {
		return errors.New("evento nao criado")
	}
	macos.CGEventSetFlags(ev, q.flags())
	macos.CGEventPost(hidTap, ev)
	macos.CFRelease(ev)
	return nil
}

func (q *quartz) Key(code string, down bool) error {
	k, ok := lookup(code)
	if !ok || k.mac == noMac {
		return ErrUnknownKey
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, mod := modifierFlags[code]; mod {
		if down {
			q.held[code] = true
		} else {
			delete(q.held, code)
		}
	}
	return q.post(macos.CGEventCreateKeyboardEvent(0, k.mac, down))
}

func (q *quartz) Text(s string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, r := range s {
		units := utf16.Encode([]rune{r})
		for _, down := range []bool{true, false} {
			ev := macos.CGEventCreateKeyboardEvent(0, 0, down)
			if ev == 0 {
				return errors.New("evento nao criado")
			}
			macos.CGEventKeyboardSetUnicodeString(ev, uintptr(len(units)), &units[0])
			macos.CGEventPost(hidTap, ev)
			macos.CFRelease(ev)
		}
	}
	return nil
}

// toPoints converte o pixel do monitor (area com origem em pontos e tamanho em pixels) para pontos globais.
func toPoints(area image.Rectangle, px, py int) (float64, float64) {
	px = max(0, min(px, area.Dx()-1))
	py = max(0, min(py, area.Dy()-1))
	scale := 1.0
	for _, id := range displays() {
		b := macos.CGDisplayBounds(id)
		if int(b.Origin.X) == area.Min.X && int(b.Origin.Y) == area.Min.Y && b.Size.W > 0 {
			scale = float64(area.Dx()) / b.Size.W
			break
		}
	}
	return float64(area.Min.X) + float64(px)/scale, float64(area.Min.Y) + float64(py)/scale
}

func displays() []uint32 {
	ids := make([]uint32, 16)
	var n uint32
	if macos.CGGetActiveDisplayList(uint32(len(ids)), &ids[0], &n) != 0 {
		return nil
	}
	return ids[:n]
}

func (q *quartz) Mouse(area image.Rectangle, px, py, buttons int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	x, y := toPoints(area, px, py)
	q.x, q.y = x, y
	at := macos.CGPoint{X: x, Y: y}
	move := uint32(evMoved)
	switch {
	case q.buttons&1 != 0 && buttons&1 != 0:
		move = evLeftDragged
	case q.buttons&2 != 0 && buttons&2 != 0:
		move = evRightDragged
	case q.buttons&4 != 0 && buttons&4 != 0:
		move = evOtherDragged
	}
	if err := q.post(macos.CGEventCreateMouseEvent(0, move, at, 0)); err != nil {
		return err
	}
	for _, b := range []struct {
		bit      int
		down, up uint32
		button   uint32
	}{{1, evLeftDown, evLeftUp, 0}, {2, evRightDown, evRightUp, 1}, {4, evOtherDown, evOtherUp, 2}} {
		was, now := q.buttons&b.bit != 0, buttons&b.bit != 0
		if was == now {
			continue
		}
		typ := b.down
		if !now {
			typ = b.up
		}
		if err := q.post(macos.CGEventCreateMouseEvent(0, typ, at, b.button)); err != nil {
			return err
		}
	}
	q.buttons = buttons
	return nil
}

// Wheel: dy positivo rola para baixo (como no navegador); no macOS o valor positivo rola para cima.
func (q *quartz) Wheel(dx, dy int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	lines := func(v int) int32 {
		if v == 0 {
			return 0
		}
		n := int32(v / 120)
		if n == 0 {
			if v > 0 {
				n = 1
			} else {
				n = -1
			}
		}
		return n
	}
	return q.post(macos.CGEventCreateScrollWheelEvent2(0, scrollLine, 2, -lines(dy), -lines(dx), 0))
}

func (q *quartz) Close() error { return nil }
