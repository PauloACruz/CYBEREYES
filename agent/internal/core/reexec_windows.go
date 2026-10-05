//go:build windows

package core

import (
	"os"
	"os/exec"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

// reexec inicia o binario novo e encerra o processo atual (o Windows nao tem exec).
func reexec(e *env.Env, binary string) {
	time.Sleep(time.Second)
	cmd := exec.Command(binary, os.Args[1:]...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		e.Log.Error("falha ao reexecutar o EYES", "erro", err)
		return
	}
	os.Exit(0)
}
