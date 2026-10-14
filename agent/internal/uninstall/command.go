package uninstall

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Entry e a entrada de desinstalacao lida do registro do Windows.
type Entry struct {
	Key                  string
	Name                 string
	Version              string
	Publisher            string
	InstallLocation      string
	DisplayIcon          string
	UninstallString      string
	QuietUninstallString string
	WindowsInstaller     bool
	// InnoAppPath vem de "Inno Setup: App Path" (so instaladores Inno Setup gravam).
	InnoAppPath string
	// Bundle indica um pacote WiX Burn (BundleCachePath ou BundleProviderKey).
	Bundle bool
	// NSIS e preenchido no Windows procurando a marca do Nullsoft no desinstalador.
	NSIS bool
}

// plan e a linha de comando silenciosa escolhida para o desinstalador.
type plan struct {
	Kind    string
	CmdLine string
	Exe     string
}

// errNoSilent indica um desinstalador sem modo silencioso conhecido.
var errNoSilent = errors.New("nao foi possivel identificar um modo silencioso para este desinstalador")

var (
	guidRe    = regexp.MustCompile(`\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}`)
	innoExeRe = regexp.MustCompile(`(?i)^unins\d{3}\.exe$`)
)

// productCode devolve o {GUID} do MSI: nome da chave ou o que vier no msiexec.
func (e Entry) productCode() string {
	leaf := winBase(e.Key)
	if guidRe.MatchString(leaf) && len(leaf) == 38 {
		return strings.ToUpper(leaf)
	}
	if isMsiexec(e.UninstallString) {
		if g := guidRe.FindString(e.UninstallString); g != "" {
			return strings.ToUpper(g)
		}
	}
	return ""
}

func isMsiexec(cmd string) bool {
	exe, _ := splitCommand(cmd)
	return strings.EqualFold(winBase(exe), "msiexec.exe") || strings.EqualFold(winBase(exe), "msiexec")
}

