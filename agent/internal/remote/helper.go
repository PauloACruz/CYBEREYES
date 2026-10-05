package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/capture"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/encode"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/input"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// HelperParams chega ao "eyes remote-helper" pela entrada padrao (nunca pela linha de comando, que outros usuarios veem).
type HelperParams struct {
	SessionID  string `json:"session_id"`
	RelayURL   string `json:"relay_url"`
	Token      string `json:"token"`
	AgentToken string `json:"agent_token"`
	ViewOnly   bool   `json:"view_only"`
	Policy     Policy `json:"policy"`
	Insecure   bool   `json:"insecure,omitempty"`
	Proxy      string `json:"proxy,omitempty"`
}

// Control e uma linha JSON do servico para o remote-helper, depois dos parametros: resultado do pedido de acesso
// ("accepted", "denied" ou "timeout") ou fim pedido pelo usuario no eyes-tray (End = "user").
type Control struct {
	Consent string `json:"consent,omitempty"`
	End     string `json:"end,omitempty"`
}

// Limites do controle de fluxo (contrato, secao 5.3).
const (
	maxInflightFrames = 2
	maxInflightBytes  = 4 << 20
	defaultQuality    = 60
	defaultFPS        = 15
	minQuality        = 25
)

// desktopSession e o estado de uma sessao de tela no remote-helper.
type desktopSession struct {
	conn   *websocket.Conn
	screen capture.Screen
	input  *input.Tracker
	log    *slog.Logger
	params HelperParams
	clip   clipboardSync

	mu       sync.Mutex
	settings proto.SettingsBody
	displays []capture.Display
	display  capture.Display
	quality  int
	reset    bool
	inflight map[uint32]inflightFrame
	bytes    int
	seq      uint32
	wake     chan struct{}
}

type inflightFrame struct {
	size int
	sent time.Time
}

// RunHelper executa uma sessao de tela ate o relay fechar, ctx terminar ou o servico mandar o fim.
func RunHelper(ctx context.Context, p HelperParams, control <-chan Control, log *slog.Logger) error {
	conn, err := dialRelay(ctx, p, "desktop")
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
	if p.Policy.Consent == "ask" {
		if ok, err := waitConsent(ctx, conn, control); !ok {
			return err
		}
	}

	screen, err := capture.Open()
	if err != nil {
		sendJSON(ctx, conn, proto.Error, proto.ErrorBody{Code: "unsupported", Message: err.Error()})
		sendJSON(ctx, conn, proto.Bye, proto.ReasonBody{Reason: "unsupported"})
		return err
	}
	defer screen.Close()
	s := &desktopSession{conn: conn, screen: screen, log: log, params: p, quality: defaultQuality, inflight: map[uint32]inflightFrame{}, wake: make(chan struct{}, 1)}
	s.settings = proto.SettingsBody{Quality: defaultQuality, Scale: 1, MaxFPS: defaultFPS}
	if !p.ViewOnly {
		if in, err := input.Open(); err != nil {
			log.Warn("entrada remota indisponivel; sessao so de visualizacao", "erro", err)
		} else {
			s.input = input.Track(in)
			defer func() {
				s.input.ReleaseAll()
				s.input.Close()
			}()
		}
	}
	if err := s.loadDisplays(); err != nil {
		return err
	}
	s.clip = newClipboardSync(ctx, s, p.Policy)
	defer s.clip.Close()
	if err := s.sendHello(ctx); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errc := make(chan error, 3)
	go func() { errc <- s.readLoop(ctx) }()
	go func() { errc <- s.frameLoop(ctx) }()
	go func() { errc <- watchEnd(ctx, conn, control) }()
	err = <-errc
	cancel()
	if websocket.CloseStatus(err) != -1 || errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

// waitConsent avisa o visualizador que o usuario esta decidindo e espera a resposta que o servico obteve do eyes-tray
// (contrato, secao 8.3). Sem aceite, manda o BYE com o motivo e devolve false.
func waitConsent(ctx context.Context, conn *websocket.Conn, control <-chan Control) (bool, error) {
	if err := sendJSON(ctx, conn, proto.Consent, proto.ConsentBody{State: "waiting"}); err != nil {
		return false, err
	}
	state := "denied"
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case c, ok := <-control:
		if ok && c.Consent != "" {
			state = c.Consent
		}
	}
	if err := sendJSON(ctx, conn, proto.Consent, proto.ConsentBody{State: state}); err != nil {
		return false, err
	}
	if state == "accepted" {
		return true, nil
	}
	reason := "consent-denied"
	if state == "timeout" {
		reason = "consent-timeout"
	}
	_ = sendJSON(ctx, conn, proto.Bye, proto.ReasonBody{Reason: reason})
	_ = conn.Close(websocket.StatusNormalClosure, reason)
	return false, nil
}

