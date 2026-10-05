//go:build linux

package remote

import "errors"

func platformFeatures() []string { return nil }

// sessionUser nao e informado no Linux: o X11 nao diz quem e o dono da sessao grafica.
func sessionUser() *string { return nil }

func secureAttention() error { return errors.New("Ctrl+Alt+Del remoto so existe no Windows") }
