package rdp

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
)

func TestParsePort(t *testing.T) {
	status := "Overall:\n\tUnit status: active\nRDP:\n\tStatus: enabled\n\tPort: 3390\n\tTLS certificate: /x\n"
	if got := parsePort(status); got != 3390 {
		t.Fatalf("porta: %d", got)
	}
	if got := parsePort("sem porta"); got != 3389 {
		t.Fatalf("padrao: %d", got)
	}
}

func TestNewPassword(t *testing.T) {
	a, b := newPassword(16), newPassword(16)
	if len(a) != 16 || a == b || strings.ContainsAny(a, "0OIl1") {
		t.Fatalf("senha: %q %q", a, b)
	}
}

func TestSelfSigned(t *testing.T) {
	cert, key, err := selfSigned("maquina")
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(cert)
	c, err := x509.ParseCertificate(block.Bytes)
	if err != nil || c.Subject.CommonName != "maquina" {
		t.Fatalf("certificado: %v %v", err, c)
	}
	if kb, _ := pem.Decode(key); kb == nil || kb.Type != "PRIVATE KEY" {
		t.Fatal("chave invalida")
	}
}

func TestDisableStepsTurnEverythingOff(t *testing.T) {
	var got []string
	for _, s := range disableSteps() {
		got = append(got, strings.Join(s, " "))
	}
	want := []string{
		"grdctl rdp disable",
		"grdctl rdp clear-credentials",
		"systemctl --user stop " + ServiceUnit,
		"systemctl --user disable " + ServiceUnit,
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("passos:\n%v\nquer:\n%v", got, want)
	}
}

func TestDisableReleasesActiveCount(t *testing.T) {
	calls := 0
	old := disableFn
	disableFn = func(context.Context) error { calls++; return nil }
	t.Cleanup(func() { disableFn = old })
	active.Store(1)
	_ = Disable(context.Background())
	if active.Load() != 0 {
		t.Fatalf("contagem = %d", active.Load())
	}
	_ = Disable(context.Background())
	if active.Load() != 0 {
		t.Fatal("contagem nao pode ficar negativa")
	}
	if calls != 2 {
		t.Fatalf("desligamentos = %d", calls)
	}
}
