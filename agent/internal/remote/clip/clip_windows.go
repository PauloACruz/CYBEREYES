//go:build windows

package clip

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/windesk"
)

var (
	user32                            = windows.NewLazySystemDLL("user32.dll")
	kernel32                          = windows.NewLazySystemDLL("kernel32.dll")
	procRegisterClassEx               = user32.NewProc("RegisterClassExW")
	procCreateWindowEx                = user32.NewProc("CreateWindowExW")
	procDestroyWindow                 = user32.NewProc("DestroyWindow")
	procDefWindowProc                 = user32.NewProc("DefWindowProcW")
	procGetMessage                    = user32.NewProc("GetMessageW")
	procDispatchMessage               = user32.NewProc("DispatchMessageW")
	procPostMessage                   = user32.NewProc("PostMessageW")
	procAddClipboardFormatListener    = user32.NewProc("AddClipboardFormatListener")
	procRemoveClipboardFormatListener = user32.NewProc("RemoveClipboardFormatListener")
	procOpenClipboard                 = user32.NewProc("OpenClipboard")
	procCloseClipboard                = user32.NewProc("CloseClipboard")
	procEmptyClipboard                = user32.NewProc("EmptyClipboard")
	procGetClipboardData              = user32.NewProc("GetClipboardData")
	procSetClipboardData              = user32.NewProc("SetClipboardData")
	procGetClipboardOwner             = user32.NewProc("GetClipboardOwner")
	procGlobalAlloc                   = kernel32.NewProc("GlobalAlloc")
	procGlobalFree                    = kernel32.NewProc("GlobalFree")
	procGlobalLock                    = kernel32.NewProc("GlobalLock")
	procGlobalUnlock                  = kernel32.NewProc("GlobalUnlock")
	procGlobalSize                    = kernel32.NewProc("GlobalSize")
)

const (
	wmClipboardUpdate = 0x031D
	wmApp             = 0x8000
	cfUnicodeText     = 13
	gmemMoveable      = 0x0002
	hwndMessage       = ^uintptr(2) // HWND_MESSAGE = (HWND)-3
)

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	X, Y    int32
	Private uint32
}

// O Windows limita os callbacks por processo: um so para todas as janelas.
var (
	boards   sync.Map // hwnd -> *win
	wndProc  = windows.NewCallback(proc)
	register sync.Once
	regErr   error
	class    = windows.StringToUTF16Ptr("CybereyesClipboard")
)

func proc(hwnd, m, wp, lp uintptr) uintptr {
	if m == wmClipboardUpdate {
		if v, ok := boards.Load(hwnd); ok {
			v.(*win).changed()
		}
		return 0
	}
	r, _, _ := procDefWindowProc.Call(hwnd, m, wp, lp)
	return r
}

type job struct {
	fn   func() error
	done chan error
}

// win e a area de transferencia por uma janela so de mensagens, numa thread propria.
type win struct {
	hwnd    uintptr
	changes chan struct{}
	jobs    chan job
	closed  chan struct{}
	once    sync.Once
}

// pointer converte o endereco devolvido pelo GlobalLock (memoria fora do Go) sem passar por unsafe.Pointer(uintptr).
func pointer(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// Open cria a janela que recebe WM_CLIPBOARDUPDATE na estacao interativa.
func Open() (Board, error) {
	if err := windesk.Ensure(); err != nil {
		return nil, err
	}
	w := &win{changes: make(chan struct{}, 1), jobs: make(chan job, 4), closed: make(chan struct{})}
	ready := make(chan error, 1)
	go w.loop(ready)
	if err := <-ready; err != nil {
		return nil, err
	}
	return w, nil
}

func (w *win) loop(ready chan<- error) {
	runtime.LockOSThread()
	register.Do(func() {
		wc := wndClassEx{WndProc: wndProc, ClassName: class}
		wc.Size = uint32(unsafe.Sizeof(wc))
		if r, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
			regErr = fmt.Errorf("RegisterClassEx: %w", err)
		}
	})
	if regErr != nil {
		ready <- regErr
		return
	}
	hwnd, _, err := procCreateWindowEx.Call(0, uintptr(unsafe.Pointer(class)), 0, 0, 0, 0, 0, 0, hwndMessage, 0, 0, 0)
	if hwnd == 0 {
		ready <- fmt.Errorf("CreateWindowEx: %w", err)
		return
	}
	w.hwnd = hwnd
	boards.Store(hwnd, w)
	if r, _, err := procAddClipboardFormatListener.Call(hwnd); r == 0 {
		boards.Delete(hwnd)
		procDestroyWindow.Call(hwnd)
		ready <- fmt.Errorf("AddClipboardFormatListener: %w", err)
		return
	}
	ready <- nil
	defer func() {
		procRemoveClipboardFormatListener.Call(hwnd)
		boards.Delete(hwnd)
		procDestroyWindow.Call(hwnd)
	}()
	var m msg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		if m.Message == wmApp {
			select {
			case <-w.closed:
				return
			default:
			}
			for drained := false; !drained; {
				select {
				case j := <-w.jobs:
					j.done <- j.fn()
				default:
					drained = true
				}
			}
			continue
		}
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
}

