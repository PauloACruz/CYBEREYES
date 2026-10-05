//go:build !windows

package core

import (
	"os"
	"syscall"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

// reexec troca o processo atual pelo binario novo, mantendo argumentos e ambiente.
func reexec(e *env.Env, binary string) {
	time.Sleep(time.Second)
	if err := syscall.Exec(binary, os.Args, os.Environ()); err != nil {
		e.Log.Error("falha ao reexecutar o EYES", "erro", err)
	}
}
