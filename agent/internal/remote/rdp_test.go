package remote

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/rdcleanpath"
)

// X.224 Connection Request e Confirm minimos (TPKT + X.224 + RDP_NEG_REQ/RSP pedindo e escolhendo TLS e CredSSP).
var (
	x224Request = []byte{0x03, 0x00, 0x00, 0x13, 0x0E, 0xE0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00}
	x224Confirm = []byte{0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0, 0, 0x12, 0x34, 0, 0x02, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00}
	x224Failure = []byte{0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0, 0, 0x12, 0x34, 0, 0x03, 0x00, 0x08, 0x00, 0x05, 0x00, 0x00, 0x00}
)

// fakeRDPServer responde o X.224 e, com confirm, faz o TLS e devolve em maiusculas o que receber.
func fakeRDPServer(t *testing.T, confirm []byte) (int, *x509.Certificate) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(7), Subject: pkix.Name{CommonName: "rdp-teste"}, NotBefore: time.Now().Add(-time.Hour),
		NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		got, err := readTPKT(c)
		if err != nil || !bytes.Equal(got, x224Request) {
			t.Errorf("X.224 recebido errado: % X %v", got, err)
			return
		}
		if _, err := c.Write(confirm); err != nil || confirm[11] != 0x02 {
			return
		}
		s := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}})
		buf := make([]byte, 1024)
		for {
			n, err := s.Read(buf)
			if err != nil {
				return
			}
			if _, err := s.Write(bytes.ToUpper(buf[:n])); err != nil {
				return
			}
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, cert
}

// fakeRelay faz o papel da API no canal rdp: AUTH, PAIRED e o pedido RDCleanPath do navegador.
func fakeRelay(t *testing.T, script func(ctx context.Context, c *websocket.Conn)) (string, chan struct{}) {
	t.Helper()
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		if !strings.HasSuffix(r.URL.Path, "/rdp") || r.Header.Get("Authorization") != "Token agente" {
			t.Errorf("conexao inesperada: %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		_, auth, err := c.Read(ctx)
		if err != nil || auth[0] != proto.Auth || !bytes.Contains(auth, []byte(`"token":"sessao"`)) {
			t.Errorf("AUTH errado: %q %v", auth, err)
			return
		}
		_ = c.Write(ctx, websocket.MessageBinary, []byte{proto.AuthOK, '{', '}'})
		_ = c.Write(ctx, websocket.MessageBinary, []byte{proto.Paired, '{', '}'})
		script(ctx, c)
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/remote/relay/0123456789abcdef0123456789abcdef", done
}

func rdpTestParams(relay string) HelperParams {
	return HelperParams{SessionID: "0123456789abcdef0123456789abcdef", RelayURL: relay, Token: "sessao", AgentToken: "agente", Policy: Policy{Consent: "none"}}
}

func readRdpData(ctx context.Context, t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	_, msg, err := c.Read(ctx)
	if err != nil || len(msg) < 1 || msg[0] != proto.RdpData {
		t.Fatalf("esperava RdpData: % X %v", msg, err)
	}
	return msg[1:]
}

func TestRunRDPProxiesThroughTLS(t *testing.T) {
	port, cert := fakeRDPServer(t, x224Confirm)
	disabled := make(chan struct{}, 1)
	old := rdpDisable
	rdpDisable = func(context.Context) error { disabled <- struct{}{}; return nil }
	t.Cleanup(func() { rdpDisable = old })

	req, _ := rdcleanpath.NewRequest(x224Request, "maquina", "token-do-visualizador", "").Encode()
	relay, done := fakeRelay(t, func(ctx context.Context, c *websocket.Conn) {
		if err := c.Write(ctx, websocket.MessageBinary, req); err != nil {
			t.Error(err)
			return
		}
		resp, err := rdcleanpath.Decode(readRdpData(ctx, t, c))
		if err != nil {
			t.Errorf("resposta RDCleanPath: %v", err)
			return
		}
		if !bytes.Equal(resp.X224ConnectionPDU, x224Confirm) || len(resp.ServerCertChain) != 1 || !bytes.Equal(resp.ServerCertChain[0], cert.Raw) || resp.ServerAddr != "127.0.0.1" {
			t.Errorf("resposta errada: %+v", resp)
			return
		}
		// Depois do RDCleanPath o navegador fala o RDP sem TLS; o EYES leva para dentro do TLS do servidor.
		_ = c.Write(ctx, websocket.MessageBinary, []byte("ola rdp"))
		if got := readRdpData(ctx, t, c); string(got) != "OLA RDP" {
			t.Errorf("eco errado: %q", got)
		}
		_ = c.Close(websocket.StatusNormalClosure, "fim")
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := runRDP(ctx, target{}, rdpTestParams(relay), port, "Joao", slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	<-done
	select {
	case <-disabled:
	default:
		t.Fatal("o RDP do GNOME nao foi desligado no fim")
	}
}

func TestRDPConnectErrors(t *testing.T) {
	ctx := context.Background()
	var replies []rdcleanpath.PDU
	reply := func(p rdcleanpath.PDU) error { replies = append(replies, p); return nil }

	if _, err := rdpConnect(ctx, []byte("lixo"), 1, reply); err == nil || replies[0].Error.HTTPStatusCode != 400 {
		t.Fatalf("pedido invalido: %v %+v", err, replies)
	}

	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	req, _ := rdcleanpath.NewRequest(x224Request, "maquina", "x", "").Encode()
	replies = nil
	if _, err := rdpConnect(ctx, req, closed, reply); err == nil || replies[0].Error.HTTPStatusCode != 502 {
		t.Fatalf("servidor fora do ar: %v %+v", err, replies)
	}

	port, _ := fakeRDPServer(t, x224Failure)
	replies = nil
	if _, err := rdpConnect(ctx, req, port, reply); err == nil || replies[0].Error.Code != rdcleanpath.NegotiationError ||
		!bytes.Equal(replies[0].X224ConnectionPDU, x224Failure) {
		t.Fatalf("negociacao recusada: %v %+v", err, replies)
	}
}

func TestReadTPKTRejectsGarbage(t *testing.T) {
	if _, err := readTPKT(bytes.NewReader([]byte{0x16, 0x03, 0x01, 0x00, 0x05})); err == nil {
		t.Fatal("aceitou TLS no lugar de TPKT")
	}
	if _, err := readTPKT(bytes.NewReader(x224Confirm[:10])); err == nil {
		t.Fatal("aceitou pacote cortado")
	}
}
