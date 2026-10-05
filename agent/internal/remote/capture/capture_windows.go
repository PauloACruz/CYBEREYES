//go:build windows

package capture

// Open: a captura deste sistema chega na fase 12.3 (RFC-001).
func Open() (Screen, error) { return nil, ErrUnsupported }
