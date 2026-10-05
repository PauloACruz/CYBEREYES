//go:build !windows

package actions

import (
	"errors"
	"fmt"
	"syscall"
)

// killProcess envia SIGKILL ao processo.
func killProcess(pid int) error {
	err := syscall.Kill(pid, syscall.SIGKILL)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, syscall.ESRCH):
		return fmt.Errorf("processo %d nao encontrado", pid)
	case errors.Is(err, syscall.EPERM):
		return fmt.Errorf("sem permissao para encerrar o processo %d", pid)
	}
	return fmt.Errorf("falha ao encerrar o processo %d: %v", pid, err)
}
