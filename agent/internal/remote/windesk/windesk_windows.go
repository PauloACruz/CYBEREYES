//go:build windows

// A captura e a entrada rodam numa thread fixa, presa a area de
// trabalho que recebe a entrada naquele momento: "Default" no uso normal e "Winlogon" na tela bloqueada, na
// tela de login e na confirmacao do UAC (contrato, secao 5; RFC-001, fase 12.3). O GDI e o SendInput so
// enxergam a area de trabalho da thread que chama, por isso tudo passa por Do.

package windesk

import (
	"errors"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procOpenInputDesktop         = user32.NewProc("OpenInputDesktop")
	procSetThreadDesktop         = user32.NewProc("SetThreadDesktop")
	procCloseDesktop             = user32.NewProc("CloseDesktop")
	procGetUserObjectInformation = user32.NewProc("GetUserObjectInformationW")
	procOpenWindowStation        = user32.NewProc("OpenWindowStationW")
	procSetProcessWindowStation  = user32.NewProc("SetProcessWindowStation")
	procSetProcessDpiAwareness   = user32.NewProc("SetProcessDpiAwarenessContext")
	procSetProcessDPIAware       = user32.NewProc("SetProcessDPIAware")
)

const (
	genericAll       = 0x10000000
	uoiName          = 2
	dpiPerMonitorV2  = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
	desktopSwitchErr = "troca de area de trabalho"
)

type job struct {
	fn   func(changed bool) error
	done chan error
}

var (
	once    sync.Once
	jobs    chan job
	initErr error
)

// Do executa fn na thread da area de trabalho de entrada. changed vale true quando a area de trabalho mudou desde a
// chamada anterior (quem guarda recursos do GDI deve recria-los).
func Do(fn func(changed bool) error) error {
	once.Do(start)
	if initErr != nil {
		return initErr
	}
	j := job{fn: fn, done: make(chan error, 1)}
	jobs <- j
	return <-j.done
}

func start() {
	// Pixels fisicos em todos os monitores: as coordenadas do visualizador batem com as do SendInput.
	if procSetProcessDpiAwareness.Find() == nil {
		procSetProcessDpiAwareness.Call(dpiPerMonitorV2)
	} else {
		procSetProcessDPIAware.Call()
	}
	// O remote-helper nasce como SYSTEM na sessao do usuario; a estacao interativa e a WinSta0.
	if name, err := windows.UTF16PtrFromString("WinSta0"); err == nil {
		if h, _, _ := procOpenWindowStation.Call(uintptr(unsafe.Pointer(name)), 0, genericAll); h != 0 {
			procSetProcessWindowStation.Call(h)
		}
	}
	jobs = make(chan job)
	ready := make(chan error, 1)
	go loop(ready)
	initErr = <-ready
}

func loop(ready chan<- error) {
	runtime.LockOSThread()
	var current uintptr
	var currentName string
	follow := func() (bool, error) {
		h, _, err := procOpenInputDesktop.Call(0, 0, genericAll)
		if h == 0 {
			return false, errors.Join(errors.New(desktopSwitchErr), err)
		}
		name := objectName(h)
		if current != 0 && name == currentName {
			procCloseDesktop.Call(h)
			return false, nil
		}
		if r, _, err := procSetThreadDesktop.Call(h); r == 0 {
			procCloseDesktop.Call(h)
			return false, errors.Join(errors.New(desktopSwitchErr), err)
		}
		if current != 0 {
			procCloseDesktop.Call(current)
		}
		current, currentName = h, name
		return true, nil
	}
	_, err := follow()
	ready <- err
	if err != nil {
		return
	}
	first := true
	for j := range jobs {
		changed, err := follow()
		if err != nil {
			j.done <- err
			continue
		}
		j.done <- j.fn(changed || first)
		first = false
	}
}

// Name devolve o nome da area de trabalho de entrada atual ("Default", "Winlogon", "Screen-saver").
func Name() string {
	var out string
	_ = Do(func(bool) error {
		h, _, _ := procOpenInputDesktop.Call(0, 0, 0)
		if h != 0 {
			out = objectName(h)
			procCloseDesktop.Call(h)
		}
		return nil
	})
	return out
}

func objectName(h uintptr) string {
	buf := make([]uint16, 256)
	var need uint32
	r, _, _ := procGetUserObjectInformation.Call(h, uoiName, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2), uintptr(unsafe.Pointer(&need)))
	if r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}
