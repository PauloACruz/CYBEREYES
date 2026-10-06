//go:build !linux

package rdp

import (
	"context"
	"errors"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

var errUnsupported = errors.New("acesso RDP pelo EYES so e usado no Linux com sessao Wayland (no Windows e no macOS use a Tela do acesso remoto)")

func enable(context.Context, bool) (Access, error) { return Access{}, errUnsupported }

func disable(context.Context) error { return errUnsupported }

// cleanupAtStart nao faz nada fora do Linux (o EYES nao liga RDP no Windows nem no macOS).
func cleanupAtStart(context.Context, *env.Env) {}
