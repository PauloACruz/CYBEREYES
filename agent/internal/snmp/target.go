package snmp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
)

// Target e um dispositivo a coletar (SnmpPollTarget, contrato secao 3.11).
type Target struct {
	ID         int      `json:"id"`
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	Version    string   `json:"version"`
	Community  string   `json:"community"`
	V3         *V3      `json:"v3"`
	Interval   int      `json:"interval"`
	Timeout    int      `json:"timeout"`
	Retries    int      `json:"retries"`
	Interfaces bool     `json:"interfaces"`
	Sensors    []Sensor `json:"sensors"`
}

// V3 sao as credenciais SNMPv3 (USM).
type V3 struct {
	Username      string `json:"username"`
	SecurityLevel string `json:"security_level"`
	AuthProtocol  string `json:"auth_protocol"`
	AuthPassword  string `json:"auth_password"`
	PrivProtocol  string `json:"priv_protocol"`
	PrivPassword  string `json:"priv_password"`
}

// Sensor e um OID numerico lido por GET.
type Sensor struct {
	ID  int    `json:"id"`
	OID string `json:"oid"`
}

// ParseTarget le um alvo em JSON (payload.target do snmp_test) e normaliza os valores.
func ParseTarget(raw string) (Target, error) {
	var t Target
	if strings.TrimSpace(raw) == "" {
		return t, errors.New("alvo vazio")
	}
	if err := json.Unmarshal([]byte(raw), &t); err != nil {
		return t, fmt.Errorf("JSON invalido: %w", err)
	}
	return t, t.normalize()
}

// normalize confere o alvo e aplica padroes e limites.
func (t *Target) normalize() error {
	t.Host = strings.TrimSpace(t.Host)
	if t.Host == "" {
		return errors.New("host obrigatorio")
	}
	switch v := strings.ToLower(strings.TrimSpace(t.Version)); v {
	case "v2c", "2c", "v2", "2", "":
		t.Version = "v2c"
	case "v3", "3":
		t.Version = "v3"
	case "v1", "1":
		t.Version = "v1"
	default:
		return fmt.Errorf("versao SNMP desconhecida: %s", t.Version)
	}
	if t.Port == 0 {
		t.Port = 161
	}
	if t.Port < 1 || t.Port > 65535 {
		return fmt.Errorf("porta invalida: %d", t.Port)
	}
	if t.Interval <= 0 {
		t.Interval = 300
	}
	t.Interval = clamp(t.Interval, 60, 3600)
	if t.Timeout <= 0 {
		t.Timeout = 5
	}
	t.Timeout = clamp(t.Timeout, 1, 60)
	t.Retries = clamp(t.Retries, 0, 10)
	if t.Version == "v3" && (t.V3 == nil || strings.TrimSpace(t.V3.Username) == "") {
		return errors.New("usuario SNMPv3 obrigatorio")
	}
	return nil
}

func clamp(v, lo, hi int) int {
	return max(lo, min(v, hi))
}

// authProtocol converte o nome do contrato (SHA, SHA256, SHA512, MD5) no valor do gosnmp.
func authProtocol(name string) (gosnmp.SnmpV3AuthProtocol, error) {
	switch strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(name), "-", "")) {
	case "", "SHA", "SHA1":
		return gosnmp.SHA, nil
	case "MD5":
		return gosnmp.MD5, nil
	case "SHA224":
		return gosnmp.SHA224, nil
	case "SHA256":
		return gosnmp.SHA256, nil
	case "SHA384":
		return gosnmp.SHA384, nil
	case "SHA512":
		return gosnmp.SHA512, nil
	}
	return 0, fmt.Errorf("protocolo de autenticacao desconhecido: %s", name)
}

