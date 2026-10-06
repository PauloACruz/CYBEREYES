//go:build linux

package capture

import (
	"os"
	"testing"
	"time"
)

// Prova S5: precisa de um servidor X (por exemplo Xvfb :99) em DISPLAY.
func TestX11Capture(t *testing.T) {
	if os.Getenv("DISPLAY") == "" {
		t.Skip("sem DISPLAY")
	}
	s, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ds, err := s.Displays()
	if err != nil || len(ds) == 0 {
		t.Fatalf("monitores: %v %v", ds, err)
	}
	d := Primary(ds)
	start := time.Now()
	img, err := s.Capture(d)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("monitores %+v; captura %dx%d em %v", ds, img.Bounds().Dx(), img.Bounds().Dy(), time.Since(start))
	if img.Bounds().Dx() != d.W || img.Bounds().Dy() != d.H {
		t.Fatalf("tamanho %v, esperado %dx%d", img.Bounds(), d.W, d.H)
	}
}

func BenchmarkX11Capture(b *testing.B) {
	if os.Getenv("DISPLAY") == "" {
		b.Skip("sem DISPLAY")
	}
	s, err := Open()
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	ds, _ := s.Displays()
	d := Primary(ds)
	for b.Loop() {
		if _, err := s.Capture(d); err != nil {
			b.Fatal(err)
		}
	}
}
