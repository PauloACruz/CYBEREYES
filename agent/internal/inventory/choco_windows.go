//go:build windows

package inventory

import (
	"os"
	"os/exec"
	"path/filepath"
)

// chocoSupported indica que o estado do Chocolatey e informado ao servidor (so Windows).
const chocoSupported = true

// chocoInstalled procura o choco.exe na pasta do Chocolatey e no PATH.
func chocoInstalled() bool {
	var dirs []string
	if d := os.Getenv("ChocolateyInstall"); d != "" {
		dirs = append(dirs, d)
	}
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	dirs = append(dirs, filepath.Join(pd, "chocolatey"))
	for _, d := range dirs {
		for _, f := range []string{"choco.exe", filepath.Join("bin", "choco.exe")} {
			if st, err := os.Stat(filepath.Join(d, f)); err == nil && !st.IsDir() {
				return true
			}
		}
	}
	_, err := exec.LookPath("choco")
	return err == nil
}
