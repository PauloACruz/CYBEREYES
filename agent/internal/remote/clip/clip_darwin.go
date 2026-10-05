//go:build darwin

package clip

import (
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/macos"
)

// pasteboard acompanha o NSPasteboard pelo changeCount a cada 500 ms (contrato, secao 6).
type pasteboard struct {
	changes chan struct{}
	stop    chan struct{}
	once    sync.Once
	mu      sync.Mutex
	count   int
}

// Open usa a area de transferencia geral do usuario (o remote-helper roda na sessao dele).
func Open() (Board, error) {
	if err := macos.Load(); err != nil {
		return nil, err
	}
	p := &pasteboard{changes: make(chan struct{}, 1), stop: make(chan struct{}), count: macos.PasteboardChangeCount()}
	go p.poll()
	return p, nil
}

func (p *pasteboard) poll() {
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-p.stop:
			return
		case <-t.C:
		}
		c := macos.PasteboardChangeCount()
		p.mu.Lock()
		changed := c != p.count
		p.count = c
		p.mu.Unlock()
		if changed {
			select {
			case p.changes <- struct{}{}:
			default:
			}
		}
	}
}

func (p *pasteboard) Read() (string, error) {
	text := macos.PasteboardText()
	if len(text) > MaxText {
		return "", ErrTooLarge
	}
	return text, nil
}

// Write grava e atualiza o contador, para a propria gravacao nao virar aviso de mudanca.
func (p *pasteboard) Write(text string) error {
	if len(text) > MaxText {
		return ErrTooLarge
	}
	if err := macos.SetPasteboardText(text); err != nil {
		return err
	}
	p.mu.Lock()
	p.count = macos.PasteboardChangeCount()
	p.mu.Unlock()
	return nil
}

func (p *pasteboard) Changes() <-chan struct{} { return p.changes }

func (p *pasteboard) Close() error {
	p.once.Do(func() { close(p.stop) })
	return nil
}
