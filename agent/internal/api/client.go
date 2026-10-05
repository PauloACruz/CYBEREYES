// Package api e o cliente REST do EYES para as rotas /api/v3 do servidor.
package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// Error e uma resposta HTTP de erro. Erros de negocio do servidor vem como string JSON.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("HTTP %d", e.Status)
	}
	return fmt.Sprintf("HTTP %d: %s", e.Status, e.Message)
}

// IsStatus informa se err e um *Error com o status indicado.
func IsStatus(err error, status int) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == status
}

// Options configura o transporte.
type Options struct {
	Insecure bool
	Proxy    string
	Timeout  time.Duration
}

// Client fala com o servidor. A autorizacao e um cabecalho completo, por exemplo "Token abc".
type Client struct {
	base   string
	auth   string
	header string
	http   *http.Client
}

// NewTransport monta o transporte HTTP comum (proxy e TLS).
func NewTransport(opt Options) (*http.Transport, error) {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: opt.Insecure} //nolint:gosec // opcao explicita de laboratorio
	if opt.Proxy != "" {
		u, err := url.Parse(opt.Proxy)
		if err != nil {
			return nil, fmt.Errorf("proxy invalido: %w", err)
		}
		tr.Proxy = http.ProxyURL(u)
	}
	return tr, nil
}

// New cria um cliente autenticado com o token do agente.
func New(base, token string, opt Options) (*Client, error) {
	return newClient(base, "Authorization", "Token "+token, opt)
}

// NewInstaller cria um cliente para as rotas de instalacao. Tokens de instalacao usam
// "Authorization: Token"; chaves de API usam o cabecalho X-API-KEY.
func NewInstaller(base, auth string, apiKey bool, opt Options) (*Client, error) {
	if apiKey {
		return newClient(base, "X-API-KEY", auth, opt)
	}
	return newClient(base, "Authorization", "Token "+auth, opt)
}

func newClient(base, header, auth string, opt Options) (*Client, error) {
	tr, err := NewTransport(opt)
	if err != nil {
		return nil, err
	}
	if opt.Timeout == 0 {
		opt.Timeout = 60 * time.Second
	}
	return &Client{
		base:   strings.TrimRight(base, "/"),
		header: header,
		auth:   auth,
		http:   &http.Client{Transport: tr, Timeout: opt.Timeout},
	}, nil
}

// Base devolve o endereco base do servidor.
func (c *Client) Base() string { return c.base }

// Get faz GET e decodifica o JSON em out (out pode ser nil).
func (c *Client) Get(ctx context.Context, path string, out any) error {
	return c.Do(ctx, http.MethodGet, path, nil, out)
}

// Post faz POST com corpo JSON.
func (c *Client) Post(ctx context.Context, path string, body, out any) error {
	return c.Do(ctx, http.MethodPost, path, body, out)
}

// Put faz PUT com corpo JSON.
func (c *Client) Put(ctx context.Context, path string, body, out any) error {
	return c.Do(ctx, http.MethodPut, path, body, out)
}

// Patch faz PATCH com corpo JSON.
func (c *Client) Patch(ctx context.Context, path string, body, out any) error {
	return c.Do(ctx, http.MethodPatch, path, body, out)
}

// Do executa a requisicao. Respostas de sucesso "ok" sao aceitas com out nil.
func (c *Client) Do(ctx context.Context, method, path string, body, out any) error {
	resp, err := c.send(ctx, method, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return &Error{Status: resp.StatusCode, Message: errorMessage(data)}
	}
	if out == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("resposta invalida de %s %s: %w", method, path, err)
	}
	return nil
}

// Download baixa um binario para w (rotas que devolvem application/octet-stream).
func (c *Client) Download(ctx context.Context, method, path string, body any, w io.Writer) (int64, error) {
	resp, err := c.send(ctx, method, path, body)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return 0, &Error{Status: resp.StatusCode, Message: errorMessage(data)}
	}
	return io.Copy(w, resp.Body)
}

func (c *Client) send(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "EYES/"+version.Version)
	req.Header.Set(c.header, c.auth)
	return c.http.Do(req)
}

// errorMessage extrai a mensagem de uma string JSON, de ProblemDetails ou do texto puro.
func errorMessage(data []byte) string {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(data, &s) == nil {
		return s
	}
	var p struct {
		Title  string `json:"title"`
		Detail string `json:"detail"`
	}
	if json.Unmarshal(data, &p) == nil && (p.Detail != "" || p.Title != "") {
		if p.Detail != "" {
			return p.Detail
		}
		return p.Title
	}
	if len(data) > 300 {
		data = data[:300]
	}
	return string(data)
}