// watchEnd encerra a sessao quando o usuario pede o fim pelo eyes-tray.
func watchEnd(ctx context.Context, conn *websocket.Conn, control <-chan Control) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case c, ok := <-control:
			if !ok {
				// Sem canal de controle (entrada padrao fechada): segue ate o relay ou o servico encerrar.
				<-ctx.Done()
				return ctx.Err()
			}
			if c.End != "" {
				_ = sendJSON(ctx, conn, proto.Bye, proto.ReasonBody{Reason: c.End})
				_ = conn.Close(websocket.StatusNormalClosure, c.End)
				return context.Canceled
			}
		}
	}
}

func dialRelay(ctx context.Context, p HelperParams, channel string) (*websocket.Conn, error) {
	tr, err := api.NewTransport(api.Options{Insecure: p.Insecure, Proxy: p.Proxy})
	if err != nil {
		return nil, err
	}
	h := http.Header{}
	h.Set("Authorization", "Token "+p.AgentToken)
	dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dctx, p.RelayURL+"/"+channel, &websocket.DialOptions{HTTPClient: &http.Client{Transport: tr}, HTTPHeader: h})
	if err != nil {
		return nil, fmt.Errorf("conexao ao relay: %w", err)
	}
	conn.SetReadLimit(4 << 20)
	return conn, nil
}

func authenticate(ctx context.Context, conn *websocket.Conn, token string) error {
	if err := sendJSON(ctx, conn, proto.Auth, proto.AuthBody{Token: token, Role: "agent", Proto: proto.Version}); err != nil {
		return err
	}
	actx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, frame, err := conn.Read(actx)
	if err != nil {
		return fmt.Errorf("autenticacao no relay: %w", err)
	}
	if len(frame) == 0 || frame[0] != proto.AuthOK {
		return errors.New("autenticacao no relay recusada")
	}
	return nil
}

func waitPaired(ctx context.Context, conn *websocket.Conn) error {
	pctx, cancel := context.WithTimeout(ctx, 70*time.Second)
	defer cancel()
	for {
		_, frame, err := conn.Read(pctx)
		if err != nil {
			return fmt.Errorf("aguardando o visualizador: %w", err)
		}
		if len(frame) > 0 && frame[0] == proto.Paired {
			return nil
		}
	}
}

func sendJSON(ctx context.Context, conn *websocket.Conn, t byte, v any) error {
	frame, err := proto.JSON(t, v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageBinary, frame)
}

func (s *desktopSession) loadDisplays() error {
	ds, err := s.screen.Displays()
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.displays = ds
	s.display = capture.Find(ds, s.settings.Display)
	return nil
}

func toProto(ds []capture.Display) []proto.Display {
	out := make([]proto.Display, len(ds))
	for i, d := range ds {
		out[i] = proto.Display(d)
	}
	return out
}

func (s *desktopSession) sendHello(ctx context.Context) error {
	features := []string{"desktop", "view-only"}
	features = append(features, s.clip.Features()...)
	features = append(features, platformFeatures()...)
	s.mu.Lock()
	hello := proto.HelloBody{Proto: proto.Version, OS: runtime.GOOS, Displays: toProto(s.displays), Active: s.display.ID, Features: features, User: sessionUser()}
	s.mu.Unlock()
	return sendJSON(ctx, s.conn, proto.Hello, hello)
}

