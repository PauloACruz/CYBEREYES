package input

import "testing"

func TestNormalizeVirtualDesktop(t *testing.T) {
	// Dois monitores de 1920x1080, o secundario a esquerda do principal (origem virtual em -1920).
	cases := []struct {
		x, y   int
		nx, ny int32
	}{
		{-1920, 0, 0, 0},
		{1919, 1079, 65535, 65535},
		{0, 540, 32776, 32797},
	}
	for _, c := range cases {
		nx, ny := normalize(c.x, c.y, -1920, 0, 3840, 1080)
		if nx != c.nx || ny != c.ny {
			t.Errorf("normalize(%d,%d) = %d,%d; esperado %d,%d", c.x, c.y, nx, ny, c.nx, c.ny)
		}
	}
}
