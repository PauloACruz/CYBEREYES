//go:build linux

package clip

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/xfixes"
	"github.com/jezek/xgb/xproto"

	_ "github.com/pauloacruz/cybereyes/agent/internal/remote/x11util"
)

// maxProperty limita o que servimos numa unica propriedade (sem o protocolo INCR do X11).
const maxProperty = 200 * 1024

type x11 struct {
	conn    *xgb.Conn
	win     xproto.Window
	atoms   map[string]xproto.Atom
	changes chan struct{}
	notify  chan xproto.SelectionNotifyEvent
	done    chan struct{}

	mu    sync.Mutex
	owned *string
	read  sync.Mutex
}

// Open conecta ao servidor X do DISPLAY atual e acompanha a selecao CLIPBOARD pelo XFixes.
func Open() (Board, error) {
	if os.Getenv("WAYLAND_DISPLAY") != "" && os.Getenv("XDG_SESSION_TYPE") == "wayland" {
		return nil, fmt.Errorf("%w: sessao Wayland", ErrUnsupported)
	}
	conn, err := xgb.NewConn()
	if err != nil {
		return nil, fmt.Errorf("conexao X11: %w", err)
	}
	b := &x11{conn: conn, atoms: map[string]xproto.Atom{}, changes: make(chan struct{}, 1), notify: make(chan xproto.SelectionNotifyEvent, 1), done: make(chan struct{})}
	if err := b.setup(); err != nil {
		conn.Close()
		return nil, err
	}
	go b.loop()
	return b, nil
}

func (b *x11) setup() error {
	if err := xfixes.Init(b.conn); err != nil {
		return fmt.Errorf("%w: sem XFixes", ErrUnsupported)
	}
	if _, err := xfixes.QueryVersion(b.conn, 5, 0).Reply(); err != nil {
		return fmt.Errorf("XFixes: %w", err)
	}
	for _, name := range []string{"CLIPBOARD", "UTF8_STRING", "STRING", "TEXT", "TARGETS", "INCR", "CYBEREYES_CLIP"} {
		r, err := xproto.InternAtom(b.conn, false, uint16(len(name)), name).Reply()
		if err != nil {
			return fmt.Errorf("atomo %s: %w", name, err)
		}
		b.atoms[name] = r.Atom
	}
	screen := xproto.Setup(b.conn).DefaultScreen(b.conn)
	win, err := xproto.NewWindowId(b.conn)
	if err != nil {
		return err
	}
	if err := xproto.CreateWindowChecked(b.conn, 0, win, screen.Root, 0, 0, 1, 1, 0, xproto.WindowClassInputOnly, screen.RootVisual, 0, nil).Check(); err != nil {
		return fmt.Errorf("janela da area de transferencia: %w", err)
	}
	b.win = win
	mask := uint32(xfixes.SelectionEventMaskSetSelectionOwner | xfixes.SelectionEventMaskSelectionWindowDestroy | xfixes.SelectionEventMaskSelectionClientClose)
	return xfixes.SelectSelectionInputChecked(b.conn, win, b.atoms["CLIPBOARD"], mask).Check()
}

func (b *x11) loop() {
	defer close(b.done)
	for {
		ev, err := b.conn.WaitForEvent()
		if ev == nil && err == nil {
			return
		}
		switch e := ev.(type) {
		case xfixes.SelectionNotifyEvent:
			if e.Owner != b.win {
				b.mu.Lock()
				b.owned = nil
				b.mu.Unlock()
				select {
				case b.changes <- struct{}{}:
				default:
				}
			}
		case xproto.SelectionRequestEvent:
			b.serve(e)
		case xproto.SelectionNotifyEvent:
			select {
			case b.notify <- e:
			default:
			}
		case xproto.SelectionClearEvent:
			b.mu.Lock()
			b.owned = nil
			b.mu.Unlock()
		}
	}
}

// serve responde ao programa que quer colar o texto que gravamos.
func (b *x11) serve(e xproto.SelectionRequestEvent) {
	b.mu.Lock()
	owned := b.owned
	b.mu.Unlock()
	prop := e.Property
	if prop == xproto.AtomNone {
		prop = e.Target
	}
	reply := xproto.SelectionNotifyEvent{Time: e.Time, Requestor: e.Requestor, Selection: e.Selection, Target: e.Target, Property: xproto.AtomNone}
	switch {
	case owned == nil:
	case e.Target == b.atoms["TARGETS"]:
		targets := []xproto.Atom{b.atoms["TARGETS"], b.atoms["UTF8_STRING"], b.atoms["STRING"], b.atoms["TEXT"]}
		data := make([]byte, 4*len(targets))
		for i, a := range targets {
			xgb.Put32(data[i*4:], uint32(a))
		}
		xproto.ChangeProperty(b.conn, xproto.PropModeReplace, e.Requestor, prop, xproto.AtomAtom, 32, uint32(len(targets)), data)
		reply.Property = prop
	case (e.Target == b.atoms["UTF8_STRING"] || e.Target == b.atoms["STRING"] || e.Target == b.atoms["TEXT"]) && len(*owned) <= maxProperty:
		typ := b.atoms["UTF8_STRING"]
		if e.Target == b.atoms["STRING"] {
			typ = xproto.AtomString
		}
		xproto.ChangeProperty(b.conn, xproto.PropModeReplace, e.Requestor, prop, typ, 8, uint32(len(*owned)), []byte(*owned))
		reply.Property = prop
	}
	xproto.SendEvent(b.conn, false, e.Requestor, 0, string(reply.Bytes()))
}

func (b *x11) Read() (string, error) {
	b.mu.Lock()
	if b.owned != nil {
		text := *b.owned
		b.mu.Unlock()
		return text, nil
	}
	b.mu.Unlock()
	b.read.Lock()
	defer b.read.Unlock()
	// Descarta uma resposta atrasada de leitura anterior.
	select {
	case <-b.notify:
	default:
	}
	xproto.ConvertSelection(b.conn, b.win, b.atoms["CLIPBOARD"], b.atoms["UTF8_STRING"], b.atoms["CYBEREYES_CLIP"], xproto.TimeCurrentTime)
	var ev xproto.SelectionNotifyEvent
	select {
	case ev = <-b.notify:
	case <-time.After(time.Second):
		return "", errors.New("o dono da area de transferencia nao respondeu")
	}
	if ev.Property == xproto.AtomNone {
		return "", nil
	}
	r, err := xproto.GetProperty(b.conn, true, b.win, ev.Property, xproto.GetPropertyTypeAny, 0, (MaxText+3)/4).Reply()
	if err != nil {
		return "", err
	}
	if r.Type == b.atoms["INCR"] || r.BytesAfter > 0 {
		return "", ErrTooLarge
	}
	return string(r.Value), nil
}

func (b *x11) Write(text string) error {
	if len(text) > MaxText {
		return ErrTooLarge
	}
	b.mu.Lock()
	b.owned = &text
	b.mu.Unlock()
	clip := b.atoms["CLIPBOARD"]
	if err := xproto.SetSelectionOwnerChecked(b.conn, b.win, clip, xproto.TimeCurrentTime).Check(); err != nil {
		return err
	}
	r, err := xproto.GetSelectionOwner(b.conn, clip).Reply()
	if err != nil {
		return err
	}
	if r.Owner != b.win {
		return errors.New("nao foi possivel assumir a area de transferencia")
	}
	return nil
}

func (b *x11) Changes() <-chan struct{} { return b.changes }

func (b *x11) Close() error {
	b.conn.Close()
	<-b.done
	return nil
}
