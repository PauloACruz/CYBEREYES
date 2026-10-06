//go:build linux

package remote

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestZenityExitCodes usa um zenity falso no PATH: 0 permite, 1 recusa e 5 e tempo esgotado.
func TestZenityExitCodes(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	for _, c := range []struct {
		code     string
		accepted bool
		timeout  bool
	}{{"0", true, false}, {"1", false, false}, {"5", false, true}} {
		script := "#!/bin/sh\nexit " + c.code + "\n"
		if err := os.WriteFile(filepath.Join(dir, "zenity"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
		ok, err := systemAsk(context.Background(), target{}, "Joao", 10*time.Second)
		if ok != c.accepted || (err == errAskTimeout) != c.timeout {
			t.Errorf("saida %s: aceito=%v erro=%v", c.code, ok, err)
		}
	}
	if err := os.Remove(filepath.Join(dir, "zenity")); err != nil {
		t.Fatal(err)
	}
	if _, err := systemAsk(context.Background(), target{}, "Joao", time.Second); err != errNoDialog {
		t.Fatalf("sem zenity nem kdialog: %v", err)
	}
}
