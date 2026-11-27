package bus

import (
	"io"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// silentListener aceita conexoes TCP e nunca responde: o TLS do wss:// (ou o tunel do proxy) fica esperando.
func silentListener(t *testing.T) (string, *atomic.Int32) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var conns []net.Conn
	accepted := &atomic.Int32{}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			accepted.Add(1)
			mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		ln.Close()
		mu.Lock()
		defer mu.Unlock()
		for _, c := range conns {
			c.Close()
		}
	})
	return ln.Addr().String(), accepted
}

func shortHandshake(t *testing.T) {
	t.Helper()
	old := handshakeTimeout
	handshakeTimeout = 300 * time.Millisecond
	t.Cleanup(func() { handshakeTimeout = old })
}

// Sem prazo no TLS do wss://, o nats.go ficava preso no aperto de mao segurando o lock da conexao: Connect (ou a
// reconexao) nao voltava e IsConnected travava junto, com o agente fora do NATS ate reiniciar o servico.
func TestHandshakeSemRespostaNaoTravaAConexao(t *testing.T) {
	shortHandshake(t)
	addr, _ := silentListener(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	type result struct {
		b   *Bus
		err error
	}
	done := make(chan result, 1)
	go func() {
		b, err := Connect(t.Context(), Options{URL: "wss://" + addr + "/natsws", AgentID: "agente", Token: "token"}, rpc.NewRegistry(log), log)
		done <- result{b, err}
	}()
	var b *Bus
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("Connect: %v", r.err)
		}
		b = r.b
	case <-time.After(5 * time.Second):
		t.Fatal("Connect ficou preso no aperto de mao TLS")
	}
	defer b.nc.Close()

	connected := make(chan bool, 1)
	go func() { connected <- b.Connected() }()
	select {
	case ok := <-connected:
		if ok {
			t.Fatal("nao deveria estar conectado")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Connected ficou preso: a reconexao segura o lock da conexao")
	}
}

func TestProxySemRespostaRespeitaOPrazo(t *testing.T) {
	shortHandshake(t)
	addr, accepted := silentListener(t)
	d, err := newProxyDialer("http://" + addr)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	done := make(chan error, 1)
	go func() {
		c, err := d.Dial("tcp", "servidor.exemplo:443")
		if c != nil {
			c.Close()
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("o tunel deveria falhar sem resposta do proxy")
		}
		if time.Since(start) > 3*time.Second {
			t.Fatalf("demorou %s", time.Since(start))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("o pedido CONNECT ao proxy ficou sem prazo")
	}
	if accepted.Load() == 0 {
		t.Fatal("o proxy de teste nao recebeu a conexao")
	}
}

// O prazo do aperto de mao nao pode sobrar na conexao estabelecida: o nats.go o retira no fim do CONNECT, e o
// deadlineDialer so o marca, sem envolver a conexao.
func TestDeadlineDialerDevolveAConexaoCrua(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err == nil {
			defer c.Close()
			time.Sleep(time.Second)
		}
	}()
	d := &deadlineDialer{d: net.Dialer{Timeout: time.Second}}
	c, err := d.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, ok := c.(*net.TCPConn); !ok {
		t.Fatalf("esperado *net.TCPConn, veio %T", c)
	}
}
