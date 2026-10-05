//go:build darwin

package service

import (
	"fmt"
	"html"
	"os"
	"os/exec"
	"strings"
)

const plistPath = "/Library/LaunchDaemons/" + LaunchdLabel + ".plist"

// Run executa o agente em primeiro plano (o launchd cuida do ciclo de vida).
func Run(run RunFunc) error { return runForeground(run) }

// Install registra e inicia o daemon no launchd.
func Install(binary string) error {
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>%s</string>
	<key>ProgramArguments</key>
	<array><string>%s</string><string>service</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>StandardOutPath</key><string>/var/log/eyes.log</string>
	<key>StandardErrorPath</key><string>/var/log/eyes.log</string>
</dict>
</plist>
`, LaunchdLabel, html.EscapeString(binary))
	_ = exec.Command("launchctl", "bootout", "system/"+LaunchdLabel).Run()
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		return err
	}
	return run("launchctl", "bootstrap", "system", plistPath)
}

// Uninstall para e remove o daemon.
func Uninstall() error {
	_ = exec.Command("launchctl", "bootout", "system/"+LaunchdLabel).Run()
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Stop para o daemon (o launchd volta a inicia-lo no proximo boot).
func Stop() error { return run("launchctl", "bootout", "system/"+LaunchdLabel) }

// Restart reinicia o daemon.
func Restart() error { return run("launchctl", "kickstart", "-k", "system/"+LaunchdLabel) }

// RestartDetached pede o reinicio por um processo separado.
func RestartDetached() error {
	return exec.Command("sh", "-c", "sleep 3; launchctl kickstart -k system/"+LaunchdLabel).Start()
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}
