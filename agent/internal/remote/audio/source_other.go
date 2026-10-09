//go:build !windows && !linux

package audio

import (
	"context"
	"io"
)

// Available informa se ha captura do som do sistema (macOS: so com driver virtual, fora da v1).
func Available() bool { return false }

// Open abre a captura do som do sistema.
func Open(context.Context) (Stream, error) { return nil, ErrUnsupported }

// Main e o "eyes remote-audio" (so no Windows).
func Main(io.Writer) error { return ErrUnsupported }
