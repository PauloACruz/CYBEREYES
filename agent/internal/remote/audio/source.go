package audio

import (
	"errors"
	"io"
)

// ErrUnsupported indica que esta maquina ou sessao nao tem captura do som do sistema.
var ErrUnsupported = errors.New("som da maquina indisponivel nesta sessao")

// Stream entrega PCM 16 bits little-endian, estereo, 24 kHz, do som que a maquina esta tocando. Read bloqueia
// enquanto nada toca (no Windows o loopback nao entrega quadros em silencio).
type Stream interface {
	io.ReadCloser
}
