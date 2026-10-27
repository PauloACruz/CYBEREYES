package devices

import (
	"reflect"
	"testing"
)

const procSample = `I: Bus=0011 Vendor=0001 Product=0001 Version=ab83
N: Name="AT Translated Set 2 keyboard"
P: Phys=isa0060/serio0/input0
S: Sysfs=/devices/platform/i8042/serio0/input/input3
U: Uniq=
H: Handlers=sysrq kbd leds event3
B: PROP=0
B: EV=120013
B: KEY=402000000 3803078f800d001 feffffdfffefffff fffffffffffffffe
B: MSC=10
B: LED=7

I: Bus=0019 Vendor=0000 Product=0001 Version=0000
N: Name="Power Button"
P: Phys=PNP0C0C/button/input0
S: Sysfs=/devices/LNXSYSTM:00/LNXPWRBN:00/input/input1
U: Uniq=
H: Handlers=kbd event1
B: PROP=0
B: EV=3
B: KEY=10000000000000 0

I: Bus=0018 Vendor=06cb Product=7e7e Version=0100
N: Name="SYNA7DB5:00 06CB:7E7E Touchpad"
P: Phys=i2c-SYNA7DB5:00
S: Sysfs=/devices/platform/AMDI0010:01/i2c-1/i2c-SYNA7DB5:00/0018:06CB:7E7E.0001/input/input12
U: Uniq=
H: Handlers=mouse1 event9
B: PROP=5
B: EV=1b
B: KEY=e520 10000 0 0 0 0
B: ABS=2e0800000000003
B: MSC=20

I: Bus=0018 Vendor=06cb Product=7e7e Version=0100
N: Name="SYNA7DB5:00 06CB:7E7E Mouse"
P: Phys=i2c-SYNA7DB5:00
S: Sysfs=/devices/platform/AMDI0010:01/i2c-1/i2c-SYNA7DB5:00/0018:06CB:7E7E.0001/input/input11
U: Uniq=
H: Handlers=mouse0 event8
B: PROP=0
B: EV=17
B: KEY=30000 0 0 0 0
B: REL=3
B: MSC=10

I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech USB Receiver Mouse"
P: Phys=usb-0000:00:14.0-2/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.1/0003:046D:C52B.0003/input/input20
U: Uniq=
H: Handlers=mouse2 event15
B: PROP=0
B: EV=17
B: KEY=ffff0000 0 0 0 0
B: REL=1943
B: MSC=10

I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech USB Receiver Consumer Control"
P: Phys=usb-0000:00:14.0-2/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.1/0003:046D:C52B.0003/input/input21
U: Uniq=
H: Handlers=kbd event16
B: PROP=0
B: EV=1f
B: KEY=3f000303ff 0 0 483ffff17aff32d bfd4444600000000 1 130ff38b17c000 677bfad9415fed 9ed68000004400 10000002
`

func TestClassifyInput(t *testing.T) {
	got := map[string]string{}
	for _, d := range parseInputDevices(procSample) {
		got[d.name] = classifyInput(d) + "|" + inputBus(d.bus)
	}
	want := map[string]string{
		"AT Translated Set 2 keyboard":           KindKeyboard + "|" + BusInternal,
		"Power Button":                           "|" + BusInternal,
		"SYNA7DB5:00 06CB:7E7E Touchpad":         KindTouchpad + "|" + BusInternal,
		"SYNA7DB5:00 06CB:7E7E Mouse":            KindPointer + "|" + BusInternal,
		"Logitech USB Receiver Mouse":            KindPointer + "|" + BusUSB,
		"Logitech USB Receiver Consumer Control": "|" + BusUSB,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("classificacao:\n got %v\nwant %v", got, want)
	}
}

func TestParseGsettingsSources(t *testing.T) {
	got := parseGsettingsSources("[('xkb', 'br'), ('ibus', 'anthy'), ('xkb', 'us+intl')]\n")
	if want := []string{"br", "us(intl)"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got := parseGsettingsSources("@a(ss) []"); len(got) != 0 {
		t.Fatalf("lista vazia virou %v", got)
	}
}

func TestSetxkbmapQuery(t *testing.T) {
	kv := parseKeyValueLines("rules:      evdev\nmodel:      pc105\nlayout:     br,us\nvariant:    abnt2,\n")
	if id := xkbID(kv["layout"], kv["variant"]); id != "br(abnt2)" {
		t.Fatalf("id = %q", id)
	}
	if n := xkbName("br(abnt2)"); n != "Português (Brasil ABNT2)" {
		t.Fatalf("nome = %q", n)
	}
	if n := xkbName("de(nodeadkeys)"); n != "de(nodeadkeys)" {
		t.Fatalf("layout sem traducao deve aparecer pelo id, veio %q", n)
	}
}

func TestKlidFromHKL(t *testing.T) {
	lookup := func(id uint16) string {
		return map[uint16]string{0x0001: "00020409", 0x00b5: "00010416"}[id]
	}
	cases := []struct {
		hkl  uint32
		want string
	}{
		{0x04160416, "00000416"}, // Portugues (Brasil ABNT)
		{0x04090416, "00000409"}, // idioma pt-BR com o teclado dos EUA
		{0xF0010409, "00020409"}, // EUA-Internacional (Layout Id 0001)
		{0xF0B50416, "00010416"}, // ABNT2 (Layout Id 00b5)
		{0xF0990416, "00000416"}, // Layout Id desconhecido: cai no idioma
		{0xE0010411, "E0010411"}, // IME
	}
	for _, c := range cases {
		if got := klidFromHKL(c.hkl, lookup); got != c.want {
			t.Errorf("klidFromHKL(%08X) = %s, want %s", c.hkl, got, c.want)
		}
	}
}

func TestProblemText(t *testing.T) {
	if problemText(0) != "" {
		t.Fatal("codigo 0 nao e problema")
	}
	if got := problemText(43); got != "O dispositivo informou falha (código 43)" {
		t.Fatalf("43 = %q", got)
	}
	if got := problemText(77); got != "Problema no dispositivo (código 77)" {
		t.Fatalf("77 = %q", got)
	}
}
