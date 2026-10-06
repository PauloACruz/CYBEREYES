package remote

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"slices"
	"time"

	"github.com/coder/websocket"

	"github.com/pauloacruz/cybereyes/agent/internal/remote/capture"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/encode"
	"github.com/pauloacruz/cybereyes/agent/internal/remote/proto"
)

// Ritmo da tela (contrato, secao 5.3).
const (
	// refineQuality e a qualidade do refinamento: com a tela parada por refineDelay, os blocos enviados com perda
	// voltam nitidos, refineTiles blocos por vez (um quadro novo nao espera um refinamento grande).
	refineQuality = 90
	refineDelay   = 400 * time.Millisecond
	refineTiles   = 96
	// idleAfter sem mudanca nem entrada do tecnico: a captura por leitura da tela (GDI, X11) cai para idleInterval.
	idleAfter    = 2 * time.Second
	idleInterval = 250 * time.Millisecond
	// cursorInterval e o intervalo de acompanhamento do cursor entre capturas.
	cursorInterval = 33 * time.Millisecond
	// displayCheckInterval e o intervalo para reler os monitores (resolucao ou monitor trocados).
	displayCheckInterval = 3 * time.Second
)

// Controle de fluxo (contrato, secao 5.3).
const (
	// Quadros sem ACK: pelo menos 2, no maximo 12, o bastante para cobrir a ida e volta no ritmo pedido.
	minWindowFrames = 2
	maxWindowFrames = 12
	// Bytes sem ACK: windowGain vezes o produto banda x ida e volta minima, entre minWindowBytes e
	// maxInflightBytes. Sem banda medida ainda, vale so o maximo.
	minWindowBytes   = 128 << 10
	maxInflightBytes = 4 << 20
	windowGain       = 2
	// queueHigh e queueLow sao a fila (ida e volta menos a minima) que baixa ou permite subir a qualidade.
	queueHigh = 300 * time.Millisecond
	queueLow  = 100 * time.Millisecond
)

type inflightFrame struct {
	size        int
	sent        time.Time
	delivered   int64     // bytes confirmados ate o envio
	deliveredAt time.Time // ultima confirmacao antes do envio (ou o envio, com a janela vazia)
}

// windowed guarda o minimo ou o maximo das amostras recentes, em 4 baldes de span cada.
type windowed struct {
	span    time.Duration
	keepMax bool
	buckets [4]struct {
		v     float64
		start time.Time
		set   bool
	}
}

func (w *windowed) better(a, b float64) bool {
	if w.keepMax {
		return a > b
	}
	return a < b
}

func (w *windowed) add(v float64, now time.Time) {
	cur := &w.buckets[0]
	if !cur.set || now.Sub(cur.start) >= w.span {
		copy(w.buckets[1:], w.buckets[:len(w.buckets)-1])
		w.buckets[0].v, w.buckets[0].start, w.buckets[0].set = v, now, true
		return
	}
	if w.better(v, cur.v) {
		cur.v = v
	}
}

func (w *windowed) get(now time.Time) (float64, bool) {
	var best float64
	found := false
	for _, b := range w.buckets {
		if !b.set || now.Sub(b.start) >= w.span*time.Duration(len(w.buckets)) {
			continue
		}
		if !found || w.better(b.v, best) {
			best, found = b.v, true
		}
	}
	return best, found
}

// flowControl limita o que fica sem ACK (quadros e bytes) pela ida e volta minima e pela banda medida nas
// confirmacoes, como o BBR: o bastante para a rede nao ficar ociosa, sem formar fila. A qualidade cai quando a fila
// cresce ou quando a janela segura quadros, e sobe devagar quando sobra folga.
type flowControl struct {
	inflight    map[uint32]inflightFrame
	bytes       int
	delivered   int64
	deliveredAt time.Time
	rtt         windowed // minimo da ida e volta (segundos), cerca de 40 s
	rate        windowed // maximo da taxa de entrega (bytes/s), cerca de 10 s
	srtt        time.Duration
	limited     bool      // a janela segurou um quadro desde o ultimo ajuste de qualidade
	adjusted    time.Time // ultimo ajuste de qualidade
}

func newFlowControl() flowControl {
	return flowControl{
		inflight: map[uint32]inflightFrame{},
		rtt:      windowed{span: 10 * time.Second},
		rate:     windowed{span: 2500 * time.Millisecond, keepMax: true},
	}
}

