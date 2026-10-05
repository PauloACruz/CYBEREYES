//go:build linux

package input

import (
	"image"
	"os"
	"testing"
	"time"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/xproto"
)

// TestX11Injection cria uma janela no servidor X (Xvfb em DISPLAY) e confere os eventos que chegam a ela.
func TestX11Injection(t *testing.T) {
	if os.Getenv("DISPLAY") == "" {
		t.Skip("sem DISPLAY")
	}
	conn, err := xgb.NewConn()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	scr := xproto.Setup(conn).DefaultScreen(conn)
	win, _ := xproto.NewWindowId(conn)
	mask := uint32(xproto.EventMaskKeyPress | xproto.EventMaskKeyRelease | xproto.EventMaskButtonPress | xproto.EventMaskButtonRelease)
	xproto.CreateWindow(conn, scr.RootDepth, win, scr.Root, 0, 0, scr.WidthInPixels, scr.HeightInPixels, 0,
		xproto.WindowClassInputOutput, scr.RootVisual, xproto.CwEventMask, []uint32{mask})
	xproto.MapWindow(conn, win)
	time.Sleep(200 * time.Millisecond)
	xproto.SetInputFocus(conn, xproto.InputFocusPointerRoot, win, xproto.TimeCurrentTime)

	in, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	tr := Track(in)
	defer tr.Close()
	area := image.Rect(0, 0, int(scr.WidthInPixels), int(scr.HeightInPixels))
	if err := tr.Mouse(area, 100, 120, 1); err != nil {
		t.Fatal(err)
	}
	if err := tr.Mouse(area, 100, 120, 0); err != nil {
		t.Fatal(err)
	}
	if err := tr.Key("KeyA", true); err != nil {
		t.Fatal(err)
	}
	tr.ReleaseAll()
	if err := tr.Text("ç"); err != nil {
		t.Fatal(err)
	}

	var press, release, keyPress int
	var lastX, lastY int16
	deadline := time.After(3 * time.Second)
	for keyPress < 2 || press < 1 || release < 1 {
		ev, xerr := conn.PollForEvent()
		if xerr != nil {
			t.Fatal(xerr)
		}
		if ev == nil {
			select {
			case <-deadline:
				t.Fatalf("eventos insuficientes: botao %d/%d, teclas %d", press, release, keyPress)
			case <-time.After(10 * time.Millisecond):
			}
			continue
		}
		switch e := ev.(type) {
		case xproto.ButtonPressEvent:
			press++
			lastX, lastY = e.EventX, e.EventY
		case xproto.ButtonReleaseEvent:
			release++
		case xproto.KeyPressEvent:
			keyPress++
		}
	}
	if lastX != 100 || lastY != 120 {
		t.Fatalf("clique em (%d,%d), esperado (100,120)", lastX, lastY)
	}
}

func TestKeymapCoversCommonKeys(t *testing.T) {
	for _, code := range []string{"KeyA", "Digit0", "Enter", "Escape", "ArrowUp", "ShiftLeft", "ControlLeft", "AltLeft", "MetaLeft", "F12", "Backquote", "IntlBackslash"} {
		if _, ok := lookup(code); !ok {
			t.Errorf("sem traducao para %s", code)
		}
	}
	if k, _ := lookup("ArrowUp"); !k.ext || k.win != 0x48 || k.evdev != 103 {
		t.Fatalf("ArrowUp: %+v", k)
	}
}
