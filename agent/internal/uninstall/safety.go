package uninstall

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/winsys"
)

// Regras do que pode ser removido. A varredura so propoe itens que passam por elas e a limpeza
// confere cada item de novo antes de apagar: o que o console manda nunca vale por si so.
// Os caminhos seguem a sintaxe do Windows em qualquer sistema (os testes rodam no Linux).

// Layout descreve as pastas e colmeias da maquina.
type Layout struct {
	SystemRoot    string   // C:\Windows
	ProgramFiles  []string // C:\Program Files, C:\Program Files (x86)
	CommonFiles   []string // C:\Program Files\Common Files e a de 32 bits
	ProgramData   string   // C:\ProgramData
	StartMenu     string   // menu Iniciar de todos os usuarios (...\Start Menu\Programs)
	PublicDesktop string   // C:\Users\Public\Desktop
	Profiles      []string // pastas dos perfis (C:\Users\joao)
	UserHives     []string // SIDs com a colmeia carregada em HKU
	Own           []string // pastas do proprio EYES: nunca entram
}

// fileRoot e uma pasta onde programas deixam sobras.
type fileRoot struct {
	Path string
	// Shortcuts: menu Iniciar e area de trabalho, onde atalhos (.lnk, .url) tambem contam.
	Shortcuts bool
	// User: dados de um perfil de usuario (nunca vem marcado por padrao).
	User bool
}

func (l Layout) fileRoots() []fileRoot {
	var out []fileRoot
	add := func(p string, shortcuts, user bool) {
		if p = cleanWin(p); p != "" {
			for _, r := range out {
				if strings.EqualFold(r.Path, p) {
					return
				}
			}
			out = append(out, fileRoot{Path: p, Shortcuts: shortcuts, User: user})
		}
	}
	for _, p := range l.ProgramFiles {
		add(p, false, false)
	}
	for _, p := range l.CommonFiles {
		add(p, false, false)
	}
	add(l.ProgramData, false, false)
	add(l.StartMenu, true, false)
	add(l.PublicDesktop, true, false)
	for _, p := range l.Profiles {
		add(winJoin(p, `AppData\Local\Programs`), false, true)
		add(winJoin(p, `AppData\Roaming\Microsoft\Windows\Start Menu\Programs`), true, true)
		add(winJoin(p, `AppData\Roaming`), false, true)
		add(winJoin(p, `AppData\Local`), false, true)
		add(winJoin(p, `AppData\LocalLow`), false, true)
		add(winJoin(p, "Desktop"), true, true)
	}
	return out
}

