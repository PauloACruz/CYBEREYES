// Package webcam entrega a imagem da camera ao console pelo mesmo caminho do terminal remoto
// (contrato, secao 4.6): o servidor manda webcam_start e webcam_stop por publish (sem reply) e o
// agente devolve os quadros em <agent_id>.webcam.<session_id>.
//
// Quadros publicados:
//   - imagem: valor msgpack de topo "bin" com o JPEG da camera (o servidor repassa em base64 sem
//     reencodar);
//   - fim: mapa { done: true, error?: string } quando a sessao termina (encerrada pelo tecnico,
//     erro na camera, tempo limite ou agente parando).
//
// So Windows abre a camera; outros sistemas respondem com erro de "sem suporte".
package webcam

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Limites padrao das sessoes.
const (
	// DefaultIdleTimeout encerra a sessao quando o tecnico fica esse tempo sem renovar o visualizador
	// (webcam_start reenviado como ping). Protege contra console travado deixando a camera ligada.
	DefaultIdleTimeout = 2 * time.Minute
	// DefaultMaxLifetime encerra a sessao depois desse tempo, mesmo com o tecnico olhando.
	DefaultMaxLifetime = 60 * time.Minute
	// DefaultFPS e o alvo de quadros por segundo. 10 fps a 640x480 JPEG q75 fica em torno de 300 KB/s.
	DefaultFPS = 10
	// DefaultWidth e DefaultHeight sao a resolucao pedida a camera. A mais proxima suportada vale.
	DefaultWidth  = 640
	DefaultHeight = 480
	// DefaultQuality e a qualidade JPEG (0-100).
	DefaultQuality = 75
)

// endFrame e o mapa de fim de sessao.
type endFrame struct {
	Done  bool   `json:"done"`
	Error string `json:"error,omitempty"`
}

// publisher e a parte do env.Publisher usada aqui.
type publisher interface {
	Publish(suffix string, body any) error
}

// Camera e a captura da webcam. Cada implementacao de plataforma devolve um JPEG por quadro.
type Camera interface {
	// NextFrame devolve o proximo JPEG da camera (bloqueia ate o quadro chegar) ou erro.
	NextFrame() ([]byte, error)
	// Close libera o dispositivo.
	Close()
}

// Options configura a abertura da camera.
type Options struct {
	Width, Height, FPS, Quality int
}

// openFunc abre a camera; trocada nos testes.
type openFunc func(opts Options) (Camera, error)

// Manager guarda a sessao ativa (a camera e um recurso unico).
type Manager struct {
	pub  publisher
	log  *slog.Logger
	open openFunc

	IdleTimeout time.Duration
	MaxLifetime time.Duration
	FPS         int
	Width       int
	Height      int
	Quality     int

	mu      sync.Mutex
	current *session
	wg      sync.WaitGroup
}

// NewManager cria o gerenciador com os limites padrao.
func NewManager(pub publisher, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{
		pub:         pub,
		log:         log,
		open:        openCamera,
		IdleTimeout: DefaultIdleTimeout,
		MaxLifetime: DefaultMaxLifetime,
		FPS:         DefaultFPS,
		Width:       DefaultWidth,
		Height:      DefaultHeight,
		Quality:     DefaultQuality,
	}
}

// Register registra os comandos da webcam e encerra a sessao quando o agente para.
func Register(e *env.Env) error {
	m := NewManager(e.Pub, e.Log)
	m.register(e.Reg)
	e.Go("webcam-shutdown", func(ctx context.Context) {
		<-ctx.Done()
		m.Shutdown()
	})
	return nil
}

