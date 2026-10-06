// Package remote implementa o acesso remoto do EYES (RFC-001, ADR-023; contrato em docs/remoto/contrato-remoto.md):
// o servico recebe remote_start pelo NATS, inicia o "eyes remote-helper" na sessao grafica do usuario e atende o
// canal de arquivos; o remote-helper captura a tela, aplica a entrada e sincroniza a area de transferencia pelo relay.
package remote

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// MaxSessions e o limite de sessoes simultaneas no agente (contrato, secao 10).
const MaxSessions = 2

var (
	errUnsupported = errors.New("acesso remoto nao suportado nesta sessao")
	// errWayland indica sessao so Wayland: a Tela nao captura, o console usa o canal rdp (RDP do GNOME).
	errWayland   = fmt.Errorf("%w: sessao Wayland", errUnsupported)
	errNoSession = errors.New("sem usuario conectado")
	sessionIDRe  = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// target e a sessao grafica onde o remote-helper roda.
type target struct {
	Env  []string
	User string
	// Session e o identificador da sessao no sistema (Windows: id da sessao do terminal).
	Session uint32
}

// Manager guarda as sessoes ativas no servico.
type Manager struct {
	e        *env.Env
	mu       sync.Mutex
	sessions map[string]context.CancelFunc
	launch   func(ctx context.Context, t target, p HelperParams, control <-chan Control, log *slog.Logger) error
	find     func(allowLogin bool) (target, error)
}

// Register registra remote_start, remote_stop e wol (Wake-on-LAN, que antes passava pelo MeshCentral).
func Register(e *env.Env) error {
	m := &Manager{e: e, sessions: map[string]context.CancelFunc{}, launch: launchHelper, find: findDesktop}
	e.Reg.HandleTimeout("remote_start", 15*time.Second, m.start)
	e.Reg.Handle("remote_stop", m.stop)
	e.Reg.HandleTimeout("wol", 15*time.Second, wol)
	return nil
}

func (m *Manager) start(_ context.Context, req rpc.Request) any {
	p := req.Payload()
	id := p.Str("session_id")
	relay := p.Str("relay_url")
	relay, ok := relayOnAPI(relay, m.e.Cfg.API)
	if !sessionIDRe.MatchString(id) || !ok || p.Str("token") == "" {
		return "error: pedido invalido"
	}
	policy, err := ParsePolicy(p.Str("policy"))
	if err != nil {
		return "error: politica invalida"
	}
	channels := strings.Split(p.Str("channels"), ",")
	params := HelperParams{
		SessionID: id, RelayURL: relay, Token: p.Str("token"), AgentToken: m.e.Cfg.Token, ViewOnly: p.Bool("view_only"),
		Policy: policy, Insecure: m.e.Cfg.Insecure, Proxy: m.e.Cfg.Proxy,
	}
	technician := p.Str("technician")

	m.mu.Lock()
	if len(m.sessions) >= MaxSessions {
		m.mu.Unlock()
		return "error: busy"
	}
	if _, dup := m.sessions[id]; dup {
		m.mu.Unlock()
		return "error: sessao ja iniciada"
	}
	var t target
	desktop := contains(channels, "desktop")
	rdpPort, _ := strconv.Atoi(p.Str("rdp_port"))
	useRDP := contains(channels, "rdp")
	switch {
	case useRDP && (desktop || rdpPort <= 0 || rdpPort > 65535):
		m.mu.Unlock()
		return "error: pedido invalido"
	case useRDP:
		// RDP do GNOME: o alvo so serve para o aviso e o pedido de acesso na sessao do usuario.
		t, err = m.find(false)
		if err != nil && !errors.Is(err, errWayland) {
			m.mu.Unlock()
			return "error: no session"
		}
	case desktop:
		t, err = m.find(policy.AllowAtLoginScreen)
		switch {
		case errors.Is(err, errWayland):
			m.mu.Unlock()
			return "error: wayland"
		case errors.Is(err, errUnsupported):
			m.mu.Unlock()
			return "error: unsupported"
		case err != nil:
			m.mu.Unlock()
			return "error: no session"
		}
	default:
		// So arquivos: o usuario conectado define as pastas (home); sem usuario, o resto continua funcionando.
		t, _ = m.find(true)
	}
	control := make(chan Control, 8)
	ctx, cancel := context.WithTimeout(m.e.Ctx, time.Duration(max(1, policy.MaxHours))*time.Hour)
	m.sessions[id] = cancel
	m.mu.Unlock()

	log := m.e.Log.With("sessao_remota", id)
	log.Info("acesso remoto iniciado", "tecnico", technician, "canais", channels, "somente_visualizacao", params.ViewOnly)
	var wg sync.WaitGroup
	if desktop {
		wg.Add(1)
		m.e.Go("remote-desktop", func(context.Context) {
			defer wg.Done()
			if err := m.runDesktop(ctx, t, params, technician, control); err != nil && ctx.Err() == nil {
				log.Warn("sessao de tela encerrada com erro", "erro", err)
			}
		})
	}
	if useRDP {
		wg.Add(1)
		m.e.Go("remote-rdp", func(context.Context) {
			defer wg.Done()
			if err := runRDP(ctx, t, params, rdpPort, technician, log); err != nil && ctx.Err() == nil {
				log.Warn("sessao RDP encerrada com erro", "erro", err)
			}
		})
	}
	if contains(channels, "files") {
		wg.Add(1)
		m.e.Go("remote-files", func(context.Context) {
			defer wg.Done()
			if err := runFiles(ctx, params, t, control, desktop, log); err != nil && ctx.Err() == nil {
				log.Warn("canal de arquivos encerrado com erro", "erro", err)
			}
		})
	}
	go func() {
		wg.Wait()
		m.end(id)
		log.Info("acesso remoto encerrado")
	}()
	return "ok"
}

// runDesktop inicia o remote-helper na sessao grafica e, em paralelo, aplica o aviso ou o pedido de acesso pelo
// eyes-tray; o resultado e o fim pedido pelo usuario seguem para o remote-helper pelo canal de controle.
func (m *Manager) runDesktop(ctx context.Context, t target, p HelperParams, technician string, control chan Control) error {
	log := m.e.Log.With("sessao_remota", p.SessionID)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		stop := consent(ctx, log, t, p, technician, control)
		<-ctx.Done()
		stop()
	}()
	return m.launch(ctx, t, p, control, log)
}

