package winsys

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Tipos de valor do registro (mesmos numeros de winnt.h).
const (
	RegNone                     = 0
	RegSZ                       = 1
	RegExpandSZ                 = 2
	RegBinary                   = 3
	RegDWord                    = 4
	RegDWordBigEndian           = 5
	RegLink                     = 6
	RegMultiSZ                  = 7
	RegResourceList             = 8
	RegFullResourceDescriptor   = 9
	RegResourceRequirementsList = 10
	RegQWord                    = 11
)

var regTypeNames = map[uint32]string{
	RegNone:                     "REG_NONE",
	RegSZ:                       "REG_SZ",
	RegExpandSZ:                 "REG_EXPAND_SZ",
	RegBinary:                   "REG_BINARY",
	RegDWord:                    "REG_DWORD",
	RegDWordBigEndian:           "REG_DWORD_BIG_ENDIAN",
	RegLink:                     "REG_LINK",
	RegMultiSZ:                  "REG_MULTI_SZ",
	RegResourceList:             "REG_RESOURCE_LIST",
	RegFullResourceDescriptor:   "REG_FULL_RESOURCE_DESCRIPTOR",
	RegResourceRequirementsList: "REG_RESOURCE_REQUIREMENTS_LIST",
	RegQWord:                    "REG_QWORD",
}

// RegTypeName devolve o nome do tipo (REG_SZ...). Tipos desconhecidos viram REG_0xNN.
func RegTypeName(t uint32) string {
	if n, ok := regTypeNames[t]; ok {
		return n
	}
	return fmt.Sprintf("REG_0x%X", t)
}

// Root identifica uma colmeia raiz pelo nome abreviado.
type Root string

// Colmeias aceitas, na ordem em que aparecem na raiz "computer".
const (
	HKCR Root = "HKCR"
	HKCU Root = "HKCU"
	HKLM Root = "HKLM"
	HKU  Root = "HKU"
	HKCC Root = "HKCC"
)

// Roots lista as colmeias na ordem do Editor do Registro.
var Roots = []Root{HKCR, HKCU, HKLM, HKU, HKCC}

var rootAliases = map[string]Root{
	"HKCR": HKCR, "HKEY_CLASSES_ROOT": HKCR,
	"HKCU": HKCU, "HKEY_CURRENT_USER": HKCU,
	"HKLM": HKLM, "HKEY_LOCAL_MACHINE": HKLM,
	"HKU": HKU, "HKEY_USERS": HKU,
	"HKCC": HKCC, "HKEY_CURRENT_CONFIG": HKCC,
}

// RegPath e um caminho do registro ja separado em colmeia e subchave.
type RegPath struct {
	Root Root
	Sub  string // sem barras nas pontas; vazio = a propria colmeia
}

