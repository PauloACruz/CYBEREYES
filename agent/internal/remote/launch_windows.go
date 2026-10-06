//go:build windows

package remote

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	noActiveSession  = 0xFFFFFFFF
	wtsUserName      = 5
	wtsDomainName    = 7
	createNoWindow   = 0x08000000
	tokenSessionInfo = 12 // TokenSessionId
)

var (
	kernel32                         = windows.NewLazySystemDLL("kernel32.dll")
	procWTSGetActiveConsoleSessionId = kernel32.NewProc("WTSGetActiveConsoleSessionId")
	wtsapi32                         = windows.NewLazySystemDLL("wtsapi32.dll")
	procWTSQuerySessionInformation   = wtsapi32.NewProc("WTSQuerySessionInformationW")
)

// sessionString le uma informacao textual de uma sessao do Terminal Services.
func sessionString(sid uint32, class uintptr) string {
	var buf *uint16
	var n uint32
	if r, _, _ := procWTSQuerySessionInformation.Call(0, uintptr(sid), class, uintptr(unsafe.Pointer(&buf)), uintptr(unsafe.Pointer(&n))); r == 0 || buf == nil {
		return ""
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(buf)))
	return windows.UTF16PtrToString(buf)
}

// sessionAccount devolve DOMINIO\conta do usuario da sessao, ou "" quando ninguem entrou.
func sessionAccount(sid uint32) string {
	user := sessionString(sid, wtsUserName)
	if user == "" {
		return ""
	}
	if domain := sessionString(sid, wtsDomainName); domain != "" {
		return domain + `\` + user
	}
	return user
}

// findDesktop escolhe a sessao: a do console com usuario; senao uma sessao ativa com usuario (Area de Trabalho
// Remota); senao, se a politica permitir, a tela de login do console.
func findDesktop(allowLogin bool) (target, error) {
	console := uint32(noActiveSession)
	if r, _, _ := procWTSGetActiveConsoleSessionId.Call(); uint32(r) != noActiveSession {
		console = uint32(r)
	}
	if console != noActiveSession {
		if user := sessionAccount(console); user != "" {
			return target{User: user, Session: console}, nil
		}
	}
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err == nil {
		list := unsafe.Slice(sessions, count)
		for _, s := range list {
			if s.State == windows.WTSActive && s.SessionID != 0 {
				if user := sessionAccount(s.SessionID); user != "" {
					windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
					return target{User: user, Session: s.SessionID}, nil
				}
			}
		}
		windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	}
	if allowLogin && console != noActiveSession && console != 0 {
		return target{Session: console}, nil
	}
	return target{}, errNoSession
}

// helperToken copia o token do servico (SYSTEM) e o move para a sessao do usuario: o remote-helper roda como SYSTEM
// na sessao certa e alcanca a area de trabalho Winlogon (UAC e tela bloqueada).
func helperToken(sid uint32) (windows.Token, error) {
	var own windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_DUPLICATE|windows.TOKEN_QUERY|windows.TOKEN_ASSIGN_PRIMARY|windows.TOKEN_ADJUST_DEFAULT|windows.TOKEN_ADJUST_SESSIONID, &own); err != nil {
		return 0, err
	}
	defer own.Close()
	var dup windows.Token
	if err := windows.DuplicateTokenEx(own, windows.MAXIMUM_ALLOWED, nil, windows.SecurityIdentification, windows.TokenPrimary, &dup); err != nil {
		return 0, err
	}
	if err := windows.SetTokenInformation(dup, tokenSessionInfo, (*byte)(unsafe.Pointer(&sid)), uint32(unsafe.Sizeof(sid))); err != nil {
		dup.Close()
		return 0, fmt.Errorf("mover o token para a sessao %d (o EYES precisa rodar como servico): %w", sid, err)
	}
	return dup, nil
}

func launchHelper(ctx context.Context, t target, p HelperParams, control <-chan Control, log *slog.Logger) error {
	exe, err := Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "remote-helper")
	attr := &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	var own uint32
	if windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &own) != nil || own != t.Session {
		tok, err := helperToken(t.Session)
		if err != nil {
			return err
		}
		defer tok.Close()
		attr.Token = syscall.Token(tok)
	}
	cmd.SysProcAttr = attr
	return runHelperProcess(ctx, cmd, p, control, func(line string) { log.Info("remote-helper", "linha", line) })
}
