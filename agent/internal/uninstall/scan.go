package uninstall

import (
	"fmt"
	"sort"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

// Mode e a profundidade da varredura de sobras, nos moldes do Revo Uninstaller.
type Mode int

const (
	// Safe: so pastas e chaves com o nome exato do programa e os caminhos registrados por ele.
	Safe Mode = iota
	// Moderate: tambem variacoes do nome dentro da pasta do fabricante, atalhos, inicializacao,
	// servicos e tarefas que apontam para as pastas do programa.
	Moderate
	// Advanced: tambem nomes parecidos fora da pasta do fabricante, o registro do Windows Installer
	// e servicos e tarefas pelo nome.
	Advanced
)

// ParseMode interpreta o modo enviado pelo console; o padrao e Moderate.
func ParseMode(s string) Mode {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "safe":
		return Safe
	case "advanced":
		return Advanced
	}
	return Moderate
}

// Tipos de item.
const (
	KindKey     = "key"
	KindValue   = "value"
	KindDir     = "dir"
	KindFile    = "file"
	KindService = "service"
	KindTask    = "task"
)

// maxLeftovers limita a lista enviada ao console.
const maxLeftovers = 500

// Leftover e uma sobra encontrada (ou um item a remover, na limpeza).
type Leftover struct {
	Kind   string `json:"kind"`
	Path   string `json:"path"`
	Name   string `json:"name,omitempty"`
	Detail string `json:"detail,omitempty"`
	Level  string `json:"level,omitempty"`
	// User marca dados de perfil de usuario (configuracoes, historico): o console nao marca por padrao.
	User bool `json:"user,omitempty"`
}

// Target identifica o programa.
type Target struct {
	Name      string
	Version   string
	Publisher string
	// Key e a entrada de desinstalacao (HKLM\...\Uninstall\X).
	Key string
	// Dirs sao as pastas registradas: InstallLocation e as dos executaveis.
	Dirs []string
	// ProductCode e o {GUID} do pacote MSI.
	ProductCode string
}

type dirEntry struct {
	Name string
	Dir  bool
	// Link: ponto de nova analise (junction, link simbolico); nunca e seguido.
	Link bool
}

type namedImage struct {
	Name  string
	Image string
}

// host e o acesso a maquina usado pela varredura (Windows de verdade ou falso nos testes).
type host interface {
	Layout() Layout
	ReadDir(dir string) ([]dirEntry, error)
	IsDir(path string) bool
	DirSize(dir string) (bytes uint64, files int)
	SubKeys(key string) ([]string, error)
	KeyExists(key string) bool
	StringValues(key string) (map[string]string, error)
	Services() []namedImage
	Tasks() []namedImage
}

type scanner struct {
	h     host
	l     Layout
	n     names
	m     Mode
	out   []Leftover
	seen  map[string]bool
	paths []string // pastas do programa (para servicos, tarefas e inicializacao)
}

