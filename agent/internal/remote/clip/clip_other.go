//go:build !linux && !windows

package clip

// Open: a area de transferencia deste sistema chega na fase 12.6 (RFC-001).
func Open() (Board, error) { return nil, ErrUnsupported }
