//go:build windows

package input

import (
	"fmt"
	"image"
	"sync"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/windesk"
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procSendInput        = user32.NewProc("SendInput")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	inputMouse    = 0
	inputKeyboard = 1

	keyExtended = 0x0001
	keyUp       = 0x0002
	keyUnicode  = 0x0004
	keyScancode = 0x0008

	mouseMove        = 0x0001
	mouseLeftDown    = 0x0002
	mouseLeftUp      = 0x0004
	mouseRightDown   = 0x0008
	mouseRightUp     = 0x0010
	mouseMiddleDown  = 0x0020
	mouseMiddleUp    = 0x0040
	mouseXDown       = 0x0080
	mouseXUp         = 0x0100
	mouseWheel       = 0x0800
	mouseHWheel      = 0x1000
	mouseVirtualDesk = 0x4000
	mouseAbsolute    = 0x8000

	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79

	vkPause = 0x13
)

type mouseInput struct {
	Dx, Dy    int32
	MouseData uint32
	Flags     uint32
	Time      uint32
	ExtraInfo uintptr
}

type keybdInput struct {
	Vk, Scan  uint16
	Flags     uint32
	Time      uint32
	ExtraInfo uintptr
}

// mouseEvent e keyEvent tem o tamanho de INPUT (a uniao do Windows tem o tamanho de MOUSEINPUT).
type mouseEvent struct {
	Type uint32
	Mi   mouseInput
}

type keyEvent struct {
	Type uint32
	Ki   keybdInput
	_    [8]byte
}

const inputSize = unsafe.Sizeof(mouseEvent{})

// Os dois formatos precisam ter o mesmo tamanho de INPUT.
var _ = [1]struct{}{}[inputSize-unsafe.Sizeof(keyEvent{})]

// winButtons liga os bits de MouseEvent.buttons aos eventos do Windows.
var winButtons = []struct {
	bit      int
	down, up uint32
	data     uint32
}{
	{1, mouseLeftDown, mouseLeftUp, 0},
	{2, mouseRightDown, mouseRightUp, 0},
	{4, mouseMiddleDown, mouseMiddleUp, 0},
	{8, mouseXDown, mouseXUp, 1},
	{16, mouseXDown, mouseXUp, 2},
}

type sendInput struct {
	mu      sync.Mutex
	buttons int
}

// Open usa SendInput na area de trabalho de entrada (inclusive Winlogon: UAC e tela bloqueada).
func Open() (Injector, error) {
	if err := procSendInput.Find(); err != nil {
		return nil, err
	}
	return &sendInput{}, nil
}

func send(events unsafe.Pointer, n int) error {
	if n == 0 {
		return nil
	}
	return windesk.DoInput(func(uint64) error {
		r, _, err := procSendInput.Call(uintptr(n), uintptr(events), inputSize)
		if int(r) != n {
			return fmt.Errorf("SendInput: %w", err)
		}
		return nil
	})
}

func sendKeys(evs []keyEvent) error {
	if len(evs) == 0 {
		return nil
	}
	return send(unsafe.Pointer(&evs[0]), len(evs))
}

func sendMouse(evs []mouseEvent) error {
	if len(evs) == 0 {
		return nil
	}
	return send(unsafe.Pointer(&evs[0]), len(evs))
}

func (w *sendInput) Key(code string, down bool) error {
	k, ok := lookup(code)
	if !ok {
		return ErrUnknownKey
	}
	ev := keyEvent{Type: inputKeyboard}
	if code == "Pause" {
		// Pause tem a sequencia E1 1D 45, que o SendInput so gera pela tecla virtual.
		ev.Ki.Vk = vkPause
	} else {
		ev.Ki.Scan = k.win
		ev.Ki.Flags = keyScancode
		if k.ext {
			ev.Ki.Flags |= keyExtended
		}
	}
	if !down {
		ev.Ki.Flags |= keyUp
	}
	return sendKeys([]keyEvent{ev})
}

// Text digita cada unidade UTF-16 com KEYEVENTF_UNICODE, sem depender do layout do teclado remoto.
func (w *sendInput) Text(s string) error {
	units := utf16.Encode([]rune(s))
	evs := make([]keyEvent, 0, len(units)*2)
	for _, u := range units {
		evs = append(evs,
			keyEvent{Type: inputKeyboard, Ki: keybdInput{Scan: u, Flags: keyUnicode}},
			keyEvent{Type: inputKeyboard, Ki: keybdInput{Scan: u, Flags: keyUnicode | keyUp}})
	}
	return sendKeys(evs)
}

func metric(i uintptr) int {
	r, _, _ := procGetSystemMetrics.Call(i)
	return int(int32(r))
}

func (w *sendInput) Mouse(area image.Rectangle, px, py, buttons int) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	x := area.Min.X + max(0, min(px, area.Dx()-1))
	y := area.Min.Y + max(0, min(py, area.Dy()-1))
	nx, ny := normalize(x, y, metric(smXVirtualScreen), metric(smYVirtualScreen), metric(smCXVirtualScreen), metric(smCYVirtualScreen))
	evs := []mouseEvent{{Type: inputMouse, Mi: mouseInput{Dx: nx, Dy: ny, Flags: mouseMove | mouseAbsolute | mouseVirtualDesk}}}
	for _, b := range winButtons {
		was, now := w.buttons&b.bit != 0, buttons&b.bit != 0
		if was == now {
			continue
		}
		flag := b.down
		if !now {
			flag = b.up
		}
		evs = append(evs, mouseEvent{Type: inputMouse, Mi: mouseInput{MouseData: b.data, Flags: flag}})
	}
	if err := sendMouse(evs); err != nil {
		return err
	}
	w.buttons = buttons
	return nil
}

// Wheel: dy positivo rola para baixo (como no navegador); no Windows o valor positivo rola para cima.
func (w *sendInput) Wheel(dx, dy int) error {
	var evs []mouseEvent
	if dy != 0 {
		evs = append(evs, mouseEvent{Type: inputMouse, Mi: mouseInput{MouseData: uint32(int32(-dy)), Flags: mouseWheel}})
	}
	if dx != 0 {
		evs = append(evs, mouseEvent{Type: inputMouse, Mi: mouseInput{MouseData: uint32(int32(dx)), Flags: mouseHWheel}})
	}
	return sendMouse(evs)
}

func (w *sendInput) Close() error { return nil }
