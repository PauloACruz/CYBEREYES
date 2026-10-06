//go:build !linux && !windows && !darwin

package input

import "errors"

// Open nao tem implementacao neste sistema.
func Open() (Injector, error) { return nil, errors.New("entrada remota nao suportada neste sistema") }
