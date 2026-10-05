//go:build !windows

package tray

import "github.com/pauloacruz/cybereyes/agent/internal/env"

// startSupervisor: no Linux e no macOS o app e iniciado pela sessao do usuario (autostart XDG ou LaunchAgent).
func startSupervisor(*env.Env) {}
