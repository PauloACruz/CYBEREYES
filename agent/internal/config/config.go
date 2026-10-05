// Package config guarda a identidade e as credenciais do EYES em um arquivo JSON
// legivel apenas pelo administrador (root no Linux e macOS, SYSTEM e Administradores no Windows).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Config e o estado persistente do agente.
type Config struct {
	// API e o endereco base do servidor, por exemplo https://cyber.exemplo.com.br.
	API string `json:"api"`
	// AgentID e o identificador de 40 letras gerado na instalacao (usuario do NATS e assunto).
	AgentID string `json:"agent_id"`
	// PK e a chave primaria do agente no servidor.
	PK int `json:"pk"`
	// Token autentica o agente no REST (Authorization: Token) e no NATS (senha).
	Token     string `json:"token"`
	ClientID  int    `json:"client_id"`
	SiteID    int    `json:"site_id"`
	AgentType string `json:"agent_type"`
	// NatsURL sobrescreve o endereco padrao wss://<host>/natsws (vazio = padrao).
	NatsURL string `json:"nats_url,omitempty"`
	// Insecure desliga a verificacao do certificado TLS (somente laboratorio).
	Insecure bool `json:"insecure,omitempty"`
	// Proxy HTTP opcional para REST e NATS.
	Proxy string `json:"proxy,omitempty"`
}

// ErrNotInstalled indica que o arquivo de configuracao nao existe.
var ErrNotInstalled = errors.New("EYES nao instalado: arquivo de configuracao ausente")

// Validate confere os campos obrigatorios.
func (c *Config) Validate() error {
	if c.API == "" || c.AgentID == "" || c.Token == "" {
		return errors.New("configuracao incompleta (api, agent_id e token sao obrigatorios)")
	}
	u, err := url.Parse(c.API)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("endereco da API invalido: %q", c.API)
	}
	return nil
}

// NatsServer devolve o endereco do NATS: wss://<host>:443/natsws para https e ws://<host>:80/natsws para http.
// A porta e sempre explicita: o nats.go nao assume 443/80 em URLs de websocket e tentaria a porta 0.
func (c *Config) NatsServer() string {
	if c.NatsURL != "" {
		return c.NatsURL
	}
	u, err := url.Parse(c.API)
	if err != nil {
		return ""
	}
	scheme, port := "wss", "443"
	if u.Scheme == "http" {
		scheme, port = "ws", "80"
	}
	if p := u.Port(); p != "" {
		port = p
	}
	return scheme + "://" + net.JoinHostPort(u.Hostname(), port) + "/natsws"
}

// Load le a configuracao do caminho padrao.
func Load() (*Config, error) { return LoadFrom(File()) }

// LoadFrom le a configuracao de um caminho especifico.
func LoadFrom(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotInstalled
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("configuracao invalida em %s: %w", path, err)
	}
	c.API = strings.TrimRight(c.API, "/")
	return &c, c.Validate()
}

// Save grava a configuracao no caminho padrao de forma atomica.
func (c *Config) Save() error { return c.SaveTo(File()) }

// SaveTo grava a configuracao de forma atomica com permissao restrita.
func (c *Config) SaveTo(path string) error {
	if err := c.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := restrictDir(filepath.Dir(path)); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := restrictFile(tmp); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// File e o caminho do arquivo de configuracao.
func File() string { return filepath.Join(DataDir(), "eyes.json") }

// StateDir guarda estado de trabalho (posicao de logs, execucoes) que pode ser recriado.
func StateDir() string { return filepath.Join(DataDir(), "state") }
