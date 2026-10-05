//go:build !linux

package rdp

import (
	"context"
	"errors"
)

var errUnsupported = errors.New("acesso RDP pelo EYES so e usado no Linux (no Windows e no macOS use a Tela do MeshCentral)")

func enable(context.Context) (Access, error) { return Access{}, errUnsupported }

func disable(context.Context) error { return errUnsupported }
