//go:build !windows && !linux

package tray

import "github.com/pauloacruz/cybereyes/agent/internal/env"

// startSupervisor: no macOS o app ainda nao e distribuido pelo EYES (o Wails precisa de CGO e do SDK da Apple;
// ver ADR-022). O canal local do agente ja atende um app instalado a parte (LaunchAgent).
func startSupervisor(*env.Env) {}
