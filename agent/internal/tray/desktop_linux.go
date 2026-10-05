//go:build linux

package tray

import (
	"bytes"
	_ "embed"
	"os"
	"path/filepath"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
)

// Icone do app (copia de agent/tray/build/appicon.png: o app de bandeja e outro modulo Go).
//
//go:embed eyes-tray.png
var appIcon []byte

// desktopEntryPath e o atalho no menu de aplicativos (variavel para os testes).
var desktopEntryPath = "/usr/share/applications/eyes-tray.desktop"

func iconPath() string { return filepath.Join(config.InstallDir(), "eyes-tray.png") }

// desktopEntry e o atalho "EYES" no menu de aplicativos. Com o app ja na bandeja, abrir pelo menu so
// mostra a janela (instancia unica); e o caminho do usuario quando a area de trabalho nao exibe
// icones de bandeja (GNOME sem a extensao AppIndicator). O nome do arquivo e o StartupWMClass
// seguem o identificador da janela do app (eyes-tray).
func desktopEntry() string {
	return "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=EYES\n" +
		"GenericName=Atendimento de TI\n" +
		"Comment=Abra chamados e converse com o técnico\n" +
		"Exec=" + trayPath() + "\n" +
		"Icon=" + iconPath() + "\n" +
		"Terminal=false\n" +
		"Categories=Utility;\n" +
		"Keywords=chamado;suporte;ajuda;técnico;TI;helpdesk;\n" +
		"StartupNotify=false\n" +
		"StartupWMClass=eyes-tray\n" +
		"X-GNOME-UsesNotifications=true\n"
}

// installLauncher grava o icone e o atalho do menu (so quando mudam).
func installLauncher() error {
	if err := writeIfChanged(iconPath(), appIcon); err != nil {
		return err
	}
	return writeIfChanged(desktopEntryPath, []byte(desktopEntry()))
}

func writeIfChanged(path string, data []byte) error {
	if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, data) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