func (m *Manager) register(reg *rpc.Registry) {
	reg.HandleTimeout("webcam_start", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		m.Start(req.Payload().Str("session_id"))
		return nil
	})
	reg.HandleTimeout("webcam_stop", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		m.Stop(req.Payload().Str("session_id"))
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

// Start abre a camera. webcam_start reenviado com o mesmo session_id renova o prazo de inatividade
// (o visualizador no console manda a cada minuto como ping).
func (m *Manager) Start(id string) {
	if !validID(id) {
		m.log.Warn("webcam: id de sessao invalido", "session", id)
		return
	}
	m.mu.Lock()
	if m.current != nil {
		if m.current.id == id {
			m.current.ping()
			m.mu.Unlock()
			return
		}
		other := m.current
		m.mu.Unlock()
		other.terminate("outro visualizador assumiu a camera")
		m.mu.Lock()
	}
	s := &session{id: id, m: m, stop: make(chan struct{})}
	m.current = s
	m.mu.Unlock()

	cam, err := m.open(Options{Width: m.Width, Height: m.Height, FPS: m.FPS, Quality: m.Quality})
	if err != nil {
		m.remove(s)
		m.log.Warn("webcam: falha ao abrir a camera", "session", id, "erro", err)
		m.publish(id, endFrame{Done: true, Error: err.Error()})
		return
	}
	m.log.Info("webcam aberta", "session", id, "largura", m.Width, "altura", m.Height, "fps", m.FPS)
	s.run(cam)
}

// Stop encerra a sessao se ela existe (visualizador fechou a janela ou perdeu a conexao).
func (m *Manager) Stop(id string) {
	if !validID(id) {
		return
	}
	m.mu.Lock()
	s := m.current
	if s == nil || s.id != id {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	s.terminate("")
}

// Active devolve o id da sessao em curso ou vazio.
func (m *Manager) Active() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil {
		return ""
	}
	return m.current.id
}

// Shutdown encerra a sessao e espera (ate 5 s) o quadro de fim publicar.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	s := m.current
	m.mu.Unlock()
	if s != nil {
		s.terminate("o agente EYES esta parando")
	}
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

func (m *Manager) remove(s *session) {
	m.mu.Lock()
	if m.current == s {
		m.current = nil
	}
	m.mu.Unlock()
}

func (m *Manager) publish(id string, body any) {
	if err := m.pub.Publish("webcam."+id, body); err != nil {
		m.log.Debug("webcam: falha ao publicar quadro", "session", id, "erro", err)
	}
}

// session e uma captura em andamento.
type session struct {
	id string
	m  *Manager

	mu         sync.Mutex
	note       string // mensagem antes do fim (inatividade, tempo maximo, erro da camera)
	closed     bool
	idle, life *time.Timer
	stop       chan struct{}
}

// run inicia o laco de captura e publicacao. Fica no mesmo goroutine que entrou em Start, para que
// webcam_start retorne ao servidor so quando a camera abriu de fato.
func (s *session) run(cam Camera) {
	m := s.m
	s.mu.Lock()
	s.idle = time.AfterFunc(m.IdleTimeout, func() {
		s.terminate(fmt.Sprintf("sessao encerrada por inatividade (%s sem ping do visualizador)", m.IdleTimeout))
	})
	s.life = time.AfterFunc(m.MaxLifetime, func() {
		s.terminate(fmt.Sprintf("sessao encerrada: tempo maximo de %s atingido", m.MaxLifetime))
	})
	s.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		s.pump(cam)
	}()
}

// ping renova o prazo de inatividade (webcam_start reenviado com o mesmo id).
func (s *session) ping() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.idle == nil {
		return
	}
	s.idle.Reset(s.m.IdleTimeout)
}

// terminate marca a sessao para encerrar; pump reage no proximo ciclo.
func (s *session) terminate(note string) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	if note != "" && s.note == "" {
		s.note = note
	}
	s.closed = true
	close(s.stop)
	s.mu.Unlock()
}

// pump captura e publica os quadros ate a sessao encerrar.
func (s *session) pump(cam Camera) {
	defer s.m.remove(s)
	m := s.m
	frames := make(chan []byte)
	errs := make(chan error, 1)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			jpeg, err := cam.NextFrame()
			if err != nil {
				errs <- err
				return
			}
			select {
			case frames <- jpeg:
			case <-s.stop:
				return
			}
		}
	}()

	var lastErr error
loop:
	for {
		select {
		case jpeg := <-frames:
			if err := m.pub.Publish("webcam."+s.id, jpeg); err != nil {
				m.log.Debug("webcam: falha ao publicar quadro", "session", s.id, "erro", err)
			}
		case err := <-errs:
			lastErr = err
			break loop
		case <-s.stop:
			break loop
		}
	}

	// Fecha a camera para destravar o leitor em NextFrame (fechamento e seguro em paralelo com
	// leituras nas duas implementacoes).
	cam.Close()
	select {
	case <-readerDone:
	case <-time.After(2 * time.Second):
		m.log.Warn("webcam: leitor da camera nao terminou a tempo", "session", s.id)
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
	s.mu.Unlock()

	msg := note
	if msg == "" && lastErr != nil && !errors.Is(lastErr, errSessionStopped) {
		msg = "falha na camera: " + lastErr.Error()
	}
	m.publish(s.id, endFrame{Done: true, Error: msg})
	m.log.Info("webcam encerrada", "session", s.id, "motivo", msg)
}

// errSessionStopped sinaliza que o leitor saiu porque a sessao foi encerrada, nao por falha.
var errSessionStopped = errors.New("sessao encerrada")

// errUnsupported e devolvido onde a plataforma nao tem camera.
var errUnsupported = errors.New("captura de webcam so e suportada no Windows")
