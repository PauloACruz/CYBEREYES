package terminal

import "testing"

func TestLineMode(t *testing.T) {
	cases := []struct {
		name, in, echo, lines string
	}{
		{"linha simples", "dir\r", "dir\r\n", "dir\r\n"},
		{"cr lf conta uma vez", "a\r\nb\n", "a\r\nb\r\n", "a\r\nb\r\n"},
		{"backspace utf8", "aç\x7fb\r", "aç\b \bb\r\n", "ab\r\n"},
		{"backspace em linha vazia", "\x7f\x7fx\r", "x\r\n", "x\r\n"},
		{"setas descartadas", "\x1b[Aab\x1b[D\x1bOPc\r", "abc\r\n", "abc\r\n"},
		{"ctrl c descarta", "rm x\x03ok\r", "rm x^C\r\nok\r\n", "ok\r\n"},
		{"ctrl u apaga", "abc\x15d\r", "abc\b \b\b \b\b \bd\r\n", "d\r\n"},
		{"sem enter fica pendente", "abc", "abc", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l := newLineMode("\r\n")
			echo, lines := l.feed([]byte(c.in))
			if string(echo) != c.echo {
				t.Errorf("eco %q, esperado %q", echo, c.echo)
			}
			if string(lines) != c.lines {
				t.Errorf("linhas %q, esperado %q", lines, c.lines)
			}
		})
	}
	// Escape partido entre duas entradas.
	l := newLineMode("\r\n")
	l.feed([]byte("x\x1b["))
	echo, lines := l.feed([]byte("Cy\r"))
	if string(echo) != "y\r\n" || string(lines) != "xy\r\n" {
		t.Fatalf("escape partido: eco %q linhas %q", echo, lines)
	}
}
