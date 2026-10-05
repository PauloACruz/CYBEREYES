//go:build darwin

package remote

import (
	"errors"
	"os/user"
)

func platformFeatures() []string { return nil }

// sessionUser: o remote-helper roda como o usuario da sessao.
func sessionUser() *string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return &u.Username
	}
	return nil
}

func secureAttention() error { return errors.New("Ctrl+Alt+Del so existe no Windows") }
