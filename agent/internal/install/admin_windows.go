//go:build windows

package install

import (
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
)

func isAdmin() bool { return windows.GetCurrentProcessToken().IsElevated() }

// removeInstallDir apaga a pasta depois que o processo atual terminar (o .exe pode estar em uso).
func removeInstallDir() {
	dir := config.InstallDir()
	// Fecha o app de bandeja em todas as sessoes antes de apagar a pasta.
	kill := exec.Command("taskkill", "/F", "/IM", "eyes-tray.exe")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = kill.Run()
	if err := os.RemoveAll(dir); err == nil {
		return
	}
	cmd := exec.Command("cmd.exe", "/C", `timeout /t 5 /nobreak >NUL & rmdir /S /Q "`+dir+`"`)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.DETACHED_PROCESS}
	_ = cmd.Start()
}