func (f *flowControl) minRTT(now time.Time) time.Duration {
	v, ok := f.rtt.get(now)
	if !ok {
		return 0
	}
	return time.Duration(v * float64(time.Second))
}

// bandwidth devolve a taxa de entrega estimada em bytes/s (0 sem medida).
func (f *flowControl) bandwidth(now time.Time) float64 {
	v, _ := f.rate.get(now)
	return v
}

// window devolve quantos quadros podem ficar sem ACK no intervalo de quadros pedido.
func (f *flowControl) window(interval time.Duration, now time.Time) int {
	base := f.minRTT(now)
	if base <= 0 {
		base = 300 * time.Millisecond
	}
	n := int(base/max(interval, time.Millisecond)) + 2
	return max(minWindowFrames, min(maxWindowFrames, n))
}

// byteWindow devolve o limite de bytes sem ACK.
func (f *flowControl) byteWindow(now time.Time) int {
	bw, rtt := f.bandwidth(now), f.minRTT(now)
	if bw <= 0 || rtt <= 0 {
		return maxInflightBytes
	}
	return max(minWindowBytes, min(maxInflightBytes, int(bw*rtt.Seconds()*windowGain)))
}

func (f *flowControl) full(interval time.Duration, now time.Time) bool {
	return len(f.inflight) >= f.window(interval, now) || f.bytes >= f.byteWindow(now)
}

func (f *flowControl) empty() bool { return len(f.inflight) == 0 }

func (f *flowControl) sent(id uint32, size int, at time.Time) {
	if len(f.inflight) == 0 || f.deliveredAt.IsZero() {
		// Janela vazia: a taxa deste quadro conta a partir do envio, nao da ultima confirmacao antiga.
		f.deliveredAt = at
	}
	f.inflight[id] = inflightFrame{size: size, sent: at, delivered: f.delivered, deliveredAt: f.deliveredAt}
	f.bytes += size
}

// acked registra o ACK (taxa de entrega, ida e volta) e devolve o ajuste de qualidade: -10, -5, 0 ou +5.
func (f *flowControl) acked(id uint32, now time.Time) (int, bool) {
	fr, ok := f.inflight[id]
	if !ok {
		return 0, false
	}
	delete(f.inflight, id)
	f.bytes -= fr.size
	f.delivered += int64(fr.size)
	if elapsed := now.Sub(fr.deliveredAt); elapsed > 0 {
		f.rate.add(float64(f.delivered-fr.delivered)/elapsed.Seconds(), now)
	}
	f.deliveredAt = now
	rtt := now.Sub(fr.sent)
	f.rtt.add(rtt.Seconds(), now)
	if f.srtt == 0 {
		f.srtt = rtt
	} else {
		f.srtt = (7*f.srtt + rtt) / 8
	}
	queue := rtt - f.minRTT(now)
	since := now.Sub(f.adjusted)
	switch {
	case queue > queueHigh && since > 250*time.Millisecond:
		f.adjusted, f.limited = now, false
		return -10, true
	case f.limited && since > 500*time.Millisecond:
		f.adjusted, f.limited = now, false
		return -5, true
	case !f.limited && queue < queueLow && since > time.Second:
		f.adjusted = now
		return 5, true
	}
	return 0, true
}

// ack libera a janela e ajusta a qualidade pela fila medida.
func (s *desktopSession) ack(id uint32) {
	s.mu.Lock()
	if delta, ok := s.flow.acked(id, time.Now()); ok && delta != 0 {
		s.quality = max(minQuality, min(s.settings.Quality, s.quality+delta))
	}
	s.mu.Unlock()
	s.poke()
}

// frameStats resume o desempenho no log a cada minuto (captura, codificacao, envio e metodo de captura).
type frameStats struct {
	since                        time.Time
	frames, refines, polls, held int
	bytes                        int
	grab, encode                 time.Duration
}