// regRoots sao as chaves SOFTWARE da maquina (64 e 32 bits) e de cada usuario.
func (l Layout) regRoots() []string {
	out := []string{`HKLM\SOFTWARE`, `HKLM\SOFTWARE\WOW6432Node`}
	for _, sid := range l.UserHives {
		out = append(out, `HKU\`+sid+`\Software`)
	}
	return out
}

const (
	uninstallSub = `Microsoft\Windows\CurrentVersion\Uninstall`
	runSub       = `Microsoft\Windows\CurrentVersion\Run`
)

// msiContainers guardam o registro do Windows Installer de cada produto (GUID compactado).
var msiContainers = []string{
	`HKLM\SOFTWARE\Classes\Installer\Products`,
	`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData\S-1-5-18\Products`,
}

func (l Layout) runKeys() []string {
	var out []string
	for _, r := range l.regRoots() {
		out = append(out, r+`\`+runSub)
	}
	return out
}

// protectedDirs nunca aparecem como parte do caminho abaixo da pasta raiz.
var protectedDirs = map[string]bool{
	"microsoft": true, "windows": true, "windowsapps": true, "modifiablewindowsapps": true, "windows defender": true,
	"windows defender advanced threat protection": true, "windows nt": true, "windows mail": true, "windows media player": true,
	"windows photo viewer": true, "windows sidebar": true, "windows portable devices": true, "windows security": true,
	"windowspowershell": true, "powershell": true, "common files": true, "microsoft.net": true, "reference assemblies": true,
	"msbuild": true, "packages": true, "package cache": true, "temp": true, "tmp": true, "installer": true,
	"internet explorer": true, "dotnet": true, "desktop": true, "documents": true, "start menu": true, "programs": true,
	"appdata": true, "local": true, "roaming": true, "locallow": true, "application data": true, "all users": true,
	"default": true, "public": true, "ssh": true, "usoshared": true, "usoprivate": true, "softwaredistribution": true,
	"system32": true, "syswow64": true, "drivers": true, "driverstore": true, "regid.1991-06.com.microsoft": true,
	"cybereyes": true, "crashdumps": true, "d3dscache": true, "connecteddevicesplatform": true, "comms": true,
	"history": true, "virtualstore": true, "publishers": true, "identities": true,
}

// protectedKeys nunca aparecem como parte da chave abaixo de SOFTWARE.
var protectedKeys = map[string]bool{
	"microsoft": true, "classes": true, "policies": true, "wow6432node": true, "clients": true,
	"registeredapplications": true, "odbc": true, "windows": true, "windows nt": true, "description": true,
	"cybereyes": true, "appdatalow": true,
}

// Limites de profundidade abaixo da raiz.
const (
	maxDirDepth = 4
	maxKeyDepth = 2
)

// cleanWin normaliza um caminho do Windows: barras invertidas, sem barra no fim e sem repeticoes.
// Devolve "" para caminhos invalidos (relativos, UNC, com curingas ou com "." e "..").
func cleanWin(p string) string {
	p = strings.TrimSpace(strings.Trim(strings.TrimSpace(p), `"`))
	p = strings.ReplaceAll(p, "/", `\`)
	if len(p) < 3 || p[1] != ':' || p[2] != '\\' || !isLetter(p[0]) {
		return ""
	}
	if strings.ContainsAny(p, `*?"<>|`) || strings.Contains(p[2:], ":") {
		return ""
	}
	parts := strings.Split(p[3:], `\`)
	out := []string{strings.ToUpper(p[:1]) + ":"}
	for _, s := range parts {
		switch s {
		case "":
			continue
		case ".", "..":
			return ""
		}
		if strings.TrimRight(s, " .") != s {
			// "pasta." e "pasta " apontam para outra coisa no Win32: recusa.
			return ""
		}
		out = append(out, s)
	}
	if len(out) == 1 {
		return out[0] + `\`
	}
	return strings.Join(out, `\`)
}

func isLetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }

func winJoin(a, b string) string {
	if a == "" {
		return ""
	}
	return strings.TrimRight(a, `\`) + `\` + strings.TrimLeft(b, `\`)
}

func winBase(p string) string {
	if i := strings.LastIndex(p, `\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// within informa se p esta dentro de root (nao vale o proprio root).
func within(p, root string) bool {
	if root == "" {
		return false
	}
	r := strings.ToLower(strings.TrimRight(root, `\`)) + `\`
	return strings.HasPrefix(strings.ToLower(p), r) && len(p) > len(r)
}

func sameOrWithin(p, root string) bool { return strings.EqualFold(p, root) || within(p, root) }

func isShortcut(name string) bool {
	n := strings.ToLower(name)
	return strings.HasSuffix(n, ".lnk") || strings.HasSuffix(n, ".url")
}

// checkPath confere uma pasta (dir) ou atalho (file) e devolve a raiz onde ele esta.
func (l Layout) checkPath(p string, dir bool) (fileRoot, error) {
	c := cleanWin(p)
	if c == "" {
		return fileRoot{}, fmt.Errorf("caminho invalido: %q", p)
	}
	if sys := cleanWin(l.SystemRoot); sys != "" && sameOrWithin(c, sys) {
		return fileRoot{}, errors.New("pasta do Windows")
	}
	for _, own := range l.Own {
		if o := cleanWin(own); o != "" && (sameOrWithin(c, o) || within(o, c)) {
			return fileRoot{}, errors.New("pasta do agente EYES")
		}
	}
	var root fileRoot
	for _, r := range l.fileRoots() {
		if within(c, r.Path) && len(r.Path) > len(root.Path) {
			root = r
		}
	}
	if root.Path == "" {
		return fileRoot{}, errors.New("fora das pastas de programas e de dados")
	}
	rel := strings.Split(c[len(root.Path)+1:], `\`)
	if len(rel) > maxDirDepth {
		return fileRoot{}, errors.New("caminho profundo demais")
	}
	for _, s := range rel {
		if protectedDirs[strings.ToLower(s)] {
			return fileRoot{}, fmt.Errorf("pasta protegida: %s", s)
		}
	}
	if !dir {
		if !root.Shortcuts || len(rel) > 2 || !isShortcut(c) {
			return fileRoot{}, errors.New("so atalhos do menu Iniciar e da area de trabalho podem ser removidos como arquivo")
		}
	}
	return root, nil
}

// checkKey confere uma chave do registro.
func (l Layout) checkKey(key string) error {
	p, err := winsys.ParseRegPath(key)
	if err != nil {
		return fmt.Errorf("chave invalida: %q", key)
	}
	full := p.String()
	if strings.Contains(full, `\\`) {
		return fmt.Errorf("chave invalida: %q", key)
	}
	parent, leaf, ok := p.Parent()
	if !ok || leaf == "" {
		return errors.New("chave raiz")
	}
	// Filhas diretas dos conteineres conhecidos (entrada de desinstalacao e registro do MSI).
	for _, c := range l.keyContainers() {
		if strings.EqualFold(parent.String(), c) {
			return nil
		}
	}
	root := l.regRootOf(full)
	if root == "" {
		return errors.New("fora de SOFTWARE")
	}
	rel := strings.Split(full[len(root)+1:], `\`)
	if len(rel) > maxKeyDepth {
		return errors.New("chave profunda demais")
	}
	for _, s := range rel {
		if protectedKeys[strings.ToLower(s)] {
			return fmt.Errorf("chave protegida: %s", s)
		}
	}
	return nil
}

// checkValue confere um valor: so os de inicializacao automatica (Run).
func (l Layout) checkValue(key, name string) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("valor sem nome")
	}
	for _, r := range l.runKeys() {
		if strings.EqualFold(key, r) {
			return nil
		}
	}
	return errors.New("so valores de inicializacao (Run) podem ser removidos")
}

// keyContainers sao as chaves cujas filhas diretas podem sair inteiras.
func (l Layout) keyContainers() []string {
	out := append([]string(nil), msiContainers...)
	for _, r := range l.regRoots() {
		out = append(out, r+`\`+uninstallSub)
	}
	return out
}

// regRootOf devolve a raiz SOFTWARE mais especifica que contem a chave.
func (l Layout) regRootOf(key string) string {
	best := ""
	for _, r := range l.regRoots() {
		if within(key, r) && len(r) > len(best) {
			best = r
		}
	}
	return best
}

// checkService confere o nome de um servico (o caminho do executavel e conferido no Windows).
func checkService(name string) error {
	n := strings.TrimSpace(name)
	if n == "" || len(n) > 256 || strings.ContainsAny(n, `\/`) {
		return fmt.Errorf("servico invalido: %q", name)
	}
	if strings.EqualFold(n, ownService) {
		return errors.New("servico do agente EYES")
	}
	return nil
}

// checkTask confere o caminho de uma tarefa agendada.
func checkTask(name string) error {
	if !strings.HasPrefix(name, `\`) || len(name) < 2 || strings.ContainsAny(name, `*?"<>|/`) {
		return fmt.Errorf("tarefa invalida: %q", name)
	}
	for _, s := range strings.Split(name[1:], `\`) {
		if s == "" || s == "." || s == ".." {
			return fmt.Errorf("tarefa invalida: %q", name)
		}
	}
	if low := strings.ToLower(name); strings.HasPrefix(low, `\microsoft\`) || strings.Contains(low, "cybereyes") {
		return errors.New("tarefa protegida")
	}
	return nil
}

// imageOutsideSystem informa se o executavel de um servico ou tarefa fica fora do Windows e do EYES.
func (l Layout) imageOutsideSystem(image string) bool {
	low := strings.ToLower(image)
	if low == "" || strings.Contains(low, "svchost.exe") {
		return false
	}
	if sys := strings.ToLower(cleanWin(l.SystemRoot)); sys != "" && strings.Contains(low, sys+`\`) {
		return false
	}
	for _, own := range l.Own {
		if o := strings.ToLower(cleanWin(own)); o != "" && strings.Contains(low, o) {
			return false
		}
	}
	return true
}

// check confere qualquer item antes de apagar.
func (l Layout) check(it Leftover) error {
	switch it.Kind {
	case KindDir:
		_, err := l.checkPath(it.Path, true)
		return err
	case KindFile:
		_, err := l.checkPath(it.Path, false)
		return err
	case KindKey:
		return l.checkKey(it.Path)
	case KindValue:
		return l.checkValue(it.Path, it.Name)
	case KindService:
		return checkService(it.Path)
	case KindTask:
		return checkTask(it.Path)
	}
	return fmt.Errorf("tipo de item desconhecido: %q", it.Kind)
}
