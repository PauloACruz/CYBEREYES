//go:build darwin

package remote

import "errors"

func platformFeatures() []string { return nil }

func sessionUser() *string { return nil }

func secureAttention() error { return errors.New("Ctrl+Alt+Del remoto ainda nao disponivel") }
