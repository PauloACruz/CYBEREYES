// Package bus e a conexao NATS do EYES: recebe comandos no assunto <agent_id> e publica
// check-ins, saidas de comandos e quadros de terminal. As mensagens sao msgpack.
package bus

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// Options configura a conexao.
type Options struct {
	URL      string
	AgentID  string
	Token    string
	Insecure bool
	Proxy    string
}

// Bus e a conexao ativa.
type Bus struct {
	opt  Options
	log  *slog.Logger
	nc   *nats.Conn
	reg  *rpc.Registry
	wg   sync.WaitGroup
	ctx  context.Context
	sub  *nats.Subscription
	once sync.Once
}

// Connect abre a conexao e tenta reconectar para sempre quando ela cai.
func Connect(ctx context.Context, opt Options, reg *rpc.Registry, log *slog.Logger) (*Bus, error) {
	b := &Bus{opt: opt, log: log, reg: reg, ctx: ctx}
	opts := []nats.Option{
		nats.Name("EYES " + version.Version + " " + opt.AgentID),
		nats.UserInfo(opt.AgentID, opt.Token),
		// O agente publica check-ins no proprio assunto: sem eco, ele nao recebe de volta.
		nats.NoEcho(),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(5 * time.Second),
		nats.ReconnectJitter(2*time.Second, 5*time.Second),
		nats.RetryOnFailedConnect(true),
		nats.PingInterval(30 * time.Second),
		nats.MaxPingsOutstanding(3),
		nats.Timeout(15 * time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				log.Warn("NATS desconectado", "erro", err)
			}
		}),
		nats.ReconnectHandler(func(c *nats.Conn) { log.Info("NATS reconectado", "servidor", c.ConnectedUrlRedacted()) }),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { log.Warn("erro no NATS", "erro", err) }),
	}
	if opt.Insecure {
		opts = append(opts, nats.Secure(&tls.Config{InsecureSkipVerify: true})) //nolint:gosec // opcao explicita de laboratorio
	}
	if opt.Proxy != "" {
		d, err := newProxyDialer(opt.Proxy)
		if err != nil {
			return nil, err
		}
		opts = append(opts, nats.SetCustomDialer(d))
	}
	nc, err := nats.Connect(opt.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("conexao NATS: %w", err)
	}
	b.nc = nc
	sub, err := nc.Subscribe(opt.AgentID, b.onMessage)
	if err != nil {
		nc.Close()
		return nil, err
	}
	b.sub = sub
	return b, nil
}

// Connected informa se a conexao esta ativa.
func (b *Bus) Connected() bool { return b.nc != nil && b.nc.IsConnected() }

// Close encerra a assinatura, espera os comandos em andamento (ate 10 s) e fecha a conexao.
func (b *Bus) Close() {
	b.once.Do(func() {
		if b.sub != nil {
			_ = b.sub.Unsubscribe()
		}
		done := make(chan struct{})
		go func() { b.wg.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
		}
		_ = b.nc.Drain()
	})
}

func (b *Bus) onMessage(msg *nats.Msg) {
	var req rpc.Request
	if err := msgpack.Unmarshal(msg.Data, &req); err != nil {
		b.log.Warn("mensagem invalida no NATS", "erro", err)
		return
	}
	if req.Func() == "" {
		// Eco de check-in ou mensagem sem comando.
		return
	}
	// Os comandos de terminal precisam chegar na ordem (entrada do teclado): sao tratados na propria
	// goroutine da assinatura, que o nats.go executa em sequencia. Eles nao bloqueiam.
	if strings.HasPrefix(req.Func(), "terminal_") {
		b.handle(msg, req)
		return
	}
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		b.handle(msg, req)
	}()
}

func (b *Bus) handle(msg *nats.Msg, req rpc.Request) {
	reply := b.reg.Dispatch(b.ctx, req)
	if msg.Reply == "" {
		return
	}
	data, err := Encode(reply)
	if err != nil {
		b.log.Error("falha ao codificar resposta", "func", req.Func(), "erro", err)
		data, _ = Encode("error: falha ao codificar resposta")
	}
	if err := msg.Respond(data); err != nil {
		b.log.Warn("falha ao responder", "func", req.Func(), "erro", err)
	}
}

// Checkin publica no assunto <agent_id> com o tipo no campo reply (agent-hello, agent-disks...).
func (b *Bus) Checkin(kind string, body any) error {
	data, err := Encode(body)
	if err != nil {
		return err
	}
	return b.nc.PublishMsg(&nats.Msg{Subject: b.opt.AgentID, Reply: kind, Data: data})
}

// Publish publica em <agent_id>.<sufixo> (por exemplo cmdoutput.<run_id> ou terminal.<sessao>).
func (b *Bus) Publish(suffix string, body any) error {
	data, err := Encode(body)
	if err != nil {
		return err
	}
	return b.nc.Publish(b.opt.AgentID+"."+suffix, data)
}

// Encode serializa em msgpack usando as tags json das structs.
func Encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := msgpack.NewEncoder(&buf)
	enc.SetCustomStructTag("json")
	enc.UseCompactInts(true)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// proxyDialer abre um tunel HTTP CONNECT ate o servidor NATS.
type proxyDialer struct {
	proxy *url.URL
	d     net.Dialer
}

func newProxyDialer(raw string) (*proxyDialer, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("proxy invalido: %q", raw)
	}
	return &proxyDialer{proxy: u, d: net.Dialer{Timeout: 15 * time.Second}}, nil
}

func (p *proxyDialer) Dial(network, address string) (net.Conn, error) {
	conn, err := p.d.Dial(network, p.proxy.Host)
	if err != nil {
		return nil, err
	}
	req := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: address}, Host: address, Header: http.Header{}}
	if p.proxy.User != nil {
		pass, _ := p.proxy.User.Password()
		cred := base64.StdEncoding.EncodeToString([]byte(p.proxy.User.Username() + ":" + pass))
		req.Header.Set("Proxy-Authorization", "Basic "+cred)
	}
	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		conn.Close()
		return nil, err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		conn.Close()
		return nil, fmt.Errorf("proxy recusou o tunel: %s", resp.Status)
	}
	return conn, nil
}
