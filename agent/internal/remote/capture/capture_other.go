//go:build !linux && !windows && !darwin

package capture

// Open nao tem implementacao neste sistema.
func Open() (Screen, error) { return nil, ErrUnsupported }
