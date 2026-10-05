// Package tray atende o app de bandeja (eyes-tray) pelo canal local e emite o token curto
// do usuario conectado (POST /api/v3/traytoken/). O usuario e identificado pelo processo do
// outro lado do canal, nunca pelo que o app informa.
//
// Protocolo: uma linha JSON por conexao.
//
//	-> {"cmd":"token","refresh":false}
//	<- {"token":"...","expires_at":"RFC3339","api_url":"https://...","hostname":"...","username":"...","error":""}
package tray

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

type request struct {
	Cmd     string `json:"cmd"`
	Refresh bool   `json:"refresh,omitempty"`
}

type response struct {
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
	APIURL    string `json:"api_url,omitempty"`
	Hostname  string `json:"hostname,omitempty"`
	Username  string `json:"username,omitempty"`
	Error     string `json:"error,omitempty"`
}

type cached struct {
	token   string
	expires time.Time
}

// Server e o servidor do canal local.
type Server struct {
	e     *env.Env
	mu    sync.Mutex
	cache map[string]cached
}

// renewBefore: tokens que expiram antes disso sao renovados mesmo sem refresh.
const renewBefore = 2 * time.Hour

// Register inicia o servidor do canal local.
func Register(e *env.Env) error {
	s := &Server{e: e, cache: map[string]cached{}}
	ln, err := listen()
	if err != nil {
		e.Log.Warn("canal do app de bandeja indisponivel", "erro", err)
		return nil
	}
	e.Go("tray-ipc", func(ctx context.Context) {
		go func() { <-ctx.Done(); ln.Close() }()
		for {
			conn, err := ln.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				e.Log.Warn("canal do app de bandeja", "erro", err)
				time.Sleep(time.Second)
				continue
			}
			go s.serve(ctx, conn)
		}
	})
	startSupervisor(e)
	return nil
}

func (s *Server) serve(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
	line, err := bufio.NewReaderSize(conn, 4096).ReadString('\n')
	if err != nil && line == "" {
		return
	}
	var req request
	resp := response{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &req); err != nil || req.Cmd != "token" {
		resp.Error = "comando invalido"
		s.write(conn, resp)
		return
	}
	user, err := peerUser(conn)
	if err != nil || user == "" {
		s.e.Log.Warn("app de bandeja: usuario do processo nao identificado", "erro", err)
		resp.Error = "usuario nao identificado"
		s.write(conn, resp)
		return
	}
	tok, exp, err := s.token(ctx, user, req.Refresh)
	if err != nil {
		resp.Error = err.Error()
		s.write(conn, resp)
		return
	}
	host, _ := os.Hostname()
	resp = response{Token: tok, ExpiresAt: exp.UTC().Format(time.RFC3339), APIURL: s.e.Cfg.API, Hostname: host, Username: user}
	s.write(conn, resp)
}

func (s *Server) write(conn net.Conn, r response) {
	data, _ := json.Marshal(r)
	_, _ = conn.Write(append(data, '\n'))
}

func (s *Server) token(ctx context.Context, user string, refresh bool) (string, time.Time, error) {
	key := strings.ToLower(user)
	s.mu.Lock()
	c, ok := s.cache[key]
	s.mu.Unlock()
	if ok && !refresh && time.Until(c.expires) > renewBefore {
		return c.token, c.expires, nil
	}
	var out struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := s.e.API.Post(ctx, "/api/v3/traytoken/", map[string]string{"username": user}, &out); err != nil {
		return "", time.Time{}, err
	}
	exp, err := time.Parse(time.RFC3339Nano, out.ExpiresAt)
	if err != nil {
		exp = time.Now().Add(12 * time.Hour)
	}
	s.mu.Lock()
	s.cache[key] = cached{token: out.Token, expires: exp}
	s.mu.Unlock()
	return out.Token, exp, nil
}
