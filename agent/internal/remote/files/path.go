// Package files atende o canal files do acesso remoto no servico do EYES (contrato, secao 7): navegar, criar,
// renomear e apagar, receber arquivos em blocos com retomada e enviar arquivos ou pastas (zip), com SHA-256.
package files

import (
	"errors"
	"path"
	"strings"
)

// ErrInvalidPath e o erro invalid-path do contrato.
var ErrInvalidPath = errors.New("caminho invalido")

var reservedWindows = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true, "CONIN$": true, "CONOUT$": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// CheckPath valida e normaliza um caminho absoluto do sistema goos (contrato, secao 7.3): recusa "..", caractere
// nulo e, no Windows, prefixos de dispositivo, nomes reservados e ":" fora da letra da unidade.
func CheckPath(goos, p string) (string, error) {
	if p == "" || strings.ContainsRune(p, 0) {
		return "", ErrInvalidPath
	}
	if goos == "windows" {
		return checkWindows(p)
	}
	if !strings.HasPrefix(p, "/") {
		return "", ErrInvalidPath
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return "", ErrInvalidPath
		}
	}
	return path.Clean(p), nil
}

func checkWindows(p string) (string, error) {
	p = strings.ReplaceAll(p, "/", `\`)
	if strings.HasPrefix(p, `\\.\`) || strings.HasPrefix(p, `\\?\`) {
		return "", ErrInvalidPath
	}
	var prefix, rest string
	switch {
	case len(p) >= 2 && p[1] == ':' && isLetter(p[0]):
		prefix, rest = strings.ToUpper(p[:1])+":", p[2:]
		if rest == "" {
			rest = `\`
		}
		if !strings.HasPrefix(rest, `\`) {
			return "", ErrInvalidPath
		}
	case strings.HasPrefix(p, `\\`):
		// Compartilhamento de rede: \\servidor\pasta\...
		parts := strings.SplitN(p[2:], `\`, 3)
		if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
			return "", ErrInvalidPath
		}
		prefix = `\\` + parts[0] + `\` + parts[1]
		rest = `\`
		if len(parts) == 3 {
			rest += parts[2]
		}
	default:
		return "", ErrInvalidPath
	}
	var clean []string
	for _, seg := range strings.Split(rest, `\`) {
		switch {
		case seg == "" || seg == ".":
			continue
		case seg == "..":
			return "", ErrInvalidPath
		case strings.ContainsAny(seg, `:*?"<>|`):
			return "", ErrInvalidPath
		}
		base := strings.ToUpper(strings.TrimRight(seg, ". "))
		if i := strings.IndexByte(base, '.'); i >= 0 {
			base = base[:i]
		}
		if reservedWindows[base] {
			return "", ErrInvalidPath
		}
		clean = append(clean, seg)
	}
	out := prefix + `\` + strings.Join(clean, `\`)
	if strings.HasPrefix(prefix, `\\`) && len(clean) == 0 {
		out = prefix
	}
	return out, nil
}

func isLetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }

// Join junta pasta e nome no formato do sistema goos, recusando nome com separador ou "..".
func Join(goos, dir, name string) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/`) || (goos == "windows" && strings.ContainsRune(name, '\\')) {
		return "", ErrInvalidPath
	}
	sep := "/"
	if goos == "windows" {
		sep = `\`
	}
	return CheckPath(goos, strings.TrimRight(dir, sep)+sep+name)
}
