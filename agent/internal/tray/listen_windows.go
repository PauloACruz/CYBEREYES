//go:build windows

package tray

import (
	"errors"
	"net"
	"strings"
	"unsafe"

	winio "github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

// PipePath e o named pipe do canal local (o app usa o mesmo caminho).
const PipePath = `\\.\pipe\eyes-tray`

// SYSTEM e Administradores com controle total; usuarios autenticados leem e escrevem.
const pipeSDDL = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)"

func listen() (net.Listener, error) {
	return winio.ListenPipe(PipePath, &winio.PipeConfig{SecurityDescriptor: pipeSDDL, InputBufferSize: 4096, OutputBufferSize: 4096})
}

var procGetNamedPipeClientProcessId = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetNamedPipeClientProcessId")

type fder interface{ Fd() uintptr }

// peerUser identifica o usuario pelo token do processo cliente do pipe.
func peerUser(conn net.Conn) (string, error) {
	f, ok := conn.(fder)
	if !ok {
		return "", errors.New("conexao sem handle do pipe")
	}
	var pid uint32
	r, _, err := procGetNamedPipeClientProcessId.Call(f.Fd(), uintptr(unsafe.Pointer(&pid)))
	if r == 0 {
		return "", err
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		return "", err
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return "", err
	}
	if u.User.Sid.IsWellKnown(windows.WinLocalSystemSid) {
		return "", errors.New("SYSTEM nao usa o app de bandeja")
	}
	acc, dom, _, err := u.User.Sid.LookupAccount("")
	if err != nil {
		return "", err
	}
	if dom != "" && !strings.EqualFold(dom, "NT AUTHORITY") {
		return dom + `\` + acc, nil
	}
	return acc, nil
}
