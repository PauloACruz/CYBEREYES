//go:build windows

package config

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// DataDir e a pasta de dados do EYES (configuracao e estado).
func DataDir() string {
	if d := os.Getenv("EYES_DATA_DIR"); d != "" {
		return d
	}
	base := os.Getenv("ProgramData")
	if base == "" {
		base = `C:\ProgramData`
	}
	return filepath.Join(base, "Cybereyes", "EYES")
}

// InstallDir e a pasta do binario instalado.
func InstallDir() string {
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return filepath.Join(base, "Cybereyes", "EYES")
}

// BinaryPath e o caminho do binario instalado.
func BinaryPath() string { return filepath.Join(InstallDir(), "eyes.exe") }

// Somente SYSTEM e Administradores, sem heranca: o arquivo guarda o token do agente.
const restrictedSDDL = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"

func restrictDir(path string) error  { return applySDDL(path) }
func restrictFile(path string) error { return applySDDL(path) }

func applySDDL(path string) error {
	sd, err := windows.SecurityDescriptorFromString(restrictedSDDL)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}