func (st *frameStats) log(s *desktopSession, now time.Time) {
	if st.since.IsZero() {
		st.since = now
		return
	}
	if now.Sub(st.since) < time.Minute {
		return
	}
	s.mu.Lock()
	q, srtt, minRTT, bw := s.quality, s.flow.srtt, s.flow.minRTT(now), s.flow.bandwidth(now)
	s.mu.Unlock()
	avg := func(d time.Duration, n int) string {
		if n == 0 {
			return "-"
		}
		return (d / time.Duration(n)).Round(100 * time.Microsecond).String()
	}
	s.log.Info("desempenho da tela", "metodo", s.grabber.Backend(), "capturas", st.polls, "quadros", st.frames, "refinamentos", st.refines,
		"kib", st.bytes/1024, "captura_media", avg(st.grab, st.polls), "codificacao_media", avg(st.encode, max(1, st.frames+st.refines)),
		"segurados", st.held, "qualidade", q, "rtt", srtt.Round(time.Millisecond).String(), "rtt_min", minRTT.Round(time.Millisecond).String(),
		"banda_kib_s", int(bw/1024))
	*st = frameStats{since: now}
}

// frameLoop captura, codifica e envia quadros no ritmo pedido, respeitando a janela de quadros sem ACK.
func (s *desktopSession) frameLoop(ctx context.Context) error {
	enc := &encode.Encoder{}
	var frame capture.Frame
	var lastDisplay capture.Display
	var lastScale float64
	var lastCursorMode bool
	var lastStart, lastChange, lastPointer, heldDue time.Time
	lastDisplayCheck := time.Now()
	for {
		now := time.Now()
		if now.Sub(lastDisplayCheck) >= displayCheckInterval {
			lastDisplayCheck = now
			if _, err := s.refreshDisplays(ctx); err != nil {
				return err
			}
		}
		s.mu.Lock()
		fps, scale, display, sepCursor := s.settings.MaxFPS, s.settings.Scale, s.display, s.settings.Cursor
		interval := time.Second / time.Duration(max(1, fps))
		full := s.flow.full(interval, now)
		lastInput := s.lastInput
		s.mu.Unlock()

		period := interval
		if s.grabber.Polling() && now.Sub(lastChange) > idleAfter && now.Sub(lastInput) > idleAfter {
			period = max(interval, idleInterval)
		}
		due := lastStart.Add(period)
		if full && !now.Before(due) && due != heldDue {
			// A janela segurou um quadro: a qualidade cai no proximo ACK.
			heldDue = due
			s.mu.Lock()
			s.flow.limited = true
			s.mu.Unlock()
			s.stats.held++
		}
		if full || now.Before(due) {
			// Espera o proximo quadro, um ACK (janela cheia) ou um evento; o cursor separado e acompanhado no meio.
			wait := time.Second
			if !full {
				wait = due.Sub(now)
			}
			if sepCursor {
				wait = min(wait, cursorInterval)
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(max(wait, time.Millisecond)):
			case <-s.wake:
			}
			if sepCursor && time.Since(lastPointer) >= cursorInterval {
				lastPointer = time.Now()
				if c, err := s.grabber.Pointer(display); err == nil {
					if err := s.sendCursor(ctx, c, display, scale); err != nil {
						return err
					}
				}
			}
			continue
		}

		lastStart = now
		s.mu.Lock()
		reset := s.reset
		s.reset = false
		quality := s.quality
		s.mu.Unlock()
		if reset || display != lastDisplay || scale != lastScale || sepCursor != lastCursorMode {
			enc.Reset()
			lastDisplay, lastScale, lastCursorMode = display, scale, sepCursor
		}
		t0 := time.Now()
		if err := s.grabber.Grab(display, &frame, sepCursor); err != nil {
			if err := s.captureFailed(ctx, err); err != nil {
				return err
			}
			continue
		}
		s.stats.polls++
		s.stats.grab += time.Since(t0)
		if sepCursor {
			lastPointer = time.Now()
			if err := s.sendCursor(ctx, frame.Cursor, display, scale); err != nil {
				return err
			}
		}
		sent := false
		if frame.Img != nil && (frame.Changed || reset) {
			t1 := time.Now()
			img := enc.Scale(frame.Img, scale)
			hint := frame.Dirty
			if scale < 1 {
				// As regioes estao na escala original: compara a imagem toda (barato perto da codificacao).
				hint = nil
			}
			tiles, err := enc.Encode(img, quality, hint)
			if err != nil {
				return err
			}
			if len(tiles) > 0 {
				s.stats.encode += time.Since(t1)
				s.stats.frames++
				if err := s.sendTiles(ctx, tiles, img.Bounds()); err != nil {
					return err
				}
				lastChange, sent = now, true
			}
		}
		if !sent && now.Sub(lastChange) > refineDelay && quality < refineQuality {
			s.mu.Lock()
			idle := s.flow.empty()
			s.mu.Unlock()
			if idle && enc.NeedsRefine(refineQuality) {
				t1 := time.Now()
				tiles, err := enc.Refine(refineQuality, refineTiles)
				if err != nil {
					return err
				}
				if len(tiles) > 0 {
					s.stats.encode += time.Since(t1)
					s.stats.refines++
					if err := s.sendTiles(ctx, tiles, enc.Bounds()); err != nil {
						return err
					}
				}
			}
		}
		s.stats.log(s, now)
	}
}