func (m *Manager) stop(_ context.Context, req rpc.Request) any {
	m.end(req.Payload().Str("session_id"))
	return "ok"
}

func (m *Manager) end(id string) {
	m.mu.Lock()
	cancel, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if ok {
		cancel()
	}
}

// relayOnAPI usa o caminho de relay_url sobre o endereco da API configurado no agente (contrato, secao 3): o EYES so
// conecta ao servidor que ja conhece, mesmo que o servidor anuncie outro nome.
func relayOnAPI(relay, apiBase string) (string, bool) {
	r, err := url.Parse(relay)
	if err != nil || !strings.HasPrefix(r.Path, "/api/remote/relay/") || strings.Contains(r.Path, "..") {
		return "", false
	}
	a, err := url.Parse(apiBase)
	if err != nil || a.Host == "" {
		return "", false
	}
	scheme := "wss"
	if a.Scheme == "http" {
		scheme = "ws"
	}
	return scheme + "://" + a.Host + strings.TrimRight(a.Path, "/") + r.Path, true
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if strings.TrimSpace(x) == v {
			return true
		}
	}
	return false
}

// runHelperProcess executa o binario atual como "eyes remote-helper": os parametros e depois as linhas de controle
// vao pela entrada padrao, que fica aberta durante a sessao.
func runHelperProcess(ctx context.Context, cmd *exec.Cmd, p HelperParams, control <-chan Control, log func(line string)) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go forwardLines(stderr, log)
	go func() {
		defer stdin.Close()
		if _, err := stdin.Write(append(data, '\n')); err != nil {
			return
		}
		enc := json.NewEncoder(stdin)
		for {
			select {
			case <-ctx.Done():
				return
			case c := <-control:
				if enc.Encode(c) != nil {
					return
				}
			}
		}
	}()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		<-done
		return nil
	}
}

func forwardLines(r io.Reader, log func(string)) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		log(sc.Text())
	}
}

// Executable e o caminho do binario atual (trocado nos testes).
var Executable = os.Executable
