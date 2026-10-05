//go:build linux

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const (
	systemdUnit = "/etc/systemd/system/" + Name + ".service"
	openrcInit  = "/etc/init.d/" + Name
)

// Run executa o agente em primeiro plano (o systemd e o OpenRC cuidam do ciclo de vida).
func Run(run RunFunc) error { return runForeground(run) }

func hasSystemd() bool {
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		return true
	}
	return false
}

func hasOpenRC() bool {
	_, err := exec.LookPath("rc-service")
	return err == nil
}

// Install registra e inicia o servico apontando para o binario instalado.
func Install(binary string) error {
	switch {
	case hasSystemd():
		unit := fmt.Sprintf(`[Unit]
Description=%s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s service
User=root
Group=root
Restart=always
RestartSec=5s
KillMode=process
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
`, DisplayName, quoteSystemd(binary))
		if err := os.WriteFile(systemdUnit, []byte(unit), 0o644); err != nil {
			return err
		}
		if err := run("systemctl", "daemon-reload"); err != nil {
			return err
		}
		return run("systemctl", "enable", "--now", Name+".service")
	case hasOpenRC():
		script := fmt.Sprintf(`#!/sbin/openrc-run
description="%s"
command="%s"
command_args="service"
command_background=true
pidfile="/run/%s.pid"
output_log="/var/log/%s.log"
error_log="/var/log/%s.log"
respawn_delay=5
respawn_max=0
supervisor=supervise-daemon

depend() {
	need net
}
`, DisplayName, binary, Name, Name, Name)
		if err := os.WriteFile(openrcInit, []byte(script), 0o755); err != nil {
			return err
		}
		if err := run("rc-update", "add", Name, "default"); err != nil {
			return err
		}
		return run("rc-service", Name, "restart")
	default:
		return errors.New("nenhum gerenciador de servicos suportado (systemd ou OpenRC)")
	}
}

// Uninstall para e remove o servico.
func Uninstall() error {
	if _, err := os.Stat(systemdUnit); err == nil {
		_ = run("systemctl", "disable", "--now", Name+".service")
		if err := os.Remove(systemdUnit); err != nil {
			return err
		}
		return run("systemctl", "daemon-reload")
	}
	if _, err := os.Stat(openrcInit); err == nil {
		_ = run("rc-service", Name, "stop")
		_ = run("rc-update", "del", Name, "default")
		return os.Remove(openrcInit)
	}
	return nil
}

// Stop para o servico.
func Stop() error {
	if hasSystemd() {
		return run("systemctl", "stop", Name+".service")
	}
	return run("rc-service", Name, "stop")
}

// Restart reinicia o servico (usado depois de atualizar o binario).
func Restart() error {
	if hasSystemd() {
		return run("systemctl", "restart", Name+".service")
	}
	return run("rc-service", Name, "restart")
}

// RestartDetached pede o reinicio sem depender do processo atual continuar vivo.
func RestartDetached() error {
	if hasSystemd() {
		return exec.Command("systemd-run", "--on-active=3", "--timer-property=AccuracySec=1s", "systemctl", "restart", Name+".service").Run()
	}
	return exec.Command("sh", "-c", "sleep 3; rc-service "+Name+" restart").Start()
}

func quoteSystemd(s string) string {
	if strings.ContainsAny(s, " \t\"") {
		return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return s
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}
