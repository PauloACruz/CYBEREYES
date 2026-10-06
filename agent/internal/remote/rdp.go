package remote

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"github.com/pauloacruz/cybereyes/agent/internal/rdp"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/rdcleanpath"
)

// Pontos trocados nos testes: conexao ao servidor RDP local e desligamento do RDP do GNOME no fim.
var (
	rdpDial = func(ctx context.Context, port int) (net.Conn, error) {
		d := net.Dialer{Timeout: 10 * time.Second}
		return d.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	}
	rdpDisable = rdp.Disable
)

// runRDP atende o canal rdp (contrato, secao 5.4): o EYES faz o papel de proxy RDCleanPath entre o cliente RDP do
// navegador e o gnome-remote-desktop da maquina. O servidor so e procurado em 127.0.0.1, na porta que o rdp_enable
// devolveu; o destino pedido pelo navegador e ignorado. O aviso e o pedido de acesso seguem a politica, como na Tela.
func runRDP(ctx context.Context, t target, p HelperParams, port int, technician string, log *slog.Logger) error {
	defer func() {
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 40*time.Second)
		defer cancel()
		if err := rdpDisable(dctx); err != nil {
			log.Warn("RDP do GNOME nao foi desligado no fim da sessao", "erro", err)
		}
	}()
	conn, err := dialRelay(ctx, p, "rdp")
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	if err := authenticate(ctx, conn, p.Token); err != nil {
		return err
	}
	if err := waitPaired(ctx, conn); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	control := make(chan Control, 8)
	go func() {
		stop := consent(ctx, log, t, p, technician, control)
		<-ctx.Done()
		stop()
	}()
	if p.Policy.Consent == "ask" {
		ok, err := waitConsent(ctx, conn, control)
		if err != nil || !ok {
			return err
		}
	}
	go func() {
		// Fim pedido pelo usuario no eyes-tray.
		for {
			select {
			case <-ctx.Done():
				return
			case c := <-control:
				if c.End != "" {
					_ = sendJSON(ctx, conn, proto.Bye, proto.ReasonBody{Reason: c.End})
					_ = conn.Close(websocket.StatusNormalClosure, c.End)
					cancel()
					return
				}
			}
		}
	}()

	rctx, rcancel := context.WithTimeout(ctx, 30*time.Second)
	_, msg, err := conn.Read(rctx)
	rcancel()
	if err != nil {
		return fmt.Errorf("aguardando o pedido RDCleanPath: %w", err)
	}
	server, err := rdpConnect(ctx, msg, port, func(pdu rdcleanpath.PDU) error { return sendRDCleanPath(ctx, conn, pdu) })
	if err != nil {
		return err
	}
	defer server.Close()
	log.Info("RDP do GNOME conectado pelo relay", "porta", port)
	return pumpRDP(ctx, conn, server)
}

