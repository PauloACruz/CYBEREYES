// Package rdp ativa o compartilhamento de tela por RDP do GNOME (gnome-remote-desktop) na sessao do
// usuario conectado. E o caminho de acesso grafico em Linux com sessao Wayland, que o MeshAgent nao captura:
// o tecnico conecta pelo Web-RDP do MeshCentral, num tunel do proprio MeshAgent ate a porta local.
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

// Register registra rdp_enable e rdp_disable.
func Register(e *env.Env) error {
	e.Reg.HandleTimeout("rdp_enable", 80*time.Second, func(ctx context.Context, _ rpc.Request) any {
		a, err := enable(ctx)
		if err != nil {
			e.Log.Warn("RDP: falha ao ativar", "erro", err)
			return "error: " + err.Error()
		}
		e.Log.Info("RDP ativado na sessao do usuario", "usuario", a.User, "porta", a.Port)
		return a
	})
	e.Reg.HandleTimeout("rdp_disable", 40*time.Second, func(ctx context.Context, _ rpc.Request) any {
		if err := disable(ctx); err != nil {
			return "error: " + err.Error()
		}
		return "ok"
	})
	return nil
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
