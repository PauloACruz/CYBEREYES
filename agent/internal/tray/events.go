package tray

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

// Eventos do acesso remoto para o eyes-tray (contrato do acesso remoto, secao 8.3). O app abre uma conexao com
// {"cmd":"subscribe"} e recebe uma linha JSON por evento; pela mesma conexao responde ao pedido de acesso e pede o
// fim da sessao. So valem respostas de conexoes cujo usuario e o da sessao acessada.

// Event e uma linha do agente para o app.
type Event struct {
	Event      string `json:"event"`
	Session    string `json:"session"`
	Technician string `json:"technician,omitempty"`
	Timeout    int    `json:"timeout,omitempty"`
}

type command struct {
	Cmd     string `json:"cmd"`
	Session string `json:"session"`
	Accept  bool   `json:"accept"`
}

var (
	// ErrNoTray indica que nenhum eyes-tray do usuario esta conectado.
	ErrNoTray = errors.New("app de bandeja do usuario nao conectado")
	// ErrTimeout indica que o usuario nao respondeu ao pedido de acesso.
	ErrTimeout = errors.New("usuario nao respondeu")
)

type subscriber struct {
	user string
	out  chan Event
}

// send enfileira o evento sem bloquear; um app que nao le perde eventos em vez de travar a sessao.
func (s *subscriber) send(ev Event) {
	select {
	case s.out <- ev:
	default:
	}
}

func (s *subscriber) writeLoop(conn net.Conn, done <-chan struct{}) {
	for {
		select {
		case <-done:
			return
		case ev := <-s.out:
			data, _ := json.Marshal(ev)
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := conn.Write(append(data, '\n')); err != nil {
				conn.Close()
				return
			}
		}
	}
}

type remoteSession struct {
	user       string
	technician string
	answers    chan bool
	onEnd      func()
}

// Hub liga as sessoes remotas aos apps de bandeja conectados.
type Hub struct {
	mu       sync.Mutex
	subs     map[*subscriber]struct{}
	sessions map[string]*remoteSession
}

func newHub() *Hub {
	return &Hub{subs: map[*subscriber]struct{}{}, sessions: map[string]*remoteSession{}}
}

// Events e o hub do processo (o servidor do canal local entrega as conexoes de eventos a ele).
var Events = newHub()

// sameUser compara o usuario do app (DOMINIO\conta no Windows) com o da sessao. Quando os dois trazem dominio,
// os dois precisam bater; quando um deles vem so com a conta, vale a conta.
func sameUser(peer, user string) bool {
	if peer == "" || user == "" {
		return false
	}
	if strings.EqualFold(peer, user) {
		return true
	}
	split := func(v string) (string, string) {
		if i := strings.LastIndexByte(v, '\\'); i >= 0 {
			return v[:i], v[i+1:]
		}
		return "", v
	}
	pd, pa := split(peer)
	ud, ua := split(user)
	if pd != "" && ud != "" {
		return false
	}
	return strings.EqualFold(pa, ua)
}

func (h *Hub) broadcast(user string, ev Event) int {
	h.mu.Lock()
	var targets []*subscriber
	for s := range h.subs {
		if sameUser(s.user, user) {
			targets = append(targets, s)
		}
	}
	h.mu.Unlock()
	for _, s := range targets {
		s.send(ev)
	}
	return len(targets)
}

// Ask pede ao usuario que aceite o acesso e espera a resposta ate timeout.
func (h *Hub) Ask(ctx context.Context, session, user, technician string, timeout time.Duration) (bool, error) {
	rs := &remoteSession{user: user, technician: technician, answers: make(chan bool, 1)}
	h.mu.Lock()
	h.sessions[session] = rs
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		if h.sessions[session] == rs && rs.onEnd == nil {
			delete(h.sessions, session)
		}
		h.mu.Unlock()
	}()
	if h.broadcast(user, Event{Event: "remote-ask", Session: session, Technician: technician, Timeout: int(timeout.Seconds())}) == 0 {
		return false, ErrNoTray
	}
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case ok := <-rs.answers:
		return ok, nil
	case <-t.C:
		h.broadcast(user, Event{Event: "remote-ended", Session: session})
		return false, ErrTimeout
	case <-ctx.Done():
		h.broadcast(user, Event{Event: "remote-ended", Session: session})
		return false, ctx.Err()
	}
}

// Notify mostra o aviso de acesso durante a sessao. onEnd roda quando o usuario pede o fim pelo app. A funcao
// devolvida encerra o aviso. ok e false quando nenhum app do usuario esta conectado.
func (h *Hub) Notify(session, user, technician string, onEnd func()) (stop func(), ok bool) {
	rs := &remoteSession{user: user, technician: technician, answers: make(chan bool, 1), onEnd: onEnd}
	h.mu.Lock()
	h.sessions[session] = rs
	h.mu.Unlock()
	n := h.broadcast(user, Event{Event: "remote-notify", Session: session, Technician: technician})
	var once sync.Once
	return func() {
		once.Do(func() {
			h.mu.Lock()
			if h.sessions[session] == rs {
				delete(h.sessions, session)
			}
			h.mu.Unlock()
			h.broadcast(user, Event{Event: "remote-ended", Session: session})
		})
	}, n > 0
}

// handle trata um comando vindo de um app conectado.
func (h *Hub) handle(peer string, c command) {
	h.mu.Lock()
	rs, ok := h.sessions[c.Session]
	h.mu.Unlock()
	if !ok || !sameUser(peer, rs.user) {
		return
	}
	switch c.Cmd {
	case "remote-answer":
		select {
		case rs.answers <- c.Accept:
		default:
		}
	case "remote-end":
		if rs.onEnd != nil {
			go rs.onEnd()
		}
	}
}

// serve mantem a conexao de eventos de um app ate ela cair ou o agente parar.
func (h *Hub) serve(ctx context.Context, conn net.Conn, r *bufio.Reader, user string) {
	sub := &subscriber{user: user, out: make(chan Event, 16)}
	done := make(chan struct{})
	defer close(done)
	go sub.writeLoop(conn, done)
	h.mu.Lock()
	h.subs[sub] = struct{}{}
	// Sessoes em andamento: o app que conecta no meio (reiniciado, por exemplo) volta a mostrar o aviso.
	var pending []Event
	for id, rs := range h.sessions {
		if rs.onEnd != nil && sameUser(user, rs.user) {
			pending = append(pending, Event{Event: "remote-notify", Session: id, Technician: rs.technician})
		}
	}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs, sub)
		h.mu.Unlock()
	}()
	for _, ev := range pending {
		sub.send(ev)
	}
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	_ = conn.SetReadDeadline(time.Time{})
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		var c command
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &c) == nil {
			h.handle(user, c)
		}
	}
}