// Scan procura as sobras do programa.
func Scan(h host, t Target, m Mode) []Leftover {
	s := &scanner{h: h, l: h.Layout(), n: newNames(t.Name, t.Publisher), m: m, seen: map[string]bool{}}
	if t.Key != "" && h.KeyExists(t.Key) {
		s.addKey(t.Key, high, "entrada de desinstalacao do programa")
	}
	for _, d := range t.Dirs {
		if c := cleanWin(d); c != "" && h.IsDir(c) {
			s.addDir(c, high, "pasta registrada pelo programa")
		}
	}
	for _, r := range s.l.fileRoots() {
		s.scanDir(r)
	}
	for _, r := range s.l.regRoots() {
		s.scanKey(r)
	}
	if m >= Moderate {
		s.scanRun()
		s.scanImages(KindService, h.Services())
		s.scanImages(KindTask, h.Tasks())
	}
	if m == Advanced && t.ProductCode != "" {
		if packed := packGUID(t.ProductCode); packed != "" {
			for _, c := range msiContainers {
				if k := c + `\` + packed; h.KeyExists(k) {
					s.addKey(k, medium, "registro do Windows Installer")
				}
			}
		}
	}
	return s.result()
}

// scanDir procura, na raiz, pastas e atalhos com o nome do programa e, na pasta do fabricante,
// os itens do programa (ou a pasta inteira, se so tiver itens dele).
func (s *scanner) scanDir(r fileRoot) {
	entries, err := s.h.ReadDir(r.Path)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.Link || (!e.Dir && !(r.Shortcuts && isShortcut(e.Name))) {
			continue
		}
		p := winJoin(r.Path, e.Name)
		if !e.Dir {
			if lv := s.n.match(trimExt(e.Name), false, s.m); lv > none {
				s.addFile(p, lv, r)
			}
			continue
		}
		if lv := s.n.match(e.Name, false, s.m); lv > none {
			s.addDirIn(p, lv, r)
			continue
		}
		if !s.n.isPublisher(e.Name) {
			continue
		}
		children, err := s.h.ReadDir(p)
		if err != nil {
			continue
		}
		type hit struct {
			path string
			dir  bool
			lv   level
		}
		var hits []hit
		others := 0
		for _, c := range children {
			cp := winJoin(p, c.Name)
			var lv level
			switch {
			case c.Link:
			case c.Dir:
				lv = s.n.match(c.Name, true, s.m)
			case r.Shortcuts && isShortcut(c.Name):
				lv = s.n.match(trimExt(c.Name), true, s.m)
			}
			if lv == none {
				others++
				continue
			}
			hits = append(hits, hit{cp, c.Dir, lv})
		}
		if len(hits) == 0 {
			continue
		}
		if others == 0 && s.m >= Moderate {
			lv := high
			for _, h := range hits {
				lv = min(lv, h.lv)
			}
			s.addDirIn(p, lv, r)
			continue
		}
		for _, h := range hits {
			if h.dir {
				s.addDirIn(h.path, h.lv, r)
			} else {
				s.addFile(h.path, h.lv, r)
			}
		}
	}
}

// scanKey faz no registro o mesmo que scanDir: chaves com o nome do programa e, na chave do
// fabricante, as do programa (ou a do fabricante inteira).
func (s *scanner) scanKey(root string) {
	subs, err := s.h.SubKeys(root)
	if err != nil {
		return
	}
	for _, name := range subs {
		if protectedKeys[strings.ToLower(name)] {
			continue
		}
		k := root + `\` + name
		if lv := s.n.match(name, false, s.m); lv > none {
			s.addKey(k, lv, "")
			continue
		}
		if !s.n.isPublisher(name) {
			continue
		}
		children, err := s.h.SubKeys(k)
		if err != nil || len(children) == 0 {
			continue
		}
		var hits []string
		lv := high
		for _, c := range children {
			if clv := s.n.match(c, true, s.m); clv > none {
				hits = append(hits, c)
				lv = min(lv, clv)
			}
		}
		if len(hits) == 0 {
			continue
		}
		if len(hits) == len(children) && s.m >= Moderate {
			s.addKey(k, lv, "chave do fabricante, so com itens do programa")
			continue
		}
		for _, c := range hits {
			s.addKey(k+`\`+c, s.n.match(c, true, s.m), "")
		}
	}
}

// scanRun procura valores de inicializacao automatica que abrem o programa.
func (s *scanner) scanRun() {
	for _, k := range s.l.runKeys() {
		vals, err := s.h.StringValues(k)
		if err != nil {
			continue
		}
		names := make([]string, 0, len(vals))
		for n := range vals {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			lv := none
			if s.pointsInto(vals[n]) {
				lv = high
			} else {
				lv = s.n.match(n, false, s.m)
			}
			if lv > none && s.l.checkValue(k, n) == nil {
				s.add(Leftover{Kind: KindValue, Path: k, Name: n, Detail: clip(vals[n], 300), Level: lv.String()})
			}
		}
	}
}

// scanImages procura servicos e tarefas que executam algo nas pastas do programa
// (no modo avancado, tambem pelo nome).
func (s *scanner) scanImages(kind string, items []namedImage) {
	for _, it := range items {
		check := checkService
		name := it.Name
		if kind == KindTask {
			check = checkTask
			name = winBase(it.Name)
		}
		if check(it.Path()) != nil || !s.l.imageOutsideSystem(it.Image) {
			continue
		}
		lv := none
		if s.pointsInto(it.Image) {
			lv = high
		} else if s.m == Advanced {
			lv = min(s.n.match(name, false, s.m), medium)
		}
		if lv > none {
			s.add(Leftover{Kind: kind, Path: it.Name, Detail: clip(it.Image, 300), Level: lv.String()})
		}
	}
}

// Path devolve o identificador do item (nome do servico ou caminho da tarefa).
func (n namedImage) Path() string { return n.Name }

func (s *scanner) pointsInto(cmd string) bool {
	low := strings.ToLower(cmd)
	for _, p := range s.paths {
		if strings.Contains(low, strings.ToLower(p)+`\`) {
			return true
		}
	}
	return false
}

func (s *scanner) addDir(p string, lv level, reason string) {
	r, err := s.l.checkPath(p, true)
	if err != nil {
		return
	}
	s.addDirChecked(p, lv, r, reason)
}

func (s *scanner) addDirIn(p string, lv level, r fileRoot) {
	if _, err := s.l.checkPath(p, true); err != nil {
		return
	}
	s.addDirChecked(p, lv, r, "")
}

func (s *scanner) addDirChecked(p string, lv level, r fileRoot, reason string) {
	if lv == high {
		s.paths = append(s.paths, p)
	}
	if r.User {
		lv = min(lv, medium)
	}
	bytes, files := s.h.DirSize(p)
	detail := fmt.Sprintf("%s em %d arquivo(s)", sysinfo.FormatBytes(bytes), files)
	if files == 0 {
		detail = "pasta vazia"
	}
	if reason != "" {
		detail = reason + "; " + detail
	}
	s.add(Leftover{Kind: KindDir, Path: p, Detail: detail, Level: lv.String(), User: r.User})
}

func (s *scanner) addFile(p string, lv level, r fileRoot) {
	if _, err := s.l.checkPath(p, false); err != nil {
		return
	}
	if r.User {
		lv = min(lv, medium)
	}
	s.add(Leftover{Kind: KindFile, Path: p, Detail: "atalho", Level: lv.String(), User: r.User})
}

func (s *scanner) addKey(k string, lv level, reason string) {
	if s.l.checkKey(k) != nil {
		return
	}
	s.add(Leftover{Kind: KindKey, Path: k, Detail: reason, Level: lv.String(), User: strings.HasPrefix(strings.ToUpper(k), `HKU\`)})
}

func (s *scanner) add(it Leftover) {
	id := strings.ToLower(it.Kind + "\x00" + it.Path + "\x00" + it.Name)
	if s.seen[id] || len(s.out) >= maxLeftovers {
		return
	}
	s.seen[id] = true
	s.out = append(s.out, it)
}

// result ordena por tipo e caminho e tira itens que ja saem junto com uma pasta ou chave da lista.
func (s *scanner) result() []Leftover {
	order := map[string]int{KindKey: 0, KindValue: 1, KindDir: 2, KindFile: 3, KindService: 4, KindTask: 5}
	sort.SliceStable(s.out, func(i, j int) bool {
		a, b := s.out[i], s.out[j]
		if order[a.Kind] != order[b.Kind] {
			return order[a.Kind] < order[b.Kind]
		}
		return strings.ToLower(a.Path) < strings.ToLower(b.Path)
	})
	out := make([]Leftover, 0, len(s.out))
	var dirs, keys []string
	for _, it := range s.out {
		switch it.Kind {
		case KindDir, KindFile:
			if anyWithin(it.Path, dirs) {
				continue
			}
			if it.Kind == KindDir {
				dirs = append(dirs, it.Path)
			}
		case KindKey, KindValue:
			if anyWithin(it.Path, keys) || (it.Kind == KindValue && anyEqual(it.Path, keys)) {
				continue
			}
			if it.Kind == KindKey {
				keys = append(keys, it.Path)
			}
		}
		out = append(out, it)
	}
	return out
}

func anyWithin(p string, roots []string) bool {
	for _, r := range roots {
		if within(p, r) {
			return true
		}
	}
	return false
}

func anyEqual(p string, list []string) bool {
	for _, r := range list {
		if strings.EqualFold(p, r) {
			return true
		}
	}
	return false
}

func trimExt(name string) string {
	if i := strings.LastIndex(name, "."); i > 0 {
		return name[:i]
	}
	return name
}

// clip corta textos longos sem quebrar caracteres.
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "..."
}

// packGUID converte {12345678-90AB-CDEF-1234-567890ABCDEF} na forma compactada que o
// Windows Installer usa nas chaves (cada bloco invertido; os dois ultimos, de dois em dois).
func packGUID(g string) string {
	g = strings.ToUpper(strings.Trim(strings.TrimSpace(g), "{}"))
	parts := strings.Split(g, "-")
	if len(parts) != 5 || len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		return ""
	}
	for _, p := range parts {
		for _, c := range p {
			if !strings.ContainsRune("0123456789ABCDEF", c) {
				return ""
			}
		}
	}
	rev := func(s string) string {
		b := []byte(s)
		for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
			b[i], b[j] = b[j], b[i]
		}
		return string(b)
	}
	swapPairs := func(s string) string {
		b := []byte(s)
		for i := 0; i+1 < len(b); i += 2 {
			b[i], b[i+1] = b[i+1], b[i]
		}
		return string(b)
	}
	return rev(parts[0]) + rev(parts[1]) + rev(parts[2]) + swapPairs(parts[3]) + swapPairs(parts[4])
}
