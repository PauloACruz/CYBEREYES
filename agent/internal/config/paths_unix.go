//go:build !windows

package config

import (
	"os"
	"path/filepath"
	"runtime"
)

// DataDir e a pasta de dados do EYES (configuracao e estado).
func DataDir() string {
	if d := os.Getenv("EYES_DATA_DIR"); d != "" {
		return d
	}
	if runtime.GOOS == "darwin" {
		return "/Library/Application Support/Cybereyes/EYES"
	}
	return "/etc/cybereyes"
}

// InstallDir e a pasta do binario instalado.
func InstallDir() string {
	if runtime.GOOS == "darwin" {
		return "/usr/local/cybereyes"
	}
	return "/opt/cybereyes"
}

// BinaryPath e o caminho do binario instalado.
func BinaryPath() string { return filepath.Join(InstallDir(), "eyes") }

func restrictDir(path string) error  { return os.Chmod(path, 0o700) }
func restrictFile(path string) error { return os.Chmod(path, 0o600) }
