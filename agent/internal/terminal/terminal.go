// Package terminal implementa o terminal remoto do console (contrato, secao 4.6): o servidor manda
// terminal_start, terminal_input, terminal_resize e terminal_kill por publish (sem reply) e o agente
// devolve os quadros em <agent_id>.terminal.<session_id>.
//
// Quadros publicados:
//   - saida: valor msgpack de topo "bin" com os bytes crus do PTY (o servidor repassa em base64 sem
//     decodificar, entao caracteres multibyte partidos entre quadros sao seguros);
//   - fim: mapa { done: true, exit_code: int }, sem "output" (o campo passa por texto UTF-8 no servidor).
//
// O shell roda como SYSTEM/root: o servidor sempre manda run_as_user = false.
package terminal

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Limites padrao das sessoes.
const (
	// DefaultMaxSessions e o numero maximo de terminais abertos ao mesmo tempo.
	DefaultMaxSessions = 10
	// DefaultIdleTimeout encerra a sessao sem entrada do navegador por esse tempo.
	DefaultIdleTimeout = 30 * time.Minute
	// DefaultMaxLifetime encerra a sessao depois desse tempo, com ou sem uso.
	DefaultMaxLifetime = 8 * time.Hour
	// DefaultFlushInterval e a janela de agrupamento da saida (no maximo um quadro por janela).
	DefaultFlushInterval = 20 * time.Millisecond
	// DefaultMaxFrame e o tamanho maximo de cada quadro de saida.
	DefaultMaxFrame = 32 << 10

	defaultCols = 80
	defaultRows = 24
	maxDim      = 1000

	// Entradas enfileiradas por sessao antes de descartar (o shell parou de ler).
	inputQueue = 256
	// Depois do fim do shell, tempo para a saida pendente chegar antes de fechar o PTY.
	drainGrace = 300 * time.Millisecond
	// Depois do fim do shell, tempo maximo esperando a leitura terminar antes de publicar o fim.
	readerGrace = 3 * time.Second
	// Tamanho pedido em terminal_resize antes do terminal_start fica guardado por esse tempo.
	pendingTTL = time.Minute
)

// publisher e a parte do env.Publisher usada aqui.
type publisher interface {
	Publish(suffix string, body any) error
}

// endFrame e o mapa de fim de sessao.
type endFrame struct {
	Done     bool `json:"done"`
	ExitCode int  `json:"exit_code"`
}

// console e o processo do shell ligado a um PTY (ou, no Windows antigo, a pipes).
type console interface {
	// Read le a saida do terminal. Devolve erro quando a saida acaba ou o console e fechado.
	Read(p []byte) (int, error)
	// Write envia a entrada digitada no navegador.
	Write(p []byte) (int, error)
	// Resize muda o tamanho do terminal.
	Resize(cols, rows int) error
	// Kill encerra o shell e os processos filhos.
	Kill()
	// Wait espera o fim do shell e devolve o codigo de saida. E chamado uma unica vez.
	Wait() int
	// CloseOutput, depois do fim do shell, libera a leitura pendente (fecha o PTY).
	CloseOutput()
	// Close libera os recursos restantes. Nao pode bloquear.
	Close()
}

// startFunc abre o console; trocada nos testes.
type startFunc func(shell string, cols, rows int) (console, error)

type size struct {
	cols, rows int
	at         time.Time
}

// Manager guarda as sessoes ativas.
type Manager struct {
	pub   publisher
	log   *slog.Logger
	start startFunc

	MaxSessions   int
	IdleTimeout   time.Duration
	MaxLifetime   time.Duration
	FlushInterval time.Duration
	MaxFrame      int

	mu       sync.Mutex
	sessions map[string]*session
	pending  map[string]size      // tamanho pedido antes do start
	killed   map[string]time.Time // kill recebido antes do start
	wg       sync.WaitGroup
}

// NewManager cria o gerenciador com os limites padrao.
func NewManager(pub publisher, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{
		pub:           pub,
		log:           log,
		start:         startConsole,
		MaxSessions:   DefaultMaxSessions,
		IdleTimeout:   DefaultIdleTimeout,
		MaxLifetime:   DefaultMaxLifetime,
		FlushInterval: DefaultFlushInterval,
		MaxFrame:      DefaultMaxFrame,
		sessions:      map[string]*session{},
		pending:       map[string]size{},
		killed:        map[string]time.Time{},
	}
}

