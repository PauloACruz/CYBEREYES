//go:build !windows

package webcam

// openCamera devolve o erro de "sem suporte" nos sistemas em que a captura ainda nao foi feita.
// O console mostra a mensagem no quadro de fim e nao chega a abrir a janela de video.
func openCamera(_ Options) (Camera, error) {
	return nil, errUnsupported
}
