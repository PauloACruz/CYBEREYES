package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync"
	"time"
)

// RemoteEvent e um evento do acesso remoto vindo do agente (contrato do acesso remoto, secao 8.3):
// remote-notify (aviso durante a sessao), remote-ask (pedido de aceite) e remote-ended.
type RemoteEvent struct {
	Event      string `json:"event"`
	Session    string `json:"session"`
	Technician string `json:"technician,omitempty"`
	Timeout    int    `json:"timeout,omitempty"`
}

// ErrNotConnected indica que a conexao de eventos com o agente esta fechada.
var ErrNotConnected = errors.New("conexao de eventos com o agente fechada")

// Remote mantem a conexao de eventos do acesso remoto aberta, reconectando quando ela cai.
type Remote struct {
	Path  string
	Retry time.Duration

	mu   sync.Mutex
	conn net.Conn
}

// Run assina os eventos e chama handle para cada um ate ctx terminar.
func (r *Remote) Run(ctx context.Context, handle func(RemoteEvent)) {
	retry := r.Retry
	if retry <= 0 {
		retry = 5 * time.Second
	}
	path := r.Path
	if path == "" {
		path = DefaultPath
	}
	for ctx.Err() == nil {
		r.session(ctx, path, handle)
		select {
		case <-ctx.Done():
			return
		case <-time.After(retry):
		}
	}
}

func (r *Remote) session(ctx context.Context, path string, handle func(RemoteEvent)) {
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, err := dial(dctx, path)
	cancel()
	if err != nil {
		return
	}
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	defer conn.Close()
	if _, err := conn.Write([]byte(`{"cmd":"subscribe"}` + "\n")); err != nil {
		return
	}
	r.mu.Lock()
	r.conn = conn
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		if r.conn == conn {
			r.conn = nil
		}
		r.mu.Unlock()
	}()
	reader := bufio.NewReaderSize(conn, 4096)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		var ev RemoteEvent
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &ev) == nil && ev.Event != "" {
			handle(ev)
		}
	}
}

func (r *Remote) send(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn == nil {
		return ErrNotConnected
	}
	_ = r.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err = r.conn.Write(append(data, '\n'))
	return err
}

// Answer responde ao pedido de acesso.
func (r *Remote) Answer(session string, accept bool) error {
	return r.send(map[string]any{"cmd": "remote-answer", "session": session, "accept": accept})
}

// End pede ao agente o fim da sessao remota.
func (r *Remote) End(session string) error {
	return r.send(map[string]any{"cmd": "remote-end", "session": session})
}
