// Package rdp ativa o compartilhamento de tela por RDP do GNOME (gnome-remote-desktop) na sessao do
// usuario conectado. E o caminho de acesso grafico em Linux com sessao Wayland, que o remote-helper nao captura:
// o tecnico conecta pelo cliente RDP do navegador, e o EYES leva o RDP pelo relay do acesso remoto ate a porta
// local (canal rdp, docs/remoto/contrato-remoto.md).
package rdp

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"regexp"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Username e o usuario RDP criado pelo EYES (a senha muda a cada ativacao).
const Username = "eyes"

// Access e a resposta do comando rdp_enable.
type Access struct {
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	User     string `json:"user"` // usuario da sessao compartilhada
}

// ServiceUnit e o servico do gnome-remote-desktop na sessao do usuario.
const ServiceUnit = "gnome-remote-desktop.service"

// active conta as ativacoes em uso: a limpeza da partida nao desliga um RDP que um tecnico esta usando.
var active atomic.Int32

// Register registra rdp_enable e rdp_disable e, na partida, desliga o RDP que tenha ficado ligado de antes (EYES
// reiniciado no meio de uma sessao, versao antiga que deixava o servico habilitado): o compartilhamento de tela so
// existe entre o "Acessar" e o "Encerrar" do tecnico.
func Register(e *env.Env) error {
	e.Reg.HandleTimeout("rdp_enable", 80*time.Second, func(ctx context.Context, req rpc.Request) any {
		active.Add(1)
		a, err := enable(ctx, req.Payload().Bool("view_only"))
		if err != nil {
			active.Add(-1)
			e.Log.Warn("RDP: falha ao ativar", "erro", err)
			return "error: " + err.Error()
		}
		e.Log.Info("RDP ativado na sessao do usuario", "usuario", a.User, "porta", a.Port)
		return a
	})
	e.Reg.HandleTimeout("rdp_disable", 40*time.Second, func(ctx context.Context, _ rpc.Request) any {
		if err := Disable(ctx); err != nil {
			return "error: " + err.Error()
		}
		return "ok"
	})
	e.Go("rdp-limpeza", func(ctx context.Context) { cleanupAtStart(ctx, e) })
	return nil
}

// Disable desliga o compartilhamento RDP do GNOME (fim da sessao do canal rdp).
func Disable(ctx context.Context) error {
	if active.Load() > 0 {
		active.Add(-1)
	}
	return disableFn(ctx)
}

// disableFn e o desligamento do sistema (trocado nos testes).
var disableFn = disable

// disableSteps desliga tudo o que o rdp_enable ligou: o RDP, a credencial temporaria, o servico do usuario e a
// habilitacao no login (versoes ate o EYES 3.2.3 deixavam o servico habilitado).
func disableSteps() [][]string {
	return [][]string{
		{"grdctl", "rdp", "disable"},
		{"grdctl", "rdp", "clear-credentials"},
		{"systemctl", "--user", "stop", ServiceUnit},
		{"systemctl", "--user", "disable", ServiceUnit},
	}
}

const passwordChars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// newPassword gera uma senha aleatoria sem caracteres ambiguos (o tecnico pode precisar digitar).
func newPassword(n int) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(passwordChars)))
	for i := range b {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}
		b[i] = passwordChars[v.Int64()]
	}
	return string(b)
}

// selfSigned gera certificado e chave TLS autoassinados para o servidor RDP.
func selfSigned(host string) (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	if err != nil {
		return nil, nil, err
	}
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: host, Organization: []string{"Cybereyes EYES"}},
		DNSNames:              []string{host},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(5, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	kder, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kder}), nil
}

var portLine = regexp.MustCompile(`(?mi)^\s*port:\s*(\d+)`)

// parsePort le a porta do "grdctl status" (3389 quando ausente).
func parsePort(status string) int {
	if m := portLine.FindStringSubmatch(status); m != nil {
		if p, err := strconv.Atoi(m[1]); err == nil && p > 0 && p < 65536 {
			return p
		}
	}
	return 3389
}
