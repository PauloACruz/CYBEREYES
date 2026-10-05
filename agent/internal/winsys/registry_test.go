package winsys

import (
	"bytes"
	"errors"
	"testing"
)

func TestParseRegPath(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{`HKLM\SOFTWARE`, `HKLM\SOFTWARE`},
		{`hklm\SOFTWARE\Microsoft\`, `HKLM\SOFTWARE\Microsoft`},
		{`HKEY_LOCAL_MACHINE/SOFTWARE//Wow6432Node`, `HKLM\SOFTWARE\Wow6432Node`},
		{`Computer\HKEY_CURRENT_USER\Console`, `HKCU\Console`},
		{`HKCR`, `HKCR`},
		{`HKEY_USERS\.DEFAULT`, `HKU\.DEFAULT`},
		{`HKCC\System`, `HKCC\System`},
	}
	for _, c := range cases {
		p, err := ParseRegPath(c.in)
		if err != nil || p.String() != c.want {
			t.Errorf("ParseRegPath(%q) = %q, %v; want %q", c.in, p.String(), err, c.want)
		}
	}
	for _, in := range []string{"", "computer", `Computer\`, "  "} {
		if _, err := ParseRegPath(in); !errors.Is(err, ErrRootListing) {
			t.Errorf("ParseRegPath(%q) = %v; want ErrRootListing", in, err)
		}
	}
	if _, err := ParseRegPath(`HKXX\Foo`); err == nil || errors.Is(err, ErrRootListing) {
		t.Errorf("colmeia invalida deveria falhar: %v", err)
	}
}

func TestRegPathParent(t *testing.T) {
	p, _ := ParseRegPath(`HKLM\SOFTWARE\Foo\Bar`)
	parent, leaf, ok := p.Parent()
	if !ok || parent.String() != `HKLM\SOFTWARE\Foo` || leaf != "Bar" {
		t.Fatalf("Parent = %q %q %v", parent.String(), leaf, ok)
	}
	p, _ = ParseRegPath(`HKCU\Foo`)
	parent, leaf, ok = p.Parent()
	if !ok || parent.String() != "HKCU" || parent.Sub != "" || leaf != "Foo" {
		t.Fatalf("Parent nivel 1 = %q %q %v", parent.String(), leaf, ok)
	}
	p, _ = ParseRegPath(`HKCU`)
	if _, _, ok := p.Parent(); ok {
		t.Fatal("colmeia nao tem pai")
	}
}

func utf16le(s string) []byte { return utf16Bytes(s, 1) }

func TestFormatRegValue(t *testing.T) {
	multi := append(append(utf16le("um"), utf16le("dois")...), 0, 0)
	cases := []struct {
		name string
		typ  uint32
		raw  []byte
		want string
	}{
		{"sz", RegSZ, utf16le("Ola, mundo"), "Ola, mundo"},
		{"sz sem NUL", RegSZ, utf16Bytes("abc", 0), "abc"},
		{"sz acento", RegSZ, utf16le("acao ção"), "acao ção"},
		{"expand", RegExpandSZ, utf16le(`%SystemRoot%\x`), `%SystemRoot%\x`},
		{"multi", RegMultiSZ, multi, "um\ndois"},
		{"multi vazio", RegMultiSZ, []byte{0, 0}, ""},
		{"dword", RegDWord, []byte{0x01, 0x00, 0x00, 0x80}, "2147483649"},
		{"dword be", RegDWordBigEndian, []byte{0, 0, 1, 0}, "256"},
		{"qword", RegQWord, []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, "18446744073709551615"},
		{"binary", RegBinary, []byte{0x01, 0xa0, 0xff}, "01 a0 ff"},
		{"binary vazio", RegBinary, nil, ""},
		{"dword curto", RegDWord, []byte{1}, "01"},
		{"none", RegNone, []byte{0xde, 0xad}, "de ad"},
	}
	for _, c := range cases {
		if got := FormatRegValue(c.typ, c.raw); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
	big := bytes.Repeat([]byte{0xab}, maxDisplayBinary+10)
	got := FormatRegValue(RegBinary, big)
	if len(got) != maxDisplayBinary*3-1+4 || got[len(got)-3:] != "..." {
		t.Errorf("binario grande nao foi cortado: len=%d", len(got))
	}
}

func TestRegTypeName(t *testing.T) {
	if RegTypeName(RegQWord) != "REG_QWORD" || RegTypeName(RegMultiSZ) != "REG_MULTI_SZ" || RegTypeName(99) != "REG_0x63" {
		t.Fatal("nomes de tipo")
	}
}

func TestParseRegValueRoundTrip(t *testing.T) {
	cases := []struct {
		typ, in, shown string
	}{
		{"REG_SZ", "texto", "texto"},
		{"REG_EXPAND_SZ", `%TEMP%\a`, `%TEMP%\a`},
		{"REG_MULTI_SZ", "a\r\nb\n\nc\n", "a\nb\nc"},
		{"REG_DWORD", "4294967295", "4294967295"},
		{"REG_DWORD", "0x10", "16"},
		{"REG_DWORD", "", "0"},
		{"REG_QWORD", "0xFFFFFFFFFFFFFFFF", "18446744073709551615"},
		{"REG_QWORD", " 42 ", "42"},
		{"REG_BINARY", "01 A0,ff", "01 a0 ff"},
		{"REG_BINARY", "01a0ff", "01 a0 ff"},
		{"REG_BINARY", "", ""},
		{"reg_sz", "minusculo", "minusculo"},
	}
	for _, c := range cases {
		v, err := ParseRegValue(c.typ, c.in)
		if err != nil {
			t.Errorf("ParseRegValue(%s, %q): %v", c.typ, c.in, err)
			continue
		}
		if got := FormatRegValue(v.Type, v.Encode()); got != c.shown {
			t.Errorf("%s %q: mostrado %q, esperado %q", c.typ, c.in, got, c.shown)
		}
	}
}

func TestParseRegValueErrors(t *testing.T) {
	bad := [][2]string{
		{"REG_DWORD", "4294967296"},
		{"REG_DWORD", "-1"},
		{"REG_DWORD", "abc"},
		{"REG_QWORD", "0x1FFFFFFFFFFFFFFFF"},
		{"REG_BINARY", "0"},
		{"REG_BINARY", "zz"},
		{"REG_LINK", "x"},
		{"REG_SZ", "a\x00b"},
	}
	for _, b := range bad {
		if _, err := ParseRegValue(b[0], b[1]); err == nil {
			t.Errorf("ParseRegValue(%s, %q) deveria falhar", b[0], b[1])
		}
	}
}

func TestEncode(t *testing.T) {
	v, _ := ParseRegValue("REG_SZ", "A")
	if !bytes.Equal(v.Encode(), []byte{'A', 0, 0, 0}) {
		t.Errorf("REG_SZ: % x", v.Encode())
	}
	v, _ = ParseRegValue("REG_MULTI_SZ", "A\nB")
	if !bytes.Equal(v.Encode(), []byte{'A', 0, 0, 0, 'B', 0, 0, 0, 0, 0}) {
		t.Errorf("REG_MULTI_SZ: % x", v.Encode())
	}
	v, _ = ParseRegValue("REG_DWORD", "0x01020304")
	if !bytes.Equal(v.Encode(), []byte{4, 3, 2, 1}) {
		t.Errorf("REG_DWORD: % x", v.Encode())
	}
	v, _ = ParseRegValue("REG_QWORD", "1")
	if !bytes.Equal(v.Encode(), []byte{1, 0, 0, 0, 0, 0, 0, 0}) {
		t.Errorf("REG_QWORD: % x", v.Encode())
	}
}

func TestPageWindow(t *testing.T) {
	type w struct{ ks, ke, vs, ve int }
	check := func(nk, nv, page, size int, want w, wantMore bool) {
		t.Helper()
		ks, ke, vs, ve, more := PageWindow(nk, nv, page, size)
		if (w{ks, ke, vs, ve}) != want || more != wantMore {
			t.Errorf("PageWindow(%d,%d,%d,%d) = %v %v; want %v %v", nk, nv, page, size, w{ks, ke, vs, ve}, more, want, wantMore)
		}
	}
	check(3, 2, 1, 200, w{0, 3, 0, 2}, false)
	check(250, 10, 1, 200, w{0, 200, 0, 0}, true)
	check(250, 10, 2, 200, w{200, 250, 0, 10}, false)
	check(150, 100, 1, 200, w{0, 150, 0, 50}, true)
	check(150, 100, 2, 200, w{150, 150, 50, 100}, false)
	check(5, 5, 9, 200, w{5, 5, 5, 5}, false)
	check(0, 0, 1, 200, w{0, 0, 0, 0}, false)
	check(10, 0, 0, 0, w{0, 10, 0, 0}, false)
}

func TestRootListingAndSort(t *testing.T) {
	l := RootListing()
	if l.Path != "" || len(l.Subkeys) != 5 || l.Subkeys[2].Name != "HKLM" || !l.Subkeys[0].HasSubkeys || l.Values == nil || l.HasMore {
		t.Fatalf("RootListing = %+v", l)
	}
	names := []string{"b", "", "A", "a", "C"}
	SortNames(names)
	if names[0] != "" || names[1] != "A" || names[2] != "a" || names[3] != "b" || names[4] != "C" {
		t.Fatalf("SortNames = %q", names)
	}
}