// rdpConnect trata o pedido RDCleanPath: X.224 e TLS com o servidor local e resposta com a cadeia de certificados.
// Nos erros, o navegador recebe a resposta de erro do RDCleanPath antes do retorno.
func rdpConnect(ctx context.Context, msg []byte, port int, reply func(rdcleanpath.PDU) error) (*tls.Conn, error) {
	req, err := rdcleanpath.DecodeRequest(msg)
	if err != nil {
		_ = reply(rdcleanpath.NewHTTPError(400))
		return nil, fmt.Errorf("pedido RDCleanPath invalido: %w", err)
	}
	raw, err := rdpDial(ctx, port)
	if err != nil {
		_ = reply(rdcleanpath.NewHTTPError(502))
		return nil, fmt.Errorf("servidor RDP local na porta %d: %w", port, err)
	}
	ok := false
	defer func() {
		if !ok {
			raw.Close()
		}
	}()
	_ = raw.SetDeadline(time.Now().Add(20 * time.Second))
	if _, err := raw.Write(req.X224ConnectionPDU); err != nil {
		_ = reply(rdcleanpath.NewHTTPError(502))
		return nil, err
	}
	x224, err := readTPKT(raw)
	if err != nil {
		_ = reply(rdcleanpath.NewHTTPError(502))
		return nil, fmt.Errorf("resposta X.224 do servidor RDP: %w", err)
	}
	if negotiationFailed(x224) {
		_ = reply(rdcleanpath.NewNegotiationError(x224))
		return nil, errors.New("o servidor RDP recusou a negociacao")
	}
	// O certificado e o proprio do EYES (rdp_enable) e a conexao fica em 127.0.0.1; o CredSSP do navegador amarra a
	// credencial a chave publica que vai na resposta.
	server := tls.Client(raw, &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}) //nolint:gosec // servidor local, ver acima
	if err := server.HandshakeContext(ctx); err != nil {
		var alert tls.AlertError
		if errors.As(err, &alert) {
			_ = reply(rdcleanpath.NewTLSError(int(alert)))
		} else {
			_ = reply(rdcleanpath.NewHTTPError(502))
		}
		return nil, fmt.Errorf("TLS com o servidor RDP: %w", err)
	}
	var chain [][]byte
	for _, c := range server.ConnectionState().PeerCertificates {
		chain = append(chain, c.Raw)
	}
	if err := reply(rdcleanpath.NewResponse("127.0.0.1", x224, chain)); err != nil {
		return nil, err
	}
	_ = raw.SetDeadline(time.Time{})
	ok = true
	return server, nil
}

// readTPKT le um pacote TPKT inteiro (versao 3, tamanho em big-endian com o cabecalho).
func readTPKT(r io.Reader) ([]byte, error) {
	head := make([]byte, 4)
	if _, err := io.ReadFull(r, head); err != nil {
		return nil, err
	}
	size := int(binary.BigEndian.Uint16(head[2:]))
	if head[0] != 3 || size < 11 {
		return nil, errors.New("pacote TPKT invalido")
	}
	pkt := make([]byte, size)
	copy(pkt, head)
	if _, err := io.ReadFull(r, pkt[4:]); err != nil {
		return nil, err
	}
	return pkt, nil
}

// negotiationFailed confere se o Connection Confirm traz RDP_NEG_FAILURE (tipo 3 logo depois do cabecalho X.224).
func negotiationFailed(x224 []byte) bool {
	return len(x224) >= 12 && x224[5] == 0xD0 && x224[11] == 0x03
}

func sendRDCleanPath(ctx context.Context, conn *websocket.Conn, pdu rdcleanpath.PDU) error {
	der, err := pdu.Encode()
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageBinary, append([]byte{proto.RdpData}, der...))
}

// pumpRDP leva os bytes nos dois sentidos: do navegador chegam sem cabecalho; para o navegador vao como RdpData.
func pumpRDP(ctx context.Context, conn *websocket.Conn, server net.Conn) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-ctx.Done()
		_ = server.Close()
	}()
	errs := make(chan error, 2)
	go func() {
		for {
			_, msg, err := conn.Read(ctx)
			if err != nil {
				errs <- err
				return
			}
			if _, err := server.Write(msg); err != nil {
				errs <- err
				return
			}
		}
	}()
	go func() {
		buf := make([]byte, 64<<10)
		for {
			n, err := server.Read(buf[1:])
			if n > 0 {
				buf[0] = proto.RdpData
				if werr := conn.Write(ctx, websocket.MessageBinary, buf[:n+1]); werr != nil {
					errs <- werr
					return
				}
			}
			if err != nil {
				errs <- err
				return
			}
		}
	}()
	err := <-errs
	if errors.Is(err, io.EOF) || ctx.Err() != nil || websocket.CloseStatus(err) != -1 {
		_ = conn.Close(websocket.StatusNormalClosure, "fim")
		return nil
	}
	return err
}
