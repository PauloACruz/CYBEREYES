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

// MaxFiles e o limite de caminhos em FILES_COPIED (contrato, secao 7.6).
const MaxFiles = 1000

// FileBoard e a area de transferencia que tambem guarda lista de arquivos (Windows CF_HDROP).
type FileBoard interface {
	// ReadFiles devolve os arquivos copiados (nil quando a area de transferencia nao tem arquivos).
	ReadFiles() ([]string, error)
	// WriteFiles poe os arquivos na area de transferencia para o usuario colar no Explorer.
	WriteFiles(paths []string) error
}
