package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"
)

func TestRemoteSubscribeEventsAndAnswer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tray.sock")
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	answers := make(chan map[string]any, 1)
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		if line, _ := r.ReadString('\n'); line != `{"cmd":"subscribe"}`+"\n" {
			return
		}
		_, _ = c.Write([]byte(`{"event":"remote-ask","session":"s1","technician":"Joao","timeout":60}` + "\n"))
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		var m map[string]any
		_ = json.Unmarshal([]byte(line), &m)
		answers <- m
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	remote := &Remote{Path: path, Retry: 50 * time.Millisecond}
	events := make(chan RemoteEvent, 1)
	go remote.Run(ctx, func(ev RemoteEvent) { events <- ev })

	select {
	case ev := <-events:
		if ev.Event != "remote-ask" || ev.Session != "s1" || ev.Technician != "Joao" || ev.Timeout != 60 {
			t.Fatalf("evento inesperado: %+v", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("evento nao chegou")
	}
	if err := remote.Answer("s1", true); err != nil {
		t.Fatal(err)
	}
	select {
	case m := <-answers:
		if m["cmd"] != "remote-answer" || m["session"] != "s1" || m["accept"] != true {
			t.Fatalf("resposta inesperada: %v", m)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("resposta nao chegou ao agente")
	}
}

func TestRemoteAnswerWithoutConnection(t *testing.T) {
	if err := (&Remote{}).End("s1"); err != ErrNotConnected {
		t.Fatalf("esperava ErrNotConnected, veio %v", err)
	}
}
