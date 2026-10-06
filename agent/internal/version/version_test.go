package version

import (
	"os"
	"strings"
	"testing"
)

// O binario compilado sem -ldflags (testes E2E da API, go run) deve dizer a mesma versao do arquivo VERSION.
func TestDefaultMatchesVersionFile(t *testing.T) {
	raw, err := os.ReadFile("../../VERSION")
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.TrimSpace(string(raw)); Version != want {
		t.Fatalf("Version = %q, agent/VERSION = %q: atualize os dois juntos", Version, want)
	}
}
