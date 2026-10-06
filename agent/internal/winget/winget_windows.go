//go:build windows

package winget

import (
	"context"
	"os"
	"path/filepath"
	"runtime"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// Register registra o installwithwinget.
func Register(e *env.Env) error {
	newService(e, winSystem{}).register(e.Reg)
	return nil
}

type winSystem struct{}

// Find procura o winget.exe do App Installer em Program Files\WindowsApps (o caminho do PATH,
// %LOCALAPPDATA%\Microsoft\WindowsApps, so existe para o usuario conectado, nao para o SYSTEM).
func (winSystem) Find() (string, bool) {
	pf := os.Getenv("ProgramFiles")
	if pf == "" {
		pf = `C:\Program Files`
	}
	dirs, _ := filepath.Glob(filepath.Join(pf, "WindowsApps", "Microsoft.DesktopAppInstaller_*__8wekyb3d8bbwe"))
	if p := pickWinget(dirs, runtime.GOARCH); p != "" {
		return p, true
	}
	return "", false
}

// Install executa o winget.exe diretamente, sem shell: o identificador ja foi validado e vai como
// argumento separado.
func (winSystem) Install(ctx context.Context, wingetPath string, args []string) execx.Result {
	return execx.Run(ctx, execx.Spec{Path: wingetPath, Args: args, Timeout: packageTimeout})
}
