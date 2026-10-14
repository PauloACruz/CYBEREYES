package uninstall

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Nomes usados para achar sobras: o nome exibido do programa vira algumas variantes
// (com e sem fabricante, sem versao e arquitetura) e cada pasta ou chave e comparada
// pela forma normalizada (minusculas, sem acentos, espacos e pontuacao).

// stopwords nunca servem sozinhas como nome de programa: casariam com pastas de terceiros.
var stopwords = map[string]bool{
	"microsoft": true, "windows": true, "update": true, "updater": true, "driver": true, "drivers": true,
	"runtime": true, "redistributable": true, "sdk": true, "tool": true, "tools": true, "app": true, "apps": true,
	"application": true, "client": true, "service": true, "services": true, "setup": true, "installer": true,
	"install": true, "common": true, "shared": true, "system": true, "program": true, "programs": true,
	"software": true, "data": true, "user": true, "users": true, "temp": true, "tmp": true, "cache": true,
	"local": true, "help": true, "plugin": true, "plugins": true, "x64": true, "x86": true, "media": true,
	"player": true, "office": true, "manager": true, "agent": true, "helper": true, "core": true, "default": true,
	"documents": true, "desktop": true, "config": true, "settings": true, "logs": true, "log": true, "bin": true,
	"lib": true, "packages": true, "package": true, "start": true, "menu": true, "the": true, "for": true,
	"and": true, "pro": true, "free": true, "lite": true, "edition": true, "suite": true, "studio": true,
	"server": true, "security": true, "network": true, "online": true, "cloud": true, "web": true, "files": true,
	"intel": true, "amd": true, "nvidia": true, "google": true, "apple": true, "adobe": true, "oracle": true,
	"java": true, "python": true, "net": true, "dotnet": true, "visual": true, "cybereyes": true, "eyes": true,
}

// legalSuffixes saem do fim do nome do fabricante ("Google LLC" -> "Google").
var legalSuffixes = []string{
	"corporation", "corp", "incorporated", "inc", "llc", "ltd", "ltda", "limited", "gmbh", "ag", "sa", "s a",
	"srl", "bv", "b v", "co", "company", "plc", "oy", "ab", "as", "kg", "team", "software", "technologies",
	"technology", "systems", "group", "foundation", "project", "eireli", "me", "epp",
}

var (
	// parenRe tira trechos entre parenteses ou colchetes ("(x64 pt-BR)", "[64-bit]").
	parenRe = regexp.MustCompile(`\s*[\(\[][^\)\]]*[\)\]]`)
	// versionRe tira a versao do fim ("7-Zip 23.01", "Foo v2.1.0 beta").
	versionRe = regexp.MustCompile(`(?i)[\s_-]+v?\d+(\.\d+)+\b.*$`)
	// archRe tira marcas de arquitetura soltas.
	archRe = regexp.MustCompile(`(?i)\b(x64|x86|amd64|arm64|win64|win32|64[- ]?bits?|32[- ]?bits?)\b`)
	// dashTailRe tira complementos depois de " - " ("Reader DC - Portugues").
	dashTailRe = regexp.MustCompile(`\s+[-–—]\s+.*$`)
	spacesRe   = regexp.MustCompile(`\s+`)
)

// cleanName tira versao, arquitetura, idioma e complementos do nome exibido.
func cleanName(name string) string {
	s := strings.TrimSpace(name)
	s = parenRe.ReplaceAllString(s, "")
	s = dashTailRe.ReplaceAllString(s, "")
	s = versionRe.ReplaceAllString(s, "")
	s = archRe.ReplaceAllString(s, "")
	s = spacesRe.ReplaceAllString(s, " ")
	return strings.Trim(s, " -_.,;:")
}

// cleanPublisher tira a forma juridica do fabricante ("Mozilla Corporation" -> "Mozilla").
func cleanPublisher(p string) string {
	s := strings.TrimRight(strings.TrimSpace(parenRe.ReplaceAllString(p, "")), " .,")
	for {
		lower := strings.ToLower(s)
		cut := false
		for _, suf := range legalSuffixes {
			if len(lower) == len(s) && strings.HasSuffix(lower, " "+suf) {
				s = strings.TrimRight(s[:len(s)-len(suf)], " .,")
				cut = true
				break
			}
		}
		if !cut {
			return s
		}
	}
}

// normalize deixa so letras, digitos, "+" e "#", em minusculas e sem acentos.
func normalize(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		switch {
		case unicode.Is(unicode.Mn, r):
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(unicode.ToLower(r))
		case r == '+' || r == '#':
			b.WriteRune(r)
		}
	}
	return b.String()
}

// distinctive informa se a forma normalizada serve como nome de programa.
func distinctive(n string) bool {
	return len([]rune(n)) >= 3 && !stopwords[n] && strings.IndexFunc(n, unicode.IsLetter) >= 0
}

// names reune as formas normalizadas usadas na comparacao.
type names struct {
	// exact: nome limpo e nome sem o fabricante ("mozillafirefox", "firefox").
	exact []string
	// token: primeira palavra do nome, quando distinta ("vlc" de "VLC media player").
	token string
	// publishers: fabricante completo e sem a forma juridica ("nvidiacorporation", "nvidia").
	publishers []string
}

func newNames(display, publisher string) names {
	var n names
	add := func(list *[]string, s string) {
		v := normalize(s)
		if !distinctive(v) {
			return
		}
		for _, x := range *list {
			if x == v {
				return
			}
		}
		*list = append(*list, v)
	}
	clean := cleanName(display)
	if clean == "" {
		clean = strings.TrimSpace(display)
	}
	add(&n.exact, clean)
	pub := cleanPublisher(publisher)
	for _, p := range []string{publisher, pub} {
		add(&n.publishers, p)
	}
	// Nome sem o fabricante no inicio: "Mozilla Firefox" -> "Firefox".
	if pub != "" {
		lower := strings.ToLower(clean)
		for _, p := range []string{strings.ToLower(pub), strings.ToLower(strings.Fields(pub + " x")[0])} {
			if p != "" && strings.HasPrefix(lower, p+" ") {
				add(&n.exact, clean[len(p)+1:])
				break
			}
		}
	}
	if f := strings.Fields(clean); len(f) > 1 {
		if t := normalize(f[0]); distinctive(t) && !containsStr(n.exact, t) && !containsStr(n.publishers, t) {
			n.token = t
		}
	}
	return n
}

// level e a confianca de que o item pertence ao programa.
type level int

const (
	none level = iota
	low
	medium
	high
)

func (l level) String() string {
	switch l {
	case high:
		return "high"
	case medium:
		return "medium"
	case low:
		return "low"
	}
	return ""
}

// match compara o nome de uma pasta, chave, atalho ou tarefa com o programa.
// inPublisher indica que o item esta dentro da pasta ou chave do fabricante, o que torna
// as comparacoes parciais mais seguras.
func (n names) match(item string, inPublisher bool, m Mode) level {
	v := normalize(item)
	if v == "" {
		return none
	}
	if containsStr(n.exact, v) {
		return high
	}
	if m == Safe {
		return none
	}
	if n.token != "" && v == n.token {
		if inPublisher {
			return medium
		}
		if m == Advanced {
			return low
		}
	}
	for _, e := range n.exact {
		if len(e) >= 4 && strings.HasPrefix(v, e) {
			if inPublisher {
				return medium
			}
			if m == Advanced {
				return low
			}
		}
	}
	return none
}

// isPublisher informa se o nome e a pasta ou chave do fabricante.
func (n names) isPublisher(item string) bool { return containsStr(n.publishers, normalize(item)) }

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