// privProtocol converte o nome do contrato (AES, AES256, DES) no valor do gosnmp. AES256 e o
// AES-256 com extensao de chave de Blumenthal (o do net-snmp); AES256C e a variante de Reeder.
func privProtocol(name string) (gosnmp.SnmpV3PrivProtocol, error) {
	switch strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(name), "-", "")) {
	case "", "AES", "AES128":
		return gosnmp.AES, nil
	case "DES":
		return gosnmp.DES, nil
	case "AES192":
		return gosnmp.AES192, nil
	case "AES256":
		return gosnmp.AES256, nil
	case "AES192C":
		return gosnmp.AES192C, nil
	case "AES256C":
		return gosnmp.AES256C, nil
	}
	return 0, fmt.Errorf("protocolo de privacidade desconhecido: %s", name)
}

// params monta a sessao gosnmp do alvo (sem conectar).
func (t Target) params(ctx context.Context) (*gosnmp.GoSNMP, error) {
	g := &gosnmp.GoSNMP{
		Target:         t.Host,
		Port:           uint16(t.Port), //nolint:gosec // conferido em normalize
		Transport:      "udp",
		Community:      t.Community,
		Version:        gosnmp.Version2c,
		Timeout:        time.Duration(t.Timeout) * time.Second,
		Retries:        t.Retries,
		MaxOids:        gosnmp.MaxOids,
		MaxRepetitions: 25,
		Context:        ctx,
	}
	switch t.Version {
	case "v1":
		g.Version = gosnmp.Version1
	case "v3":
		g.Version = gosnmp.Version3
		g.Community = ""
		g.SecurityModel = gosnmp.UserSecurityModel
		usm := &gosnmp.UsmSecurityParameters{UserName: t.V3.Username}
		switch strings.ToLower(strings.TrimSpace(t.V3.SecurityLevel)) {
		case "authpriv":
			g.MsgFlags = gosnmp.AuthPriv
		case "authnopriv":
			g.MsgFlags = gosnmp.AuthNoPriv
		case "noauthnopriv", "":
			g.MsgFlags = gosnmp.NoAuthNoPriv
		default:
			return nil, fmt.Errorf("nivel de seguranca SNMPv3 desconhecido: %s", t.V3.SecurityLevel)
		}
		if g.MsgFlags&gosnmp.AuthNoPriv != 0 {
			p, err := authProtocol(t.V3.AuthProtocol)
			if err != nil {
				return nil, err
			}
			usm.AuthenticationProtocol = p
			usm.AuthenticationPassphrase = t.V3.AuthPassword
		} else {
			usm.AuthenticationProtocol = gosnmp.NoAuth
		}
		if g.MsgFlags&gosnmp.AuthPriv == gosnmp.AuthPriv {
			p, err := privProtocol(t.V3.PrivProtocol)
			if err != nil {
				return nil, err
			}
			usm.PrivacyProtocol = p
			usm.PrivacyPassphrase = t.V3.PrivPassword
		} else {
			usm.PrivacyProtocol = gosnmp.NoPriv
		}
		g.SecurityParameters = usm
	}
	return g, nil
}

// session e o que a coleta usa de uma sessao SNMP (abstraida para os testes).
type session interface {
	Get(oids []string) (*gosnmp.SnmpPacket, error)
	Walk(root string) ([]gosnmp.SnmpPDU, error)
	Close()
}

type goSession struct{ g *gosnmp.GoSNMP }

func (s goSession) Get(oids []string) (*gosnmp.SnmpPacket, error) { return s.g.Get(oids) }

func (s goSession) Walk(root string) ([]gosnmp.SnmpPDU, error) {
	if s.g.Version == gosnmp.Version1 {
		return s.g.WalkAll(root)
	}
	return s.g.BulkWalkAll(root)
}

func (s goSession) Close() { _ = s.g.Close() }

// dial abre a sessao UDP do alvo.
func dial(ctx context.Context, t Target) (session, error) {
	g, err := t.params(ctx)
	if err != nil {
		return nil, err
	}
	if err := g.Connect(); err != nil {
		return nil, err
	}
	return goSession{g: g}, nil
}