// String devolve o caminho no formato do console (HKLM\SOFTWARE\...).
func (p RegPath) String() string {
	if p.Sub == "" {
		return string(p.Root)
	}
	return string(p.Root) + `\` + p.Sub
}

// Parent devolve o caminho pai e o nome da ultima parte. Na colmeia, ok e falso.
func (p RegPath) Parent() (parent RegPath, leaf string, ok bool) {
	if p.Sub == "" {
		return p, "", false
	}
	i := strings.LastIndex(p.Sub, `\`)
	if i < 0 {
		return RegPath{Root: p.Root}, p.Sub, true
	}
	return RegPath{Root: p.Root, Sub: p.Sub[:i]}, p.Sub[i+1:], true
}

// ErrRootListing indica o caminho "computer" (lista das colmeias), que nao e uma chave.
var ErrRootListing = errors.New("raiz do registro")

// ParseRegPath interpreta caminhos como "HKLM\SOFTWARE", "HKEY_LOCAL_MACHINE/SOFTWARE" ou
// "Computer\HKLM\SOFTWARE". Devolve ErrRootListing para "computer" ou caminho vazio.
func ParseRegPath(path string) (RegPath, error) {
	path = strings.ReplaceAll(strings.TrimSpace(path), "/", `\`)
	parts := make([]string, 0, 8)
	for _, p := range strings.Split(path, `\`) {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) > 0 && (strings.EqualFold(parts[0], "computer") || strings.EqualFold(parts[0], "computador")) {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return RegPath{}, ErrRootListing
	}
	root, ok := rootAliases[strings.ToUpper(parts[0])]
	if !ok {
		return RegPath{}, fmt.Errorf("colmeia desconhecida: %s (use HKLM, HKCU, HKCR, HKU ou HKCC)", parts[0])
	}
	return RegPath{Root: root, Sub: strings.Join(parts[1:], `\`)}, nil
}

// Limites de exibicao: valores enormes sao cortados para manter a resposta pequena.
const (
	maxDisplayBinary = 4096
	maxDisplayString = 32 << 10
)

// FormatRegValue converte o conteudo cru de um valor no texto exibido pelo console:
// DWORD/QWORD em decimal, BINARY (e tipos desconhecidos) em hex separado por espaco,
// MULTI_SZ com uma linha por entrada.
func FormatRegValue(t uint32, raw []byte) string {
	switch t {
	case RegSZ, RegExpandSZ, RegLink:
		return clip(utf16String(raw), maxDisplayString)
	case RegMultiSZ:
		return clip(strings.Join(utf16Strings(raw), "\n"), maxDisplayString)
	case RegDWord:
		if len(raw) >= 4 {
			return strconv.FormatUint(uint64(binary.LittleEndian.Uint32(raw)), 10)
		}
	case RegDWordBigEndian:
		if len(raw) >= 4 {
			return strconv.FormatUint(uint64(binary.BigEndian.Uint32(raw)), 10)
		}
	case RegQWord:
		if len(raw) >= 8 {
			return strconv.FormatUint(binary.LittleEndian.Uint64(raw), 10)
		}
	}
	return HexBytes(raw, maxDisplayBinary)
}

// HexBytes formata bytes como "01 a0 ff", cortando depois de max bytes (0 = sem limite).
func HexBytes(b []byte, max int) string {
	cut := false
	if max > 0 && len(b) > max {
		b, cut = b[:max], true
	}
	var sb strings.Builder
	sb.Grow(len(b) * 3)
	const digits = "0123456789abcdef"
	for i, c := range b {
		if i > 0 {
			sb.WriteByte(' ')
		}
		sb.WriteByte(digits[c>>4])
		sb.WriteByte(digits[c&0x0f])
	}
	if cut {
		sb.WriteString(" ...")
	}
	return sb.String()
}

func clip(s string, max int) string {
	if len(s) <= max {
		return s
	}
	// Corta numa fronteira de runa.
	i := max
	for i > 0 && (s[i]&0xC0) == 0x80 {
		i--
	}
	return s[:i] + "..."
}

func utf16Units(raw []byte) []uint16 {
	u := make([]uint16, len(raw)/2)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(raw[2*i:])
	}
	return u
}

// utf16String decodifica REG_SZ ate o primeiro NUL.
func utf16String(raw []byte) string {
	u := utf16Units(raw)
	for i, c := range u {
		if c == 0 {
			u = u[:i]
			break
		}
	}
	return string(utf16.Decode(u))
}

// utf16Strings decodifica REG_MULTI_SZ (entradas separadas por NUL, fim com NUL duplo).
func utf16Strings(raw []byte) []string {
	u := utf16Units(raw)
	out := []string{}
	start := 0
	for i, c := range u {
		if c == 0 {
			if i == start {
				// NUL duplo: fim da lista.
				break
			}
			out = append(out, string(utf16.Decode(u[start:i])))
			start = i + 1
		}
	}
	if start < len(u) {
		// Lista sem terminador.
		rest := u[start:]
		if len(rest) > 0 && rest[0] != 0 {
			out = append(out, string(utf16.Decode(rest)))
		}
	}
	return out
}

// RegValueData e um valor ja convertido para gravacao.
type RegValueData struct {
	Type    uint32
	String  string   // REG_SZ, REG_EXPAND_SZ
	Strings []string // REG_MULTI_SZ
	Integer uint64   // REG_DWORD, REG_QWORD
	Binary  []byte   // REG_BINARY
}

// Encode devolve os bytes crus do valor como o Windows os guarda (UTF-16LE com NUL, inteiros little endian).
func (v RegValueData) Encode() []byte {
	switch v.Type {
	case RegSZ, RegExpandSZ:
		return utf16Bytes(v.String, 1)
	case RegMultiSZ:
		var out []byte
		for _, s := range v.Strings {
			out = append(out, utf16Bytes(s, 1)...)
		}
		return append(out, 0, 0)
	case RegDWord:
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, uint32(v.Integer))
		return b
	case RegQWord:
		b := make([]byte, 8)
		binary.LittleEndian.PutUint64(b, v.Integer)
		return b
	}
	return v.Binary
}

func utf16Bytes(s string, nuls int) []byte {
	u := utf16.Encode([]rune(s))
	out := make([]byte, 0, (len(u)+nuls)*2)
	for _, c := range u {
		out = append(out, byte(c), byte(c>>8))
	}
	for i := 0; i < nuls; i++ {
		out = append(out, 0, 0)
	}
	return out
}

// ParseRegValue valida o tipo e converte o texto digitado no console:
// DWORD/QWORD em decimal ou 0x...; BINARY em pares hex separados por espaco ou virgula;
// MULTI_SZ com uma entrada por linha (linhas vazias sao descartadas).
func ParseRegValue(typeName, data string) (RegValueData, error) {
	switch strings.ToUpper(strings.TrimSpace(typeName)) {
	case "REG_SZ":
		if strings.ContainsRune(data, 0) {
			return RegValueData{}, errors.New("o texto nao pode conter o caractere NUL")
		}
		return RegValueData{Type: RegSZ, String: data}, nil
	case "REG_EXPAND_SZ":
		if strings.ContainsRune(data, 0) {
			return RegValueData{}, errors.New("o texto nao pode conter o caractere NUL")
		}
		return RegValueData{Type: RegExpandSZ, String: data}, nil
	case "REG_MULTI_SZ":
		lines := []string{}
		for _, l := range strings.Split(strings.ReplaceAll(data, "\r\n", "\n"), "\n") {
			l = strings.TrimSuffix(l, "\r")
			if l == "" {
				continue
			}
			if strings.ContainsRune(l, 0) {
				return RegValueData{}, errors.New("o texto nao pode conter o caractere NUL")
			}
			lines = append(lines, l)
		}
		return RegValueData{Type: RegMultiSZ, Strings: lines}, nil
	case "REG_DWORD":
		n, err := parseRegInt(data, 32)
		if err != nil {
			return RegValueData{}, fmt.Errorf("valor REG_DWORD invalido: %w", err)
		}
		return RegValueData{Type: RegDWord, Integer: n}, nil
	case "REG_QWORD":
		n, err := parseRegInt(data, 64)
		if err != nil {
			return RegValueData{}, fmt.Errorf("valor REG_QWORD invalido: %w", err)
		}
		return RegValueData{Type: RegQWord, Integer: n}, nil
	case "REG_BINARY":
		b, err := parseRegBinary(data)
		if err != nil {
			return RegValueData{}, err
		}
		return RegValueData{Type: RegBinary, Binary: b}, nil
	}
	return RegValueData{}, fmt.Errorf("tipo de valor nao suportado: %s (use REG_SZ, REG_EXPAND_SZ, REG_MULTI_SZ, REG_DWORD, REG_QWORD ou REG_BINARY)", typeName)
}

// parseRegInt aceita decimal ou hexadecimal com prefixo 0x; vazio vale 0.
func parseRegInt(s string, bits int) (uint64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	base := 10
	if len(s) > 2 && (s[:2] == "0x" || s[:2] == "0X") {
		s, base = s[2:], 16
	}
	n, err := strconv.ParseUint(s, base, bits)
	if err != nil {
		var ne *strconv.NumError
		if errors.As(err, &ne) && errors.Is(ne.Err, strconv.ErrRange) {
			return 0, fmt.Errorf("maior que %d bits", bits)
		}
		return 0, errors.New("informe um numero decimal ou hexadecimal (0x...)")
	}
	return n, nil
}

func parseRegBinary(s string) ([]byte, error) {
	clean := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\r', '\n', ',':
			return -1
		}
		return r
	}, s)
	if len(clean)%2 != 0 {
		return nil, errors.New("valor REG_BINARY invalido: informe bytes em pares hexadecimais (ex.: 01 a0 ff)")
	}
	b, err := hex.DecodeString(clean)
	if err != nil {
		return nil, errors.New("valor REG_BINARY invalido: informe bytes em pares hexadecimais (ex.: 01 a0 ff)")
	}
	return b, nil
}

// RegSubkey e um item de subchave na resposta do registry_browse.
type RegSubkey struct {
	Name       string `json:"name"`
	HasSubkeys bool   `json:"hasSubkeys"`
}

// RegValue e um item de valor na resposta do registry_browse.
type RegValue struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data string `json:"data"`
}

// RegListing e a resposta de sucesso do registry_browse (atencao: hasSubkeys em camelCase e has_more em snake_case).
type RegListing struct {
	Path    string      `json:"path"`
	Subkeys []RegSubkey `json:"subkeys"`
	Values  []RegValue  `json:"values"`
	HasMore bool        `json:"has_more"`
}

// RootListing devolve a lista das colmeias (path "computer").
func RootListing() RegListing {
	l := RegListing{Path: "", Subkeys: make([]RegSubkey, 0, len(Roots)), Values: []RegValue{}}
	for _, r := range Roots {
		l.Subkeys = append(l.Subkeys, RegSubkey{Name: string(r), HasSubkeys: true})
	}
	return l
}

// SortNames ordena nomes sem diferenciar maiusculas (como o Editor do Registro).
func SortNames(names []string) {
	sort.SliceStable(names, func(i, j int) bool {
		a, b := strings.ToLower(names[i]), strings.ToLower(names[j])
		if a == b {
			return names[i] < names[j]
		}
		return a < b
	})
}

// PageWindow calcula a janela de uma pagina sobre subchaves seguidas de valores.
// Devolve os intervalos [ks,ke) das subchaves e [vs,ve) dos valores, e se ha mais itens.
func PageWindow(nKeys, nValues, page, size int) (ks, ke, vs, ve int, more bool) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 200
	}
	total := nKeys + nValues
	start := (page - 1) * size
	if start > total || start < 0 {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	ks, ke = min(start, nKeys), min(end, nKeys)
	vs, ve = max(start-nKeys, 0), max(end-nKeys, 0)
	return ks, ke, vs, ve, end < total
}