// Register registra os comandos do terminal e encerra as sessoes quando o agente para.
func Register(e *env.Env) error {
	m := NewManager(e.Pub, e.Log)
	m.register(e.Reg)
	e.Go("terminal-shutdown", func(ctx context.Context) {
		<-ctx.Done()
		m.Shutdown()
	})
	return nil
}

func (m *Manager) register(reg *rpc.Registry) {
	reg.HandleTimeout("terminal_start", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		p := req.Payload()
		m.Start(p.Str("session_id"), p.Str("shell"))
		return nil
	})
	reg.HandleTimeout("terminal_input", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		p := req.Payload()
		m.Input(p.Str("session_id"), p.Str("data"))
		return nil
	})
	reg.HandleTimeout("terminal_resize", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		p := req.Payload()
		m.Resize(p.Str("session_id"), p.Int("cols"), p.Int("rows"))
		return nil
	})
	reg.HandleTimeout("terminal_kill", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		m.Kill(req.Payload().Str("session_id"))
		return nil
	})
}

// validID aceita so ids que podem virar token de assunto NATS (o servidor manda 32 hex).
func validID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func clampDim(v, def int) int {
	switch {
	case v <= 0:
		return def
	case v > maxDim:
		return maxDim
	}
	return v
}

// Start abre uma sessao. Falhas sao avisadas ao navegador com uma mensagem e o quadro de fim.
func (m *Manager) Start(id, shell string) {
	if !validID(id) {
		m.log.Warn("terminal: id de sessao invalido", "session", id)
		return
	}
	m.mu.Lock()
	if _, ok := m.sessions[id]; ok {
		m.mu.Unlock()
		m.log.Warn("terminal: sessao ja existe", "session", id)
		return
	}
	if _, ok := m.killed[id]; ok {
		// terminal_kill chegou antes do terminal_start: o navegador ja desistiu.
		delete(m.killed, id)
		delete(m.pending, id)
		m.mu.Unlock()
		return
	}
	if len(m.sessions) >= m.MaxSessions {
		m.mu.Unlock()
		m.log.Warn("terminal: limite de sessoes atingido", "session", id, "limite", m.MaxSessions)
		m.fail(id, fmt.Sprintf("limite de %d terminais simultaneos atingido neste agente", m.MaxSessions))
		return
	}
	cols, rows := defaultCols, defaultRows
	if sz, ok := m.pending[id]; ok {
		cols, rows = sz.cols, sz.rows
		delete(m.pending, id)
	}
	// Reserva o id enquanto o shell abre, para que resize e kill encontrem a sessao.
	s := &session{id: id, m: m, input: make(chan []byte, inputQueue),
		stop: make(chan struct{}), exited: make(chan struct{})}
	s.cols, s.rows = cols, rows
	m.sessions[id] = s
	m.mu.Unlock()

	c, err := m.start(shell, cols, rows)
	if err != nil {
		m.remove(id)
		m.log.Warn("terminal: falha ao abrir o shell", "session", id, "shell", shell, "erro", err)
		m.fail(id, "falha ao abrir o terminal: "+err.Error())
		return
	}
	m.log.Info("terminal aberto", "session", id, "shell", shell)
	s.run(c, cols, rows)
}

// fail publica uma mensagem de erro e o quadro de fim de uma sessao que nao chegou a abrir.
func (m *Manager) fail(id, msg string) {
	m.publish(id, []byte("\r\n[EYES] "+msg+"\r\n"))
	m.publish(id, endFrame{Done: true, ExitCode: 1})
}

func (m *Manager) publish(id string, body any) {
	if err := m.pub.Publish("terminal."+id, body); err != nil {
		m.log.Debug("terminal: falha ao publicar quadro", "session", id, "erro", err)
	}
}

func (m *Manager) get(id string) *session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *Manager) remove(id string) {
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
}

// Input repassa o texto digitado ao shell.
func (m *Manager) Input(id, data string) {
	if data == "" {
		return
	}
	if s := m.get(id); s != nil {
		s.write([]byte(data))
	}
}