// readLoop trata os quadros do visualizador.
func (s *desktopSession) readLoop(ctx context.Context) error {
	for {
		_, frame, err := s.conn.Read(ctx)
		if err != nil {
			return err
		}
		if len(frame) == 0 {
			continue
		}
		if err := s.handle(ctx, frame); err != nil {
			s.log.Debug("quadro do visualizador ignorado", "tipo", frame[0], "erro", err)
		}
	}
}

func (s *desktopSession) handle(ctx context.Context, frame []byte) error {
	switch frame[0] {
	case proto.Ack:
		id, _, err := proto.ParseAck(frame)
		if err != nil {
			return err
		}
		s.ack(id)
	case proto.Settings:
		var st proto.SettingsBody
		if err := proto.Decode(frame, &st); err != nil {
			return err
		}
		s.applySettings(st)
	case proto.Refresh:
		s.mu.Lock()
		s.reset = true
		s.mu.Unlock()
		s.poke()
	case proto.PeerGone:
		return io.EOF
	case proto.Clipboard:
		// Somente visualizacao: nada do visualizador chega a estacao (contrato, secao 5.2).
		if s.params.ViewOnly {
			return nil
		}
		return s.clip.FromViewer(frame)
	default:
		return s.handleInput(frame)
	}
	return nil
}

func (s *desktopSession) handleInput(frame []byte) error {
	if s.input == nil || s.params.ViewOnly {
		return nil
	}
	s.mu.Lock()
	area := s.display.Rect()
	s.mu.Unlock()
	switch frame[0] {
	case proto.Key:
		var k proto.KeyBody
		if err := proto.Decode(frame, &k); err != nil {
			return err
		}
		return s.input.Key(k.Code, k.Down)
	case proto.Text:
		var t proto.TextBody
		if err := proto.Decode(frame, &t); err != nil {
			return err
		}
		return s.input.Text(t.Text)
	case proto.Mouse:
		var m proto.MouseBody
		if err := proto.Decode(frame, &m); err != nil {
			return err
		}
		return s.input.Mouse(area, m.X, m.Y, m.Buttons)
	case proto.Wheel:
		var w proto.WheelBody
		if err := proto.Decode(frame, &w); err != nil {
			return err
		}
		return s.input.Wheel(w.DX, w.DY)
	case proto.CAD:
		return secureAttention()
	}
	return nil
}

func (s *desktopSession) applySettings(st proto.SettingsBody) {
	st.Quality = max(1, min(100, st.Quality))
	st.Scale = max(0.25, min(1, st.Scale))
	st.MaxFPS = max(1, min(30, st.MaxFPS))
	s.mu.Lock()
	changed := st.Display != s.settings.Display || st.Scale != s.settings.Scale
	s.settings = st
	s.quality = st.Quality
	if changed {
		s.display = capture.Find(s.displays, st.Display)
		s.reset = true
	}
	s.mu.Unlock()
	s.poke()
}

func (s *desktopSession) poke() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// ack libera a janela e ajusta a qualidade pelo tempo de ida e volta.
func (s *desktopSession) ack(id uint32) {
	s.mu.Lock()
	f, ok := s.inflight[id]
	if ok {
		delete(s.inflight, id)
		s.bytes -= f.size
		rtt := time.Since(f.sent)
		switch {
		case rtt > 600*time.Millisecond && s.quality > minQuality:
			s.quality = max(minQuality, s.quality-10)
		case rtt < 200*time.Millisecond && s.quality < s.settings.Quality:
			s.quality = min(s.settings.Quality, s.quality+5)
		}
	}
	s.mu.Unlock()
	s.poke()
}

// frameLoop captura, codifica e envia quadros respeitando a janela de quadros sem ACK.
func (s *desktopSession) frameLoop(ctx context.Context) error {
	var enc encode.Encoder
	var lastDisplay capture.Display
	var lastScale float64
	for {
		s.mu.Lock()
		fps, quality, scale, display := s.settings.MaxFPS, s.quality, s.settings.Scale, s.display
		full := len(s.inflight) >= maxInflightFrames || s.bytes >= maxInflightBytes
		reset := s.reset
		s.reset = false
		s.mu.Unlock()
		if !full {
			if reset || display != lastDisplay || scale != lastScale {
				enc.Reset()
				lastDisplay, lastScale = display, scale
			}
			if err := s.sendFrame(ctx, &enc, display, scale, quality); err != nil {
				return err
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second / time.Duration(fps)):
		case <-s.wake:
		}
	}
}

