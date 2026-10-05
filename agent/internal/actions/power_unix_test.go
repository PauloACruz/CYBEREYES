//go:build !windows

package actions

import (
	"runtime"
	"strings"
	"testing"
)

func TestPowerCommands(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("teste de Unix")
	}
	if c := powerCommands("darwin", true); c[0][0] != "shutdown" || c[0][1] != "-r" {
		t.Errorf("darwin: %v", c)
	}
	if c := powerCommands("linux", false); strings.Join(c[1], " ") != "systemctl poweroff" {
		t.Errorf("linux: %v", c)
	}
}
