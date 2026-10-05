package input

import (
	"errors"
	"image"
	"sync"
)

// Injector envia eventos de teclado e mouse para a sessao grafica do usuario.
type Injector interface {
	// Key pressiona ou solta a tecla fisica code (KeyboardEvent.code).
	Key(code string, down bool) error
	// Text digita texto Unicode, sem depender do layout.
	Text(s string) error
	// Mouse move o ponteiro para (x, y) do monitor area e aplica os botoes (bits de MouseEvent.buttons).
	Mouse(area image.Rectangle, x, y, buttons int) error
	// Wheel rola dx e dy em unidades de 1/120 de clique.
	Wheel(dx, dy int) error
	Close() error
}

// ErrUnknownKey indica um code sem traducao.
var ErrUnknownKey = errors.New("tecla desconhecida")

// Tracker guarda o que esta pressionado para soltar tudo no fim da sessao (contrato, secao 5.2).
type Tracker struct {
	Injector
	mu      sync.Mutex
	keys    map[string]bool
	buttons int
	area    image.Rectangle
	x, y    int
}

// Track embrulha um Injector.
func Track(in Injector) *Tracker { return &Tracker{Injector: in, keys: map[string]bool{}} }

func (t *Tracker) Key(code string, down bool) error {
	t.mu.Lock()
	if down {
		t.keys[code] = true
	} else {
		delete(t.keys, code)
	}
	t.mu.Unlock()
	return t.Injector.Key(code, down)
}

func (t *Tracker) Mouse(area image.Rectangle, x, y, buttons int) error {
	t.mu.Lock()
	t.buttons, t.area, t.x, t.y = buttons, area, x, y
	t.mu.Unlock()
	return t.Injector.Mouse(area, x, y, buttons)
}

// ReleaseAll solta teclas e botoes ainda pressionados.
func (t *Tracker) ReleaseAll() {
	t.mu.Lock()
	codes := make([]string, 0, len(t.keys))
	for c := range t.keys {
		codes = append(codes, c)
	}
	t.keys = map[string]bool{}
	buttons, area, x, y := t.buttons, t.area, t.x, t.y
	t.buttons = 0
	t.mu.Unlock()
	for _, c := range codes {
		_ = t.Injector.Key(c, false)
	}
	if buttons != 0 {
		_ = t.Injector.Mouse(area, x, y, 0)
	}
}
