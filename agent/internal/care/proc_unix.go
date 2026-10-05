//go:build !windows

package care

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

// procTree identifica o grupo de processos do modulo.
type procTree struct{ pgid int }

// prepareCmd coloca o modulo em um grupo de processos proprio: cancelar ou estourar o tempo
// limite encerra o grupo inteiro.
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Netos que se desligam do grupo e seguram a saida nao travam a espera.
	cmd.WaitDelay = 5 * time.Second
}

func trackTree(cmd *exec.Cmd) *procTree {
	if cmd.Process == nil {
		return nil
	}
	return &procTree{pgid: cmd.Process.Pid}
}

// kill envia SIGTERM ao grupo e SIGKILL 3 s depois.
func (t *procTree) kill(cmd *exec.Cmd) {
	if t == nil {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return
	}
	_ = syscall.Kill(-t.pgid, syscall.SIGTERM)
	pgid := t.pgid
	time.AfterFunc(3*time.Second, func() { _ = syscall.Kill(-pgid, syscall.SIGKILL) })
}

func (t *procTree) release() {}

// interpreter devolve o bash e os argumentos para executar o modulo.
func interpreter(script string) (string, []string) {
	bash := "/bin/bash"
	if _, err := os.Stat(bash); err != nil {
		if p, lerr := exec.LookPath("bash"); lerr == nil {
			bash = p
		}
	}
	return bash, []string{script}
}

// restrictPath deixa a pasta ou o arquivo acessivel so ao dono (root).
func restrictPath(path string, dir bool) error {
	if dir {
		return os.Chmod(path, 0o700)
	}
	return os.Chmod(path, 0o600)
}

// scriptBytes prepara o conteudo do script para gravacao (sem mudancas fora do Windows).
func scriptBytes(_ string, b []byte) []byte { return b }

// prepareProbe: comandos das sondas de saude em grupo proprio, encerrado inteiro no prazo.
func prepareProbe(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