// planUninstall escolhe como rodar o desinstalador sem janela nem perguntas.
func planUninstall(e Entry, systemRoot string) (plan, error) {
	if code := e.productCode(); code != "" && (e.WindowsInstaller || isMsiexec(e.UninstallString)) {
		msi := winJoin(systemRoot, `System32\msiexec.exe`)
		return plan{Kind: "msi", Exe: msi, CmdLine: fmt.Sprintf(`"%s" /x %s /qn /norestart`, msi, code)}, nil
	}
	if q := strings.TrimSpace(e.QuietUninstallString); q != "" {
		exe, _ := splitCommand(q)
		return plan{Kind: "quiet", Exe: exe, CmdLine: q}, nil
	}
	cmd := strings.TrimSpace(e.UninstallString)
	if cmd == "" {
		return plan{}, errors.New("o programa nao tem desinstalador registrado")
	}
	exe, args := splitCommand(cmd)
	if exe == "" {
		return plan{}, fmt.Errorf("linha de desinstalacao invalida: %s", cmd)
	}
	low := " " + strings.ToLower(args) + " "
	has := func(flags ...string) bool {
		for _, f := range flags {
			if strings.Contains(low, " "+strings.ToLower(f)+" ") {
				return true
			}
		}
		return false
	}
	base := strings.ToLower(winBase(exe))
	line := quoteExe(exe) + strings.TrimRight(" "+strings.TrimSpace(args), " ")
	switch {
	case innoExeRe.MatchString(base) || e.InnoAppPath != "":
		if !has("/verysilent", "/silent") {
			line += " /VERYSILENT /SUPPRESSMSGBOXES /NORESTART"
		}
		return plan{Kind: "inno", Exe: exe, CmdLine: line}, nil
	case base == "update.exe" && has("--uninstall"):
		if !has("-s", "--silent") {
			line += " -s"
		}
		return plan{Kind: "squirrel", Exe: exe, CmdLine: line}, nil
	case e.Bundle || (has("/uninstall") && strings.Contains(strings.ToLower(exe), `\package cache\`)):
		if !has("/quiet", "/q", "/passive") {
			line += " /quiet /norestart"
		}
		return plan{Kind: "burn", Exe: exe, CmdLine: line}, nil
	case e.NSIS:
		if !has("/s") {
			line += " /S"
		}
		return plan{Kind: "nsis", Exe: exe, CmdLine: line}, nil
	}
	return plan{}, errNoSilent
}

// splitCommand separa o executavel dos argumentos ("C:\x\a.exe" /y ou C:\x y\a.exe /y).
func splitCommand(cmd string) (exe, args string) {
	cmd = strings.TrimSpace(cmd)
	if strings.HasPrefix(cmd, `"`) {
		if end := strings.Index(cmd[1:], `"`); end >= 0 {
			return cmd[1 : end+1], strings.TrimSpace(cmd[end+2:])
		}
		return strings.Trim(cmd, `"`), ""
	}
	if i := strings.Index(strings.ToLower(cmd), ".exe"); i >= 0 {
		return cmd[:i+4], strings.TrimSpace(cmd[i+4:])
	}
	if i := strings.IndexByte(cmd, ' '); i >= 0 {
		return cmd[:i], strings.TrimSpace(cmd[i+1:])
	}
	return cmd, ""
}

func quoteExe(exe string) string { return `"` + strings.Trim(exe, `"`) + `"` }

// exeDir devolve a pasta do executavel de uma linha de comando ou icone ("x.exe,0"), fora do
// Windows; vazio para msiexec, rundll32 e caminhos relativos.
func exeDir(cmd, systemRoot string) string {
	exe, _ := splitCommand(cmd)
	if i := strings.LastIndex(exe, ","); i > 0 && !strings.Contains(exe[i:], `\`) {
		exe = exe[:i]
	}
	exe = cleanWin(exe)
	if exe == "" || isMsiexec(exe) || strings.EqualFold(winBase(exe), "rundll32.exe") {
		return ""
	}
	if sys := cleanWin(systemRoot); sys != "" && within(exe, sys) {
		return ""
	}
	i := strings.LastIndex(exe, `\`)
	if i <= 2 {
		return ""
	}
	return exe[:i]
}

// dirs reune as pastas registradas pelo programa.
func (e Entry) dirs(systemRoot string) []string {
	var out []string
	add := func(p string) {
		if p = cleanWin(p); p != "" && !anyEqual(p, out) {
			out = append(out, p)
		}
	}
	add(e.InstallLocation)
	add(e.InnoAppPath)
	add(exeDir(e.DisplayIcon, systemRoot))
	add(exeDir(e.UninstallString, systemRoot))
	return out
}

// target monta a identificacao do programa para a varredura.
func (e Entry) target(systemRoot string) Target {
	return Target{Name: e.Name, Version: e.Version, Publisher: e.Publisher, Key: e.Key, Dirs: e.dirs(systemRoot), ProductCode: e.productCode()}
}

// Codigos de saida.
var (
	// rebootExit: concluido, com reinicio pendente.
	rebootExit = map[int]bool{1641: true, 3010: true}
	// exitMessages explica os codigos mais comuns do Windows Installer.
	exitMessages = map[int]string{
		1602: "cancelado pelo usuario ou pelo proprio desinstalador",
		1603: "erro fatal durante a desinstalacao",
		1605: "o produto nao esta instalado",
		1618: "outra instalacao esta em andamento; tente de novo em alguns minutos",
		1619: "o pacote de instalacao nao foi encontrado",
		1612: "a origem da instalacao nao esta disponivel",
		1625: "bloqueado por politica do sistema",
	}
)

// exitOK informa se o codigo indica desinstalacao concluida (1605: ja nao estava instalado).
func exitOK(code int) bool { return code == 0 || code == 1605 || rebootExit[code] }

func exitText(code int) string {
	if m, ok := exitMessages[code]; ok {
		return fmt.Sprintf("codigo %d: %s", code, m)
	}
	return fmt.Sprintf("codigo %d", code)
}
