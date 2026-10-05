package files

import "testing"

func TestCheckPath(t *testing.T) {
	ok := []struct{ goos, in, want string }{
		{"linux", "/home/maria/Área de Trabalho", "/home/maria/Área de Trabalho"},
		{"linux", "/home/maria//docs/./a.txt", "/home/maria/docs/a.txt"},
		{"windows", `c:\Users\maria\Desktop`, `C:\Users\maria\Desktop`},
		{"windows", `C:/Users/maria/Desktop/relatório.pdf`, `C:\Users\maria\Desktop\relatório.pdf`},
		{"windows", `C:\`, `C:\`},
		{"windows", `\\servidor\publico\a.txt`, `\\servidor\publico\a.txt`},
	}
	for _, c := range ok {
		got, err := CheckPath(c.goos, c.in)
		if err != nil || got != c.want {
			t.Errorf("CheckPath(%s, %q) = %q, %v; esperado %q", c.goos, c.in, got, err, c.want)
		}
	}
	bad := []struct{ goos, in string }{
		{"linux", "relativo/a.txt"},
		{"linux", "/home/maria/../root"},
		{"linux", "/tmp/a\x00b"},
		{"linux", ""},
		{"windows", `\\.\PhysicalDrive0`},
		{"windows", `\\?\C:\Windows`},
		{"windows", `C:\Users\..\Windows`},
		{"windows", `C:\pasta\CON`},
		{"windows", `C:\pasta\nul.txt`},
		{"windows", `C:\pasta\arquivo.txt:fluxo`},
		{"windows", `Users\maria`},
		{"windows", `C:pasta`},
	}
	for _, c := range bad {
		if got, err := CheckPath(c.goos, c.in); err == nil {
			t.Errorf("CheckPath(%s, %q) aceitou: %q", c.goos, c.in, got)
		}
	}
}

func TestJoin(t *testing.T) {
	if got, err := Join("windows", `C:\Users\maria\Desktop\`, "a.txt"); err != nil || got != `C:\Users\maria\Desktop\a.txt` {
		t.Fatalf("%q %v", got, err)
	}
	if got, err := Join("linux", "/home/maria", "b.txt"); err != nil || got != "/home/maria/b.txt" {
		t.Fatalf("%q %v", got, err)
	}
	for _, name := range []string{"..", "a/b", "", "."} {
		if _, err := Join("linux", "/home", name); err == nil {
			t.Errorf("Join aceitou %q", name)
		}
	}
	if _, err := Join("windows", `C:\`, `a\b`); err == nil {
		t.Error("Join aceitou separador do Windows")
	}
}
