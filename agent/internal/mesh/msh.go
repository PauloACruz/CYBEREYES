package mesh

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Settings e o vinculo de um MeshAgent: servidor e grupo de dispositivos (arquivo .msh).
type Settings struct {
	Server string // MeshServer, por exemplo wss://rc.exemplo.com:443/agent.ashx
	MeshID string // MeshID do grupo (0x...)
}

// Valid informa se os dois campos foram lidos.
func (s Settings) Valid() bool { return s.Server != "" && s.MeshID != "" }

// Same compara servidor (sem diferenciar maiusculas) e grupo.
func (s Settings) Same(o Settings) bool {
	return strings.EqualFold(s.Server, o.Server) && strings.EqualFold(s.MeshID, o.MeshID)
}

// Aceita o formato do .msh (MeshServer=...) e o JSON embutido no instalador de Linux e macOS ("MeshServer":"...").
var mshLine = regexp.MustCompile(`"?(MeshServer)"?\s*[=:]\s*"?(wss?://[^\s"'\x00]+)|"?(MeshID)"?\s*[=:]\s*"?(0x[0-9A-Fa-f]+)`)

// parseMsh le MeshServer e MeshID de um .msh ou do bloco embutido no binario do MeshAgent.
func parseMsh(data []byte) Settings {
	var s Settings
	for _, m := range mshLine.FindAllSubmatch(data, -1) {
		key, v := string(m[1]), strings.TrimSpace(string(m[2]))
		if key == "" {
			key, v = string(m[3]), strings.TrimSpace(string(m[4]))
		}
		switch key {
		case "MeshServer":
			if s.Server == "" {
				s.Server = v
			}
		case "MeshID":
			if s.MeshID == "" {
				s.MeshID = v
			}
		}
	}
	return s
}

// EmbeddedSettings le o vinculo embutido no instalador baixado do MeshCentral.
func EmbeddedSettings(binary string) Settings {
	data, err := os.ReadFile(binary)
	if err != nil {
		return Settings{}
	}
	// O bloco .msh fica no fim do executavel; textos UTF-16 sao convertidos para a busca.
	s := parseMsh(data)
	if !s.Valid() {
		s = parseMsh(bytes.ReplaceAll(data, []byte{0}, nil))
	}
	return s
}

// InstalledSettings le o .msh do MeshAgent instalado.
func InstalledSettings() Settings {
	bin := Binary()
	if bin == "" {
		return Settings{}
	}
	dir := filepath.Dir(bin)
	base := strings.TrimSuffix(filepath.Base(bin), filepath.Ext(bin))
	for _, name := range []string{base + ".msh", "MeshAgent.msh", "meshagent.msh"} {
		if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			if s := parseMsh(data); s.Valid() {
				return s
			}
		}
	}
	return Settings{}
}