// changed avisa a mudanca, menos a nossa propria gravacao (EmptyClipboard deixa a nossa janela como dona).
func (w *win) changed() {
	if owner, _, _ := procGetClipboardOwner.Call(); owner == w.hwnd {
		return
	}
	select {
	case w.changes <- struct{}{}:
	default:
	}
}

// run executa fn na thread da janela (a dona da area de transferencia aberta).
func (w *win) run(fn func() error) error {
	select {
	case <-w.closed:
		return errors.New("area de transferencia fechada")
	default:
	}
	j := job{fn: fn, done: make(chan error, 1)}
	w.jobs <- j
	procPostMessage.Call(w.hwnd, wmApp, 0, 0)
	select {
	case err := <-j.done:
		return err
	case <-time.After(5 * time.Second):
		return errors.New("area de transferencia nao respondeu")
	}
}

func (w *win) open() error {
	for i := 0; i < 20; i++ {
		if r, _, _ := procOpenClipboard.Call(w.hwnd); r != 0 {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("area de transferencia ocupada por outro programa")
}

func (w *win) Read() (string, error) {
	var out string
	err := w.run(func() error {
		if err := w.open(); err != nil {
			return err
		}
		defer procCloseClipboard.Call()
		h, _, _ := procGetClipboardData.Call(cfUnicodeText)
		if h == 0 {
			return nil
		}
		p, _, _ := procGlobalLock.Call(h)
		if p == 0 {
			return nil
		}
		defer procGlobalUnlock.Call(h)
		size, _, _ := procGlobalSize.Call(h)
		units := unsafe.Slice((*uint16)(pointer(p)), size/2)
		n := 0
		for n < len(units) && units[n] != 0 {
			n++
		}
		if n > MaxText {
			return ErrTooLarge
		}
		out = string(utf16.Decode(units[:n]))
		if len(out) > MaxText {
			out = ""
			return ErrTooLarge
		}
		return nil
	})
	return out, err
}

func (w *win) Write(text string) error {
	if len(text) > MaxText {
		return ErrTooLarge
	}
	units := utf16.Encode([]rune(text))
	units = append(units, 0)
	return w.run(func() error {
		h, _, err := procGlobalAlloc.Call(gmemMoveable, uintptr(len(units)*2))
		if h == 0 {
			return fmt.Errorf("GlobalAlloc: %w", err)
		}
		p, _, _ := procGlobalLock.Call(h)
		if p == 0 {
			procGlobalFree.Call(h)
			return errors.New("GlobalLock falhou")
		}
		copy(unsafe.Slice((*uint16)(pointer(p)), len(units)), units)
		procGlobalUnlock.Call(h)
		if err := w.open(); err != nil {
			procGlobalFree.Call(h)
			return err
		}
		defer procCloseClipboard.Call()
		procEmptyClipboard.Call()
		if r, _, err := procSetClipboardData.Call(cfUnicodeText, h); r == 0 {
			procGlobalFree.Call(h)
			return fmt.Errorf("SetClipboardData: %w", err)
		}
		return nil
	})
}

func (w *win) Changes() <-chan struct{} { return w.changes }

func (w *win) Close() error {
	w.once.Do(func() {
		close(w.closed)
		procPostMessage.Call(w.hwnd, wmApp, 0, 0)
	})
	return nil
}
