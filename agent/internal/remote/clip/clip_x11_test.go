//go:build linux

package clip

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestX11Clipboard usa o xclip como "outro programa" no Xvfb do CI (DISPLAY definido).
func TestX11Clipboard(t *testing.T) {
	if os.Getenv("DISPLAY") == "" {
		t.Skip("sem DISPLAY")
	}
	if _, err := exec.LookPath("xclip"); err != nil {
		t.Skip("sem xclip")
	}
	b, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()

	// Outro programa copia: chega o aviso e a leitura devolve o texto.
	cmd := exec.Command("xclip", "-selection", "clipboard", "-i")
	cmd.Stdin = strings.NewReader("copiado na estação ✓")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-b.Changes():
	case <-time.After(3 * time.Second):
		t.Fatal("mudanca da area de transferencia nao foi avisada")
	}
	text, err := b.Read()
	if err != nil || text != "copiado na estação ✓" {
		t.Fatalf("leitura: %q %v", text, err)
	}

	// Gravamos: outro programa cola o nosso texto, e a nossa propria gravacao nao gera aviso.
	if err := b.Write("vindo do técnico"); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("xclip", "-selection", "clipboard", "-o").Output()
	if err != nil || string(out) != "vindo do técnico" {
		t.Fatalf("colado pelo xclip: %q %v", out, err)
	}
	select {
	case <-b.Changes():
		t.Fatal("a propria gravacao nao deveria avisar mudanca")
	case <-time.After(300 * time.Millisecond):
	}
}
