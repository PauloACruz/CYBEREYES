package remote

import "context"

// clipboardSync sincroniza a area de transferencia da sessao com o visualizador (contrato, secao 6).
type clipboardSync interface {
	// Features devolve os recursos anunciados no HELLO.
	Features() []string
	// FromViewer trata um quadro CLIPBOARD vindo do visualizador.
	FromViewer(frame []byte) error
	Close()
}

// noClipboard e usado enquanto a sincronizacao nao existe neste sistema ou a politica desliga os dois sentidos.
type noClipboard struct{}

func (noClipboard) Features() []string            { return nil }
func (noClipboard) FromViewer(frame []byte) error { return nil }
func (noClipboard) Close()                        {}

func newClipboardSync(ctx context.Context, s *desktopSession, p Policy) clipboardSync {
	return noClipboard{}
}
