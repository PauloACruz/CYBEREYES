package agent

import (
	"errors"
	"sync"

	"github.com/pauloacruz/cybereyes/agent/internal/bus"
)

var errNotConnected = errors.New("NATS ainda nao conectado")

// lazyPublisher permite que os modulos iniciem antes da primeira conexao ao NATS.
type lazyPublisher struct {
	mu sync.RWMutex
	b  *bus.Bus
}

func (p *lazyPublisher) set(b *bus.Bus) {
	p.mu.Lock()
	p.b = b
	p.mu.Unlock()
}

func (p *lazyPublisher) get() *bus.Bus {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.b
}

func (p *lazyPublisher) Checkin(kind string, body any) error {
	if b := p.get(); b != nil {
		return b.Checkin(kind, body)
	}
	return errNotConnected
}

func (p *lazyPublisher) Publish(suffix string, body any) error {
	if b := p.get(); b != nil {
		return b.Publish(suffix, body)
	}
	return errNotConnected
}

func (p *lazyPublisher) Connected() bool {
	b := p.get()
	return b != nil && b.Connected()
}