// captureFailed trata a falha da captura: a tela pode ter mudado (resolucao, monitor removido); rele os monitores e
// avisa o visualizador. Sem mudanca, espera um pouco e tenta de novo.
func (s *desktopSession) captureFailed(ctx context.Context, err error) error {
	if changed, err := s.refreshDisplays(ctx); changed || err != nil {
		return err
	}
	s.log.Debug("captura falhou", "erro", err)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(250 * time.Millisecond):
		return nil
	}
}

// refreshDisplays rele os monitores; quando mudaram (resolucao, monitor ligado ou desligado), avisa o visualizador
// com o DISPLAYS e recomeca a imagem. So devolve erro do envio.
func (s *desktopSession) refreshDisplays(ctx context.Context) (bool, error) {
	ds, err := s.screen.Displays()
	if err != nil {
		return false, nil
	}
	s.mu.Lock()
	if slices.Equal(ds, s.displays) {
		s.mu.Unlock()
		return false, nil
	}
	s.displays = ds
	s.display = capture.Find(ds, s.settings.Display)
	s.reset = true
	msg := displaysBody{Displays: toProto(ds), Active: s.display.ID}
	s.mu.Unlock()
	return true, sendJSON(ctx, s.conn, proto.Displays, msg)
}

// sendTiles envia os blocos e o FRAME_END, e registra o quadro na janela de controle de fluxo.
func (s *desktopSession) sendTiles(ctx context.Context, tiles []encode.Tile, bounds image.Rectangle) error {
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
	s.mu.Lock()
	s.flow.sent(id, size, time.Now())
	s.mu.Unlock()
	s.stats.bytes += size
	return s.conn.Write(ctx, websocket.MessageBinary, proto.FrameEndFrame(id, len(tiles), bounds.Dx(), bounds.Dy()))
}

// sendCursor manda o CURSOR quando a posicao, a visibilidade ou o desenho mudam.
func (s *desktopSession) sendCursor(ctx context.Context, c capture.Cursor, d capture.Display, scale float64) error {
	body, err := s.cursorUpdate(c, d, scale)
	if err != nil || body == nil {
		return err
	}
	return sendJSON(ctx, s.conn, proto.Cursor, body)
}

// cursorUpdate devolve o CURSOR a enviar, ou nil sem mudanca. O PNG vai so na primeira vez de cada desenho; depois
// o visualizador reaproveita pelo id.
func (s *desktopSession) cursorUpdate(c capture.Cursor, d capture.Display, scale float64) (*proto.CursorBody, error) {
	if scale <= 0 || scale > 1 {
		scale = 1
	}
	if c.X < 0 || c.Y < 0 || c.X >= d.W || c.Y >= d.H {
		// Ponteiro em outro monitor.
		c.Visible = false
	}
	body := proto.CursorBody{Visible: c.Visible, X: int(float64(c.X) * scale), Y: int(float64(c.Y) * scale)}
	if c.Shape != nil {
		body.ID, body.HotX, body.HotY = c.Shape.ID, c.Shape.HotX, c.Shape.HotY
	}
	last := s.cursorSent
	if s.cursorKnown && last.Visible == body.Visible && (!body.Visible || (last.X == body.X && last.Y == body.Y && last.ID == body.ID)) {
		return nil, nil
	}
	if c.Shape != nil && !s.cursorShapes[c.Shape.ID] {
		var buf bytes.Buffer
		if err := png.Encode(&buf, c.Shape.Img); err != nil {
			return nil, fmt.Errorf("cursor: %w", err)
		}
		b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
		body.PNG = &b64
		s.cursorShapes[c.Shape.ID] = true
	}
	s.cursorSent, s.cursorKnown = body, true
	s.cursorSent.PNG = nil
	return &body, nil
}