// Resize muda o tamanho do terminal. Se a sessao ainda nao existe (o resize inicial pode chegar
// antes do start, porque os comandos sao despachados em paralelo), o tamanho fica guardado.
func (m *Manager) Resize(id string, cols, rows int) {
	if !validID(id) || cols <= 0 || rows <= 0 {
		return
	}
	cols, rows = clampDim(cols, defaultCols), clampDim(rows, defaultRows)
	m.mu.Lock()
	s := m.sessions[id]
	if s == nil {
		now := time.Now()
		for k, v := range m.pending {
			if now.Sub(v.at) > pendingTTL {
				delete(m.pending, k)
			}
		}
		if len(m.pending) < 4*m.MaxSessions {
			m.pending[id] = size{cols: cols, rows: rows, at: now}
		}
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	s.resize(cols, rows)
}

// Kill encerra a sessao (aba fechada ou navegador desconectado).
func (m *Manager) Kill(id string) {
	if !validID(id) {
		return
	}
	m.mu.Lock()
	delete(m.pending, id)
	s := m.sessions[id]
	if s == nil {
		now := time.Now()
		for k, at := range m.killed {
			if now.Sub(at) > pendingTTL {
				delete(m.killed, k)
			}
		}
		if len(m.killed) < 4*m.MaxSessions {
			m.killed[id] = now
		}
	}
	m.mu.Unlock()
	if s != nil {
		s.terminate("")
	}
}

// Count devolve o numero de sessoes ativas.
func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

// Shutdown encerra todas as sessoes e espera (ate 10 s) a publicacao dos quadros de fim.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	list := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, s)
	}
	m.mu.Unlock()
	for _, s := range list {
		s.terminate("o agente EYES esta parando")
	}
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
	}
}

// session e um terminal aberto.
type session struct {
	id string
	m  *Manager

	mu         sync.Mutex
	c          console // nil enquanto o shell abre
	cols, rows int
	note       string // aviso mostrado antes do fim (inatividade, tempo maximo...)
	killed     bool
	closed     bool
	idle, life *time.Timer

	input    chan []byte
	stop     chan struct{} // fechado quando o envio termina
	exited   chan struct{}
	exitCode int
}

// run liga o console a sessao e inicia as rotinas de leitura, escrita, espera e envio.
func (s *session) run(c console, cols, rows int) {
	m := s.m
	s.mu.Lock()
	s.c = c
	killed := s.killed
	resize := s.cols != cols || s.rows != rows
	cols, rows = s.cols, s.rows
	s.idle = time.AfterFunc(m.IdleTimeout, func() {
		s.terminate(fmt.Sprintf("sessao encerrada por inatividade (%s sem entrada)", m.IdleTimeout))
	})
	s.life = time.AfterFunc(m.MaxLifetime, func() {
		s.terminate(fmt.Sprintf("sessao encerrada: tempo maximo de %s atingido", m.MaxLifetime))
	})
	s.mu.Unlock()
	if killed {
		// terminal_kill chegou enquanto o shell abria.
		c.Kill()
	} else if resize {
		// terminal_resize chegou enquanto o shell abria.
		_ = c.Resize(cols, rows)
	}

	out := make(chan []byte)
	m.wg.Add(4)
	go func() { defer m.wg.Done(); s.readLoop(out) }()
	go func() { defer m.wg.Done(); s.writeLoop() }()
	go func() {
		defer m.wg.Done()
		s.exitCode = c.Wait()
		close(s.exited)
		// Da tempo para a saida final chegar e fecha o PTY, o que destrava a leitura.
		time.Sleep(drainGrace)
		c.CloseOutput()
	}()
	go func() { defer m.wg.Done(); s.pump(out) }()
}

