package devices

import (
	"fmt"
	"math/big"
	"strings"
)

// Este arquivo nao tem restricao de sistema: as funcoes puras ficam testaveis no Linux do CI.

// inputDevice e um bloco de /proc/bus/input/devices.
type inputDevice struct {
	bus      string // I: Bus=0003
	vendor   string
	product  string
	name     string
	phys     string
	sysfs    string
	handlers []string
	keyBits  *big.Int // B: KEY=
	evBits   *big.Int // B: EV=
	absBits  *big.Int // B: ABS=
}

// Codigos de evento do kernel usados para reconhecer teclados, mouses e touchpads.
const (
	keyA        = 30
	keyZ        = 44
	btnLeft     = 0x110
	btnToolFing = 0x145
	evRel       = 0x02
	evAbs       = 0x03
	absX        = 0x00
)

// parseInputDevices le o texto de /proc/bus/input/devices.
func parseInputDevices(text string) []inputDevice {
	var out []inputDevice
	var cur *inputDevice
	flush := func() {
		if cur != nil && cur.name != "" {
			out = append(out, *cur)
		}
		cur = nil
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		if cur == nil {
			cur = &inputDevice{}
		}
		if len(line) < 3 || line[1] != ':' {
			continue
		}
		val := strings.TrimSpace(line[2:])
		switch line[0] {
		case 'I':
			for _, f := range strings.Fields(val) {
				k, v, ok := strings.Cut(f, "=")
				if !ok {
					continue
				}
				switch k {
				case "Bus":
					cur.bus = v
				case "Vendor":
					cur.vendor = v
				case "Product":
					cur.product = v
				}
			}
		case 'N':
			cur.name = strings.Trim(strings.TrimPrefix(val, "Name="), `"`)
		case 'P':
			cur.phys = strings.TrimPrefix(val, "Phys=")
		case 'S':
			cur.sysfs = strings.TrimPrefix(val, "Sysfs=")
		case 'H':
			cur.handlers = strings.Fields(strings.TrimPrefix(val, "Handlers="))
		case 'B':
			k, v, ok := strings.Cut(val, "=")
			if !ok {
				continue
			}
			bits := parseBitmap(v)
			switch k {
			case "KEY":
				cur.keyBits = bits
			case "EV":
				cur.evBits = bits
			case "ABS":
				cur.absBits = bits
			}
		}
	}
	flush()
	return out
}

// parseBitmap converte o bitmap do kernel: palavras em hexadecimal, a mais significativa primeiro,
// cada uma do tamanho de um long (64 bits nos sistemas que o EYES atende).
func parseBitmap(s string) *big.Int {
	n := new(big.Int)
	for _, w := range strings.Fields(s) {
		v, ok := new(big.Int).SetString(w, 16)
		if !ok {
			return new(big.Int)
		}
		n.Lsh(n, 64)
		n.Or(n, v)
	}
	return n
}

func hasBit(n *big.Int, bit int) bool {
	return n != nil && n.Bit(bit) == 1
}

func hasHandler(d inputDevice, prefix string) bool {
	for _, h := range d.handlers {
		if strings.HasPrefix(h, prefix) {
			return true
		}
	}
	return false
}

// classifyInput diz se o bloco e teclado, touchpad ou mouse. Botoes de energia, controles de
// volume e afins tambem tem o manipulador "kbd", por isso o teclado precisa ter as letras A e Z.
func classifyInput(d inputDevice) string {
	switch {
	case hasHandler(d, "kbd") && hasBit(d.keyBits, keyA) && hasBit(d.keyBits, keyZ):
		return KindKeyboard
	case hasBit(d.keyBits, btnToolFing) && hasBit(d.evBits, evAbs) && hasBit(d.absBits, absX):
		return KindTouchpad
	case hasHandler(d, "mouse") && hasBit(d.keyBits, btnLeft):
		if isTouchpadName(d.name) {
			return KindTouchpad
		}
		return KindPointer
	}
	return ""
}

