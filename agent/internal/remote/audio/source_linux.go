//go:build linux

package audio

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// parec grava do monitor da saida padrao do PulseAudio (ou do pipewire-pulse) no formato do visualizador.
func parec() (string, bool) {
	if p, err := exec.LookPath("parec"); err == nil {
		return p, true
	}
	for _, p := range []string{"/usr/bin/parec", "/bin/parec"} {
		if _, err := os.Stat(p); err == nil {
			return p, true
		}
	}
	return "", false
}

// Available informa se o parec existe (pacote pulseaudio-utils).
func Available() bool {
	_, ok := parec()
	return ok
}

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

// Open roda o parec como o usuario da sessao grafica: o som (PulseAudio ou PipeWire) e da sessao dele, e o
// remote-helper roda como root.
func Open(ctx context.Context) (Stream, error) {
	path, ok := parec()
	if !ok {
		return nil, fmt.Errorf("%w: instale o pulseaudio-utils (parec)", ErrUnsupported)
	}
	name, err := execx.ConsoleUser()
	if err != nil {
		return nil, fmt.Errorf("%w: sem usuario na sessao grafica", ErrUnsupported)
	}
	u, err := user.Lookup(name)
	if err != nil {
		return nil, err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	cmd := exec.CommandContext(ctx, path, "--device=@DEFAULT_MONITOR@", "--format=s16le",
		"--rate="+strconv.Itoa(SampleRate), "--channels="+strconv.Itoa(Channels), "--latency-msec=40")
	cmd.Env = []string{"HOME=" + u.HomeDir, "USER=" + name, "XDG_RUNTIME_DIR=/run/user/" + u.Uid, "PATH=/usr/bin:/bin"}
	if os.Geteuid() == 0 && uid != 0 {
		cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}}
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &procStream{cmd: cmd, out: out}, nil
}

// Main e o "eyes remote-audio" (so no Windows).
func Main(io.Writer) error { return ErrUnsupported }
