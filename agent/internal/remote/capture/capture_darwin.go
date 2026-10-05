//go:build darwin

package capture

// Open: a captura deste sistema chega na fase 12.6 (RFC-001).
func Open() (Screen, error) { return nil, ErrUnsupported }
