//go:build !linux

package rdp

import (
	"context"
	"errors"
)

var errUnsupported = errors.New("acesso RDP pelo EYES so e usado no Linux com sessao Wayland (no Windows e no macOS use a Tela do acesso remoto)")

func enable(context.Context, bool) (Access, error) { return Access{}, errUnsupported }

func disable(context.Context) error { return errUnsupported }
