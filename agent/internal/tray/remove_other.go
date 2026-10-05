//go:build !linux

package tray

// Remove nao tem o que fazer fora do Linux: no Windows a desinstalacao encerra o app e apaga a pasta
// (install.removeInstallDir); no macOS o EYES nao instala o app.
func Remove() {}
