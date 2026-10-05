package tray

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"testing"
	"time"
)

// connect liga um app falso do usuario ao hub e devolve o leitor de eventos e a conexao do app.
func connect(t *testing.T, h *Hub, user string) (*bufio.Reader, net.Conn) {
	t.Helper()
	server, client := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); client.Close() })
	go h.serve(ctx, server, bufio.NewReader(server), user)
	// Espera o registro do assinante.
	deadline := time.Now().Add(2 * time.Second)
	for {
		h.mu.Lock()
		n := len(h.subs)
		h.mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	return bufio.NewReader(client), client
}

func readEvent(t *testing.T, r *bufio.Reader) Event {
	t.Helper()
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var ev Event
	if err := json.Unmarshal([]byte(line), &ev); err != nil {
		t.Fatal(err)
	}
	return ev
}

func send(t *testing.T, c net.Conn, v any) {
	t.Helper()
	data, _ := json.Marshal(v)
	if _, err := c.Write(append(data, '\n')); err != nil {
		t.Fatal(err)
	}
}

func TestAskAcceptedByTheSessionUser(t *testing.T) {
	h := newHub()
	r, c := connect(t, h, `EMPRESA\maria`)
	result := make(chan error, 1)
	var accepted bool
	go func() {
		var err error
		accepted, err = h.Ask(context.Background(), "s1", "maria", "Joao", 5*time.Second)
		result <- err
	}()
	ev := readEvent(t, r)
	if ev.Event != "remote-ask" || ev.Session != "s1" || ev.Technician != "Joao" || ev.Timeout != 5 {
		t.Fatalf("evento inesperado: %+v", ev)
	}
	send(t, c, map[string]any{"cmd": "remote-answer", "session": "s1", "accept": true})
	if err := <-result; err != nil || !accepted {
		t.Fatalf("aceite nao chegou: %v %v", accepted, err)
	}
}

func TestAskIgnoresOtherUsersAndTimesOut(t *testing.T) {
	h := newHub()
	maria, _ := connect(t, h, "maria")
	go func() {
		for {
			if _, err := maria.ReadString('\n'); err != nil {
				return
			}
		}
	}()
	_, other := connect(t, h, "jose")
	go func() { _, _ = other.Write([]byte(`{"cmd":"remote-answer","session":"s2","accept":true}` + "\n")) }()
	ok, err := h.Ask(context.Background(), "s2", "maria", "Joao", 300*time.Millisecond)
	if ok || !errors.Is(err, ErrTimeout) {
		t.Fatalf("esperava tempo esgotado: %v %v", ok, err)
	}
}

func TestAskWithoutTray(t *testing.T) {
	ok, err := newHub().Ask(context.Background(), "s3", "maria", "Joao", time.Second)
	if ok || !errors.Is(err, ErrNoTray) {
		t.Fatalf("esperava ErrNoTray: %v %v", ok, err)
	}
}

func TestNotifyAndEndByUser(t *testing.T) {
	h := newHub()
	r, c := connect(t, h, "maria")
	ended := make(chan struct{})
	stop, ok := h.Notify("s4", "maria", "Joao", func() { close(ended) })
	if !ok {
		t.Fatal("app conectado nao recebeu o aviso")
	}
	if ev := readEvent(t, r); ev.Event != "remote-notify" || ev.Technician != "Joao" {
		t.Fatalf("evento inesperado: %+v", ev)
	}
	send(t, c, map[string]any{"cmd": "remote-end", "session": "s4"})
	select {
	case <-ended:
	case <-time.After(2 * time.Second):
		t.Fatal("pedido de fim nao chegou")
	}
	go stop()
	if ev := readEvent(t, r); ev.Event != "remote-ended" {
		t.Fatalf("evento inesperado: %+v", ev)
	}
}

func TestSameUser(t *testing.T) {
	cases := []struct {
		peer, user string
		want       bool
	}{
		{`EMPRESA\maria`, "maria", true},
		{"maria", "MARIA", true},
		{`EMPRESA\maria`, `OUTRA\maria`, false},
		{"jose", "maria", false},
		{"", "maria", false},
	}
	for _, c := range cases {
		if got := sameUser(c.peer, c.user); got != c.want {
			t.Errorf("sameUser(%q, %q) = %v", c.peer, c.user, got)
		}
	}
}