func (s *session) readLoop(out chan<- []byte) {
	defer close(out)
	buf := make([]byte, s.m.MaxFrame)
	for {
		n, err := s.c.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			select {
			case out <- chunk:
			case <-s.stop:
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *session) writeLoop() {
	for data := range s.input {
		if _, err := s.c.Write(data); err != nil {
			s.m.log.Debug("terminal: falha ao escrever no shell", "session", s.id, "erro", err)
		}
	}
}

// write enfileira a entrada e renova o prazo de inatividade.
func (s *session) write(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.idle != nil {
		s.idle.Reset(s.m.IdleTimeout)
	}
	select {
	case s.input <- data:
	default:
		s.m.log.Warn("terminal: entrada descartada, o shell nao esta lendo", "session", s.id)
	}
}

func (s *session) resize(cols, rows int) {
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	c, closed := s.c, s.closed
	s.mu.Unlock()
	if c == nil || closed {
		// Ainda abrindo: run aplica o tamanho guardado depois de abrir.
		return
	}
	if err := c.Resize(cols, rows); err != nil {
		s.m.log.Debug("terminal: falha ao redimensionar", "session", s.id, "erro", err)
	}
}

// terminate encerra o shell; o fim da sessao segue pelo caminho normal (Wait, leitura, quadro de fim).
func (s *session) terminate(note string) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	if note != "" && s.note == "" {
		s.note = note
	}
	s.killed = true
	c := s.c
	s.mu.Unlock()
	if c != nil {
		c.Kill()
	}
}

// pump agrupa a saida em quadros de ate MaxFrame bytes, no maximo um por FlushInterval, e publica
// o quadro de fim depois de toda a saida. Com o buffer cheio, a leitura para ate o proximo envio:
// o shell fica bloqueado como num terminal lento, sem inundar o NATS.
func (s *session) pump(out <-chan []byte) {
	m := s.m
	var buf []byte
	in := out
	var timer *time.Timer
	var tick <-chan time.Time
	var abandon <-chan time.Time
	exited := s.exited

	flush := func(all bool) {
		for len(buf) > 0 {
			n := min(len(buf), m.MaxFrame)
			frame := make([]byte, n)
			copy(frame, buf[:n])
			buf = buf[n:]
			m.publish(s.id, frame)
			if !all {
				break
			}
		}
		if len(buf) == 0 {
			buf = nil
		}
	}

loop:
	for {
		select {
		case chunk, ok := <-in:
			if !ok {
				break loop
			}
			buf = append(buf, chunk...)
			if tick == nil {
				timer = time.NewTimer(m.FlushInterval)
				tick = timer.C
			}
			if len(buf) >= m.MaxFrame {
				in = nil
			}
		case <-tick:
			flush(false)
			in = out
			if len(buf) >= m.MaxFrame {
				in = nil
			}
			if len(buf) > 0 {
				timer.Reset(m.FlushInterval)
			} else {
				tick = nil
			}
		case <-exited:
			// O shell terminou; se a leitura nao acabar (neto segurando o PTY), publica o fim mesmo assim.
			exited = nil
			abandon = time.After(drainGrace + readerGrace)
		case <-abandon:
			m.log.Warn("terminal: leitura do PTY nao terminou depois do fim do shell", "session", s.id)
			// Recolhe o que ja chegou sem bloquear.
		drain:
			for {
				select {
				case chunk, ok := <-out:
					if !ok {
						break drain
					}
					buf = append(buf, chunk...)
				default:
					break drain
				}
			}
			break loop
		}
	}
	if timer != nil {
		timer.Stop()
	}
	close(s.stop)

	// Sem saida: espera o shell terminar (ou o encerra, se a saida fechou com ele vivo).
	select {
	case <-s.exited:
	case <-time.After(readerGrace):
		s.c.Kill()
		<-s.exited
	}

	s.mu.Lock()
	s.closed = true
	note := s.note
	if s.idle != nil {
		s.idle.Stop()
	}
	if s.life != nil {
		s.life.Stop()
	}
	close(s.input)
	s.mu.Unlock()

	if note != "" {
		buf = append(buf, []byte("\r\n[EYES] "+note+"\r\n")...)
	}
	flush(true)
	m.publish(s.id, endFrame{Done: true, ExitCode: s.exitCode})
	m.remove(s.id)
	s.c.Close()
	m.log.Info("terminal encerrado", "session", s.id, "exit_code", s.exitCode)
}

// errUnsupportedShell e devolvido para shells fora da lista aceita pelo console.
var errUnsupportedShell = errors.New("shell nao suportado")

func unsupported(shell string) error {
	return fmt.Errorf("%w: %s", errUnsupportedShell, strconv.Quote(shell))
}
