//go:build windows

package audio

import (
	"context"
	"io"
	"os"
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// Available: o Windows sempre tem WASAPI; sem dispositivo de som o "eyes remote-audio" sai com erro.
func Available() bool { return true }

type procStream struct {
	cmd *exec.Cmd
	out io.ReadCloser
}

func (p *procStream) Read(b []byte) (int, error) { return p.out.Read(b) }

func (p *procStream) Close() error {
	_ = p.cmd.Process.Kill()
	_ = p.out.Close()
	return p.cmd.Wait()
}

// Open inicia o "eyes remote-audio" (mesmo binario, mesma sessao e usuario do remote-helper): uma falha na captura
// do som nunca derruba a sessao de tela.
func Open(ctx context.Context) (Stream, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, exe, "remote-audio")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	cmd.Stderr = os.Stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &procStream{cmd: cmd, out: out}, nil
}