// inputBus traduz o barramento de /proc/bus/input/devices (BUS_* do kernel).
func inputBus(code string) string {
	switch strings.ToLower(strings.TrimLeft(code, "0")) {
	case "3":
		return BusUSB
	case "5":
		return BusBluetooth
	case "11", "18", "19", "1c": // i8042, I2C, host, SPI
		return BusInternal
	}
	return ""
}

// parseKeyValueLines le saidas no formato "chave: valor" (setxkbmap -query, localectl status).
func parseKeyValueLines(text string) map[string]string {
	m := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		m[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	return m
}

// xkbID junta layout e variante no formato do XKB: "br", "br(abnt2)", "us(intl)". Com varios layouts
// ("br,us"), vale o primeiro, que e o ativo ao entrar na sessao.
func xkbID(layout, variant string) string {
	layout = strings.TrimSpace(strings.Split(layout, ",")[0])
	variant = strings.TrimSpace(strings.Split(variant, ",")[0])
	if layout == "" {
		return ""
	}
	if variant == "" {
		return layout
	}
	return layout + "(" + variant + ")"
}

// parseGsettingsSources le a lista do GNOME, como "[('xkb', 'br'), ('xkb', 'us+intl')]", e devolve os
// layouts no formato do XKB ("br", "us(intl)").
func parseGsettingsSources(text string) []string {
	var out []string
	for _, part := range strings.Split(text, "(")[1:] {
		fields := strings.Split(strings.SplitN(part, ")", 2)[0], ",")
		if len(fields) != 2 {
			continue
		}
		kind := strings.Trim(strings.TrimSpace(fields[0]), `'"`)
		id := strings.Trim(strings.TrimSpace(fields[1]), `'"`)
		if kind != "xkb" || id == "" {
			continue
		}
		layout, variant, _ := strings.Cut(id, "+")
		out = append(out, xkbID(layout, variant))
	}
	return out
}

// xkbNames traduz os layouts do XKB mais comuns no Brasil. O resto aparece pelo identificador.
var xkbNames = map[string]string{
	"br":             "Português (Brasil ABNT2)",
	"br(abnt2)":      "Português (Brasil ABNT2)",
	"br(nodeadkeys)": "Português (Brasil ABNT2, sem teclas mortas)",
	"br(thinkpad)":   "Português (Brasil, ThinkPad)",
	"us":             "Inglês (EUA)",
	"us(intl)":       "Inglês (EUA, internacional com teclas mortas)",
	"us(alt-intl)":   "Inglês (EUA, internacional alternativo)",
	"pt":             "Português (Portugal)",
	"latam":          "Espanhol (América Latina)",
	"es":             "Espanhol (Espanha)",
	"gb":             "Inglês (Reino Unido)",
}

func xkbName(id string) string {
	if n, ok := xkbNames[id]; ok {
		return n
	}
	return id
}

// klidFromHKL monta o identificador do layout (KLID, como "00010416") a partir do HKL do Windows.
// A palavra alta do HKL e o dispositivo: igual ao idioma ou outro idioma no layout padrao ("0409" e
// "00000409"); com o nibble F, e um "Layout Id" a procurar no registro (variantes como ABNT2 e
// EUA-Internacional); com E, um IME, cujo KLID e o proprio HKL.
func klidFromHKL(hkl uint32, lookupLayoutID func(id uint16) string) string {
	lang := uint16(hkl & 0xFFFF)
	dev := uint16(hkl >> 16)
	switch dev & 0xF000 {
	case 0xF000:
		if lookupLayoutID != nil {
			if klid := lookupLayoutID(dev & 0x0FFF); klid != "" {
				return klid
			}
		}
		return fmt.Sprintf("%08X", uint32(lang))
	case 0xE000:
		return fmt.Sprintf("%08X", hkl)
	}
	if dev == 0 {
		dev = lang
	}
	return fmt.Sprintf("%08X", uint32(dev))
}
