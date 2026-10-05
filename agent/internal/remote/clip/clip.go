// Package clip le e grava o texto da area de transferencia da sessao do usuario e avisa quando ele muda
// (contrato do acesso remoto, secao 6): XFixes no X11 e WM_CLIPBOARDUPDATE no Windows.
package clip

import "errors"

// MaxText e o maior texto sincronizado, em bytes UTF-8 (contrato, secao 6).
const MaxText = 1 << 20

// ErrUnsupported indica sistema ou sessao sem area de transferencia na v1.
var ErrUnsupported = errors.New("area de transferencia nao suportada nesta sessao")

// ErrTooLarge indica conteudo acima de MaxText.
var ErrTooLarge = errors.New("conteudo da area de transferencia grande demais")

// Board e a area de transferencia da sessao grafica.
type Board interface {
	// Read devolve o texto atual ("" quando nao ha texto).
	Read() (string, error)
	// Write grava o texto e passa a ser a dona da area de transferencia.
	Write(text string) error
	// Changes recebe um sinal quando outro programa muda a area de transferencia.
	Changes() <-chan struct{}
	Close() error
}
