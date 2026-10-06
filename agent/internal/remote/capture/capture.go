// Package capture le a imagem da tela da sessao do usuario para o acesso remoto.
// Cada sistema tem sua implementacao: X11 no Linux, GDI no Windows e CoreGraphics no macOS.
package capture

import (
	"errors"
	"image"
)

// Display e um monitor, em pixels fisicos da area de trabalho virtual (contrato, secao 5.1).
type Display struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	W       int     `json:"w"`
	H       int     `json:"h"`
	Scale   float64 `json:"scale"`
	Primary bool    `json:"primary"`
}

// Rect devolve a area do monitor.
func (d Display) Rect() image.Rectangle { return image.Rect(d.X, d.Y, d.X+d.W, d.Y+d.H) }

// Screen captura a tela de uma sessao grafica.
type Screen interface {
	// Displays lista os monitores; o primeiro e o principal.
	Displays() ([]Display, error)
	// Capture devolve a imagem do monitor. A imagem devolvida pertence ao chamador.
	Capture(d Display) (*image.RGBA, error)
	// Close libera a conexao com o sistema grafico.
	Close() error
}

// ErrUnsupported indica sistema ou sessao sem captura na v1 (por exemplo Wayland).
var ErrUnsupported = errors.New("captura de tela nao suportada nesta sessao")

// Primary devolve o monitor principal da lista (ou o primeiro).
func Primary(ds []Display) Display {
	for _, d := range ds {
		if d.Primary {
			return d
		}
	}
	if len(ds) > 0 {
		return ds[0]
	}
	return Display{}
}

// Find devolve o monitor com o id pedido, ou o principal.
func Find(ds []Display, id int) Display {
	for _, d := range ds {
		if d.ID == id {
			return d
		}
	}
	return Primary(ds)
}
