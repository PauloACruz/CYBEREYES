package inventory

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

// Interpretadores das listas de software de cada sistema. Ficam sem tag de build para os testes.

const dateLayout = "2006-01-02"

// dpkgEntry e um pacote do dpkg com a arquitetura (para achar o arquivo .list da data de instalacao).
type dpkgEntry struct {
	Software
	Arch string
}

// dpkgFormat e o formato pedido ao dpkg-query (separado por tabulacao).
const dpkgFormat = `${db:Status-Abbrev}\t${Package}\t${Version}\t${Architecture}\t${Maintainer}\t${Installed-Size}\n`

// parseDpkg interpreta a saida de dpkg-query -W -f=dpkgFormat, so com pacotes instalados.
func parseDpkg(out string) []dpkgEntry {
	var list []dpkgEntry
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 6 {
			continue
		}
		status := f[0]
		if len(status) < 2 || status[1] != 'i' {
			continue
		}
		e := dpkgEntry{Arch: f[3], Software: Software{
			Name:      f[1],
			Version:   f[2],
			Publisher: maintainerName(f[4]),
			Source:    "dpkg",
			Uninstall: "apt-get remove -y " + f[1],
		}}
		if kb, err := strconv.ParseUint(strings.TrimSpace(f[5]), 10, 64); err == nil && kb > 0 {
			e.Size = sysinfo.FormatBytes(kb * 1024)
		}
		list = append(list, e)
	}
	return list
}

// maintainerName tira o e-mail de "Nome <email>".
func maintainerName(s string) string {
	if i := strings.Index(s, "<"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// rpmFormat e o formato pedido ao rpm -qa --queryformat.
const rpmFormat = `%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\t%{VENDOR}\t%{SIZE}\t%{INSTALLTIME}\n`

// parseRpm interpreta a saida de rpm -qa --queryformat rpmFormat.
func parseRpm(out, removeCmd string) []Software {
	var list []Software
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 6 || f[0] == "" || f[0] == "gpg-pubkey" {
			continue
		}
		s := Software{Name: f[0], Version: f[1], Publisher: noneEmpty(f[3]), Source: "rpm", Uninstall: removeCmd + " " + f[0]}
		if n, err := strconv.ParseUint(strings.TrimSpace(f[4]), 10, 64); err == nil && n > 0 {
			s.Size = sysinfo.FormatBytes(n)
		}
		if n, err := strconv.ParseInt(strings.TrimSpace(f[5]), 10, 64); err == nil && n > 0 {
			s.InstallDate = time.Unix(n, 0).Format(dateLayout)
		}
		list = append(list, s)
	}
	return list
}

func noneEmpty(s string) string {
	s = strings.TrimSpace(s)
	if s == "(none)" {
		return ""
	}
	return s
}

// parseSnap interpreta "snap list": Name Version Rev Tracking Publisher Notes.
func parseSnap(out string) []Software {
	var list []Software
	for i, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || (i == 0 && f[0] == "Name") {
			continue
		}
		s := Software{Name: f[0], Version: f[1], Source: "snap", Uninstall: "snap remove " + f[0]}
		if len(f) >= 5 && f[4] != "-" {
			s.Publisher = strings.TrimRight(f[4], "✓*✪")
		}
		list = append(list, s)
	}
	return list
}

var multiSpace = regexp.MustCompile(`\s{2,}`)

// parseFlatpak interpreta "flatpak list --app --columns=name,application,version,origin".
func parseFlatpak(out string) []Software {
	var list []Software
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var f []string
		if strings.Contains(line, "\t") {
			f = strings.Split(line, "\t")
		} else {
			f = multiSpace.Split(line, -1)
		}
		if len(f) < 2 || f[0] == "Name" {
			continue
		}
		s := Software{Name: f[0], Location: f[1], Source: "flatpak", Uninstall: "flatpak uninstall -y " + f[1]}
		if len(f) >= 3 {
			s.Version = f[2]
		}
		list = append(list, s)
	}
	return list
}

