//go:build windows

package choco

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// startupDelay e a espera antes de informar o estado do Chocolatey na partida.
const startupDelay = 90 * time.Second

// Register registra installchoco e installwithchoco e, na partida, informa ao servidor se o
// Chocolatey esta instalado (PROPOSTA da secao 3.8).
func Register(e *env.Env) error {
	s := newService(e, &winSystem{proxy: e.Cfg.Proxy})
	s.register(e.Reg)
	e.Go("choco-startup", func(ctx context.Context) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(startupDelay):
		}
		_, ok := s.sys.Find()
		s.reportInstalled(ctx, ok)
	})
	return nil
}

type winSystem struct {
	proxy string
}

// Find procura o choco.exe na variavel ChocolateyInstall (do processo e da maquina, que o
// servico so enxerga depois de reiniciar) e no caminho padrao em %ProgramData%.
func (w *winSystem) Find() (string, bool) {
	var roots []string
	if v := os.Getenv("ChocolateyInstall"); v != "" {
		roots = append(roots, v)
	}
	if v := machineEnv("ChocolateyInstall"); v != "" {
		roots = append(roots, v)
	}
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	roots = append(roots, filepath.Join(pd, "chocolatey"))
	for _, r := range roots {
		p := filepath.Join(r, "bin", "choco.exe")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, true
		}
	}
	return "", false
}

func machineEnv(name string) string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue(name)
	if err != nil {
		return ""
	}
	if exp, err := registry.ExpandString(v); err == nil {
		return exp
	}
	return v
}

// InstallChoco executa o install.ps1 oficial com TLS 1.2 habilitado.
func (w *winSystem) InstallChoco(ctx context.Context) execx.Result {
	return execx.Command(ctx, "powershell", installCommand(w.proxy), installChocoTimeout, false)
}

// InstallPackage executa o choco.exe diretamente, sem shell: o nome ja foi validado e vai
// como argumento separado.
func (w *winSystem) InstallPackage(ctx context.Context, chocoPath, pkg string) execx.Result {
	return execx.Run(ctx, execx.Spec{
		Path:    chocoPath,
		Args:    packageArgs(pkg),
		Timeout: packageTimeout,
	})
}