func (s *desktopSession) sendFrame(ctx context.Context, enc *encode.Encoder, display capture.Display, scale float64, quality int) error {
	img, err := s.screen.Capture(display)
	if err != nil {
		// A tela pode mudar (resolucao, monitor removido): relê os monitores e avisa o visualizador.
		if lerr := s.loadDisplays(); lerr == nil {
			s.mu.Lock()
			msg := displaysBody{Displays: toProto(s.displays), Active: s.display.ID}
			s.reset = true
			s.mu.Unlock()
			return sendJSON(ctx, s.conn, proto.Displays, msg)
		}
		return fmt.Errorf("captura: %w", err)
	}
	frame := encode.Scale(img, scale)
	tiles, err := enc.Encode(frame, quality)
	if err != nil {
		return err
	}
	if len(tiles) == 0 {
		return nil
	}
	s.mu.Lock()
	s.seq++
	id := s.seq
	s.mu.Unlock()
	size := 0
	for _, t := range tiles {
		data := proto.TileFrame(id, t.X, t.Y, t.W, t.H, t.JPEG)
		size += len(data)
		if err := s.conn.Write(ctx, websocket.MessageBinary, data); err != nil {
			return err
		}
	}
	b := frame.Bounds()
	s.mu.Lock()
	s.inflight[id] = inflightFrame{size: size, sent: time.Now()}
	s.bytes += size
	s.mu.Unlock()
	return s.conn.Write(ctx, websocket.MessageBinary, proto.FrameEndFrame(id, len(tiles), b.Dx(), b.Dy()))
}

// displaysBody e o corpo do DISPLAYS.
type displaysBody struct {
	Displays []proto.Display `json:"displays"`
	Active   int             `json:"active"`
}

// Policy e a politica efetiva recebida no remote_start (contrato, secao 8.2).
type Policy struct {
	Consent               string `json:"consent"`
	ConsentTimeoutSeconds int    `json:"consentTimeoutSeconds"`
	AllowAtLoginScreen    bool   `json:"allowAtLoginScreen"`
	ClipboardToRemote     bool   `json:"clipboardToRemote"`
	ClipboardToLocal      bool   `json:"clipboardToLocal"`
	FilesUpload           bool   `json:"filesUpload"`
	FilesDownload         bool   `json:"filesDownload"`
	MaxFileMb             int    `json:"maxFileMb"`
	IdleMinutes           int    `json:"idleMinutes"`
	MaxHours              int    `json:"maxHours"`
}

// ParsePolicy le o texto JSON do campo policy; campos ausentes ficam nos padroes do contrato.
func ParsePolicy(raw string) (Policy, error) {
	p := Policy{Consent: "none", ConsentTimeoutSeconds: 60, AllowAtLoginScreen: true, ClipboardToRemote: true, ClipboardToLocal: true,
		FilesUpload: true, FilesDownload: true, MaxFileMb: 2048, IdleMinutes: 30, MaxHours: 8}
	if raw == "" {
		return p, nil
	}
	err := json.Unmarshal([]byte(raw), &p)
	return p, err
}

// HelperMain e o "eyes remote-helper": le os parametros da entrada padrao, depois as linhas de controle do servico,
// e roda a sessao de tela.
func HelperMain(stdin io.Reader) error {
	dec := json.NewDecoder(stdin)
	var p HelperParams
	if err := dec.Decode(&p); err != nil {
		return fmt.Errorf("parametros do remote-helper: %w", err)
	}
	control := make(chan Control, 4)
	go func() {
		defer close(control)
		for {
			var c Control
			if err := dec.Decode(&c); err != nil {
				return
			}
			control <- c
		}
	}()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return RunHelper(ctx, p, control, log)
}