// parsePacman interpreta "pacman -Qi" (blocos "Chave : valor" separados por linha em branco), com LC_ALL=C.
func parsePacman(out string) []Software {
	var list []Software
	cur := map[string]string{}
	flush := func() {
		if cur["Name"] != "" {
			s := Software{Name: cur["Name"], Version: cur["Version"], Publisher: maintainerName(cur["Packager"]),
				Size:   strings.Replace(strings.Replace(cur["Installed Size"], "iB", "B", 1), "  ", " ", -1),
				Source: "pacman", Uninstall: "pacman -R --noconfirm " + cur["Name"], InstallDate: pacmanDate(cur["Install Date"])}
			list = append(list, s)
		}
		cur = map[string]string{}
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue
		}
		cur[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	flush()
	return list
}

func pacmanDate(s string) string {
	for _, layout := range []string{"Mon 02 Jan 2006 03:04:05 PM MST", "Mon 02 Jan 2006 15:04:05 MST", "Mon Jan _2 15:04:05 2006", "Mon 02 Jan 2006 03:04:05 PM -07", "Mon 02 Jan 2006 15:04:05 -07"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format(dateLayout)
		}
	}
	return s
}

// formatInstallDate converte AAAAMMDD (registro do Windows) em AAAA-MM-DD; outros formatos ficam como estao.
func formatInstallDate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 8 {
		if t, err := time.Parse("20060102", s); err == nil {
			return t.Format(dateLayout)
		}
	}
	return s
}

// macApp e um item de system_profiler SPApplicationsDataType -json.
type macApp struct {
	Name         string   `json:"_name"`
	Version      string   `json:"version"`
	ObtainedFrom string   `json:"obtained_from"`
	Path         string   `json:"path"`
	LastModified string   `json:"lastModified"`
	SignedBy     []string `json:"signed_by"`
}

// parseMacApps interpreta a saida JSON do system_profiler, sem os apps internos do sistema.
func parseMacApps(data []byte) ([]Software, error) {
	var doc struct {
		Apps []macApp `json:"SPApplicationsDataType"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	list := make([]Software, 0, len(doc.Apps))
	for _, a := range doc.Apps {
		if a.Name == "" || systemAppPath(a.Path) {
			continue
		}
		s := Software{Name: a.Name, Version: a.Version, Publisher: macPublisher(a.ObtainedFrom, a.SignedBy), Source: "app", Location: a.Path}
		if a.ObtainedFrom == "mac_app_store" {
			s.Source = "appstore"
		}
		if t, err := time.Parse(time.RFC3339, a.LastModified); err == nil {
			s.InstallDate = t.Format(dateLayout)
		}
		list = append(list, s)
	}
	return list, nil
}

// systemAppPath identifica apps que fazem parte do proprio macOS.
func systemAppPath(p string) bool {
	for _, pre := range []string{"/System/", "/Library/Apple/", "/usr/", "/private/", "/Library/Developer/CommandLineTools/", "/Library/Image Capture/"} {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

// macPublisher extrai o desenvolvedor da assinatura ("Developer ID Application: Google LLC (EQHXZ8M8AV)").
func macPublisher(obtained string, signedBy []string) string {
	if obtained == "apple" {
		return "Apple"
	}
	if len(signedBy) == 0 {
		return ""
	}
	s := signedBy[0]
	_, rest, ok := strings.Cut(s, ": ")
	if !ok {
		return ""
	}
	if i := strings.LastIndex(rest, " ("); i > 0 && strings.HasSuffix(rest, ")") {
		rest = rest[:i]
	}
	return strings.TrimSpace(rest)
}

// parsePlistStrings le os valores texto do dicionario raiz de um plist XML (Info.plist).
func parsePlistStrings(data []byte) map[string]string {
	out := map[string]string{}
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = false
	depth := 0
	key := ""
	for {
		tok, err := dec.Token()
		if err != nil {
			return out
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if depth != 3 {
				continue
			}
			switch t.Name.Local {
			case "key":
				var s string
				if dec.DecodeElement(&s, &t) == nil {
					key = s
				}
				depth--
			case "string":
				var s string
				if dec.DecodeElement(&s, &t) == nil && key != "" {
					out[key] = strings.TrimSpace(s)
				}
				key = ""
				depth--
			default:
				key = ""
			}
		case xml.EndElement:
			depth--
		}
	}
}
