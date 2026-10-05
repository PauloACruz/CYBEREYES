package care

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// maxEvents e o limite de eventos por execucao no servidor (CareService.MaxEventsPerRun);
	// o servidor aceita seq ate maxEvents+10.
	maxEvents = 5000
	// softEvents: a partir daqui log, progress e result sao descartados, para sobrar seq aos
	// eventos task e ao done.
	softEvents = maxEvents - 100
	// maxLine limita uma linha de saida do modulo (eventos result grandes cabem com folga).
	maxLine = 8 << 20
	// maxMessage limita o texto de um evento log.
	maxMessage = 4000
)

// Status finais aceitos pelo servidor no evento done.
const (
	statusOK        = "ok"
	statusWarning   = "warning"
	statusError     = "error"
	statusCancelled = "cancelled"
	statusTimeout   = "timeout"
)

var (
	logLevels    = map[string]bool{"INFO": true, "WARN": true, "ERROR": true, "SUCCESS": true}
	taskStatuses = map[string]bool{"running": true, "ok": true, "warning": true, "error": true, "skipped": true}
)

// run e uma execucao em andamento.
type run struct {
	id      string
	module  *Module
	tasks   []string
	params  json.RawMessage
	limit   time.Duration
	ctx     context.Context
	cancel  context.CancelFunc
	stopped chan struct{}

	mu        sync.Mutex
	cancelled bool
}

func (r *run) markCancelled() {
	r.mu.Lock()
	r.cancelled = true
	r.mu.Unlock()
	r.cancel()
}

func (r *run) wasCancelled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cancelled
}

// execute roda o modulo e publica os eventos; sempre termina com exatamente um done.
func (s *Service) execute(ru *run) {
	start := time.Now()
	em := newEmitter(s.pub, ru.id, s.now, s.log)
	status, reboot := statusError, false
	defer func() {
		if p := recover(); p != nil {
			s.log.Error("falha interna na execucao do Care", "run_id", ru.id, "panic", p)
			em.log("ERROR", fmt.Sprintf("Falha interna no agente: %v", p))
			status = statusError
		}
		em.done(status, time.Since(start).Milliseconds(), reboot)
		ru.cancel()
		s.mu.Lock()
		if s.cur == ru {
			s.cur = nil
		}
		s.mu.Unlock()
		close(ru.stopped)
	}()

	em.log("INFO", fmt.Sprintf("EYES: modulo %s, tarefas: %s", ru.module.Key, strings.Join(ru.tasks, ", ")))
	exitCode, startErr := s.runProcess(ru, em)

	switch {
	case ru.wasCancelled():
		status = statusCancelled
		em.log("WARN", "Execucao cancelada pelo tecnico; processos do modulo encerrados")
		em.closeTasks(ru.tasks, "Interrompida (execucao cancelada)", "skipped", "Nao executada (execucao cancelada)")
	case errors.Is(ru.ctx.Err(), context.DeadlineExceeded):
		status = statusTimeout
		em.log("ERROR", fmt.Sprintf("Tempo limite de %s excedido; processos do modulo encerrados", humanDuration(ru.limit)))
		em.closeTasks(ru.tasks, "Interrompida (tempo limite)", "skipped", "Nao executada (tempo limite)")
	case ru.ctx.Err() != nil:
		status = statusCancelled
		em.log("WARN", "Execucao interrompida: o agente esta parando")
		em.closeTasks(ru.tasks, "Interrompida (agente parando)", "skipped", "Nao executada (agente parando)")
	case startErr != nil:
		status = statusError
		em.log("ERROR", "Falha ao iniciar o modulo: "+startErr.Error())
		em.closeTasks(ru.tasks, "Interrompida", statusError, "Nao executada")
	default:
		em.closeTasks(ru.tasks, "A tarefa nao terminou (o modulo encerrou antes)", statusError, "Nao executada (o modulo encerrou antes)")
		status = em.derivedStatus(ru.tasks)
		if exitCode != 0 {
			em.log("WARN", fmt.Sprintf("O modulo terminou com codigo de saida %d", exitCode))
			if status == statusOK {
				status = statusWarning
			}
		}
	}
	reboot = em.rebootRequired(ru.module)
}

// runProcess extrai os scripts, executa o modulo e espera o fim, o cancelamento ou o tempo limite.
func (s *Service) runProcess(ru *run, em *emitter) (int, error) {
	dir, err := s.prepareDir(ru)
	if dir != "" {
		defer os.RemoveAll(dir)
	}
	if err != nil {
		return -1, err
	}
	script := filepath.Join(dir, path.Base(scriptPath(s.platform, ru.module.Key)))
	exe, args := interpreter(script)
	cmd := exec.Command(exe, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"WINCARE_REQUEST="+filepath.Join(dir, "request.json"),
		"WINCARE_DIR="+dir,
		"WINCARE_TASKS="+strings.Join(ru.tasks, ","),
		"WINCARE_RUN_ID="+ru.id,
		"WINCARE_MODULE="+ru.module.Key,
	)
	stdout := newLineWriter(em.stdoutLine)
	stderr := newLineWriter(em.stderrLine)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	prepareCmd(cmd)
	if err := cmd.Start(); err != nil {
		return -1, err
	}
	tree := trackTree(cmd)
	waited := make(chan error, 1)
	go func() { waited <- cmd.Wait() }()
	select {
	case <-waited:
	case <-ru.ctx.Done():
		tree.kill(cmd)
		select {
		case <-waited:
		case <-time.After(15 * time.Second):
			s.log.Warn("o modulo do Care nao terminou depois de encerrado", "run_id", ru.id)
		}
	}
	tree.release()
	stdout.Flush()
	stderr.Flush()
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	return code, nil
}

// prepareDir cria a pasta privada da execucao com o modulo, o harness e o pedido em JSON.
func (s *Service) prepareDir(ru *run) (string, error) {
	base := s.workDir()
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", err
	}
	_ = restrictPath(base, true)
	// Uma execucao por vez: o que sobrou na pasta e de execucoes interrompidas.
	if entries, err := os.ReadDir(base); err == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "wc-") {
				_ = os.RemoveAll(filepath.Join(base, e.Name()))
			}
		}
	}
	dir := filepath.Join(base, ru.id)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return "", err
	}
	if err := restrictPath(dir, true); err != nil {
		return dir, fmt.Errorf("falha ao restringir a pasta da execucao: %w", err)
	}
	for _, name := range []string{runtimePath(s.platform), scriptPath(s.platform, ru.module.Key)} {
		b, err := fs.ReadFile(s.scripts, name)
		if err != nil {
			return dir, fmt.Errorf("script %s ausente no agente", path.Base(name))
		}
		if err := writePrivate(filepath.Join(dir, path.Base(name)), scriptBytes(name, b)); err != nil {
			return dir, err
		}
	}
	req, err := json.Marshal(struct {
		RunID  string          `json:"run_id"`
		Module string          `json:"module"`
		Tasks  []string        `json:"tasks"`
		Params json.RawMessage `json:"params"`
	}{ru.id, ru.module.Key, ru.tasks, ru.params})
	if err != nil {
		return dir, err
	}
	return dir, writePrivate(filepath.Join(dir, "request.json"), req)
}

func writePrivate(name string, b []byte) error {
	if err := os.WriteFile(name, b, 0o600); err != nil {
		return err
	}
	return restrictPath(name, false)
}

// emitter numera e publica os eventos de uma execucao e guarda o estado das tarefas.
type emitter struct {
	pub   publisher
	runID string
	now   func() time.Time
	lg    logger

	mu       sync.Mutex
	seq      int
	dropped  bool
	first    bool
	status   map[string]string // ultimo status por tarefa
	order    []string
	rebootBy map[string]bool // rebootRequired informado em eventos result, por tarefa
	anyRbt   bool
}

type publisher interface {
	Publish(suffix string, body any) error
}

type logger interface {
	Warn(msg string, args ...any)
}

func newEmitter(pub publisher, runID string, now func() time.Time, log logger) *emitter {
	return &emitter{pub: pub, runID: runID, now: now, lg: log, first: true,
		status: map[string]string{}, rebootBy: map[string]bool{}}
}

// publish atribui seq e time e publica; deve ser chamado com mu travado.
func (e *emitter) publish(ev map[string]any) {
	typ, _ := ev["type"].(string)
	switch typ {
	case "done":
	case "task":
		if e.seq >= maxEvents+8 {
			return
		}
	default:
		if e.seq >= softEvents {
			if e.dropped {
				return
			}
			e.dropped = true
			ev = map[string]any{"type": "log", "level": "WARN",
				"message": fmt.Sprintf("Limite de %d eventos atingido: as mensagens seguintes desta execucao foram omitidas", softEvents)}
		}
	}
	e.seq++
	ev["seq"] = e.seq
	ev["time"] = e.now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(ev); err != nil {
		e.lg.Warn("evento do Care nao serializavel", "run_id", e.runID, "erro", err)
		return
	}
	if err := e.pub.Publish("cmdoutput."+e.runID, strings.TrimSpace(buf.String())); err != nil {
		e.lg.Warn("falha ao publicar evento do Care", "run_id", e.runID, "seq", e.seq, "erro", err)
	}
}

func (e *emitter) log(level, msg string) {
	msg = cleanText(msg)
	if strings.TrimSpace(msg) == "" {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.publish(map[string]any{"type": "log", "level": level, "message": msg})
}

func (e *emitter) task(key, status, msg string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.setTask(key, status)
	ev := map[string]any{"type": "task", "key": key, "status": status}
	if msg != "" {
		ev["message"] = cleanText(msg)
	}
	e.publish(ev)
}

func (e *emitter) setTask(key, status string) {
	if _, ok := e.status[key]; !ok {
		e.order = append(e.order, key)
	}
	e.status[key] = status
}

func (e *emitter) done(status string, durationMs int64, reboot bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.publish(map[string]any{"type": "done", "status": status, "durationMs": durationMs, "rebootRequired": reboot})
}

// stdoutLine trata uma linha do stdout: "##WC {json}" vira evento; o resto vira log INFO.
func (e *emitter) stdoutLine(line string) {
	if e.first {
		line = strings.TrimPrefix(line, "\ufeff")
		e.first = false
	}
	if rest, ok := strings.CutPrefix(line, "##WC "); ok {
		e.moduleEvent(rest)
		return
	}
	e.log("INFO", line)
}

// stderrLine: saida de erro do modulo vira log WARN.
func (e *emitter) stderrLine(line string) { e.log("WARN", line) }

// moduleEvent valida um evento do harness e o republica so com campos de tipo correto
// (o servidor faz cast estrito em status, key e message).
func (e *emitter) moduleEvent(raw string) {
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var ev map[string]any
	if err := dec.Decode(&ev); err != nil || ev == nil {
		e.log("WARN", "Evento invalido do modulo: "+truncate(raw, 300))
		return
	}
	typ, _ := ev["type"].(string)
	switch typ {
	case "log":
		level := strings.ToUpper(text(ev["level"]))
		if !logLevels[level] {
			level = "INFO"
		}
		e.log(level, text(ev["message"]))
	case "progress":
		out := map[string]any{"type": "progress", "value": percent(ev["value"])}
		if m := text(ev["message"]); m != "" {
			out["message"] = cleanText(m)
		}
		e.mu.Lock()
		e.publish(out)
		e.mu.Unlock()
	case "task":
		key, status := text(ev["key"]), text(ev["status"])
		if key == "" {
			e.log("WARN", "Evento de tarefa sem chave: "+truncate(raw, 300))
			return
		}
		if !taskStatuses[status] {
			status = statusError
		}
		e.task(key, status, text(ev["message"]))
	case "result":
		data, ok := ev["data"]
		if !ok {
			return
		}
		e.mu.Lock()
		if m, ok := data.(map[string]any); ok {
			if rr, ok := m["rebootRequired"].(bool); ok {
				if task := text(m["task"]); task != "" {
					e.rebootBy[task] = rr
				} else if rr {
					e.anyRbt = true
				}
			}
		}
		e.publish(map[string]any{"type": "result", "data": data})
		e.mu.Unlock()
	case "done":
		// O done e sempre do agente.
	default:
		e.log("INFO", truncate(raw, maxMessage))
	}
}

// closeTasks publica o status final das tarefas que ficaram sem status: a que estava rodando
// recebe error com runningMsg; as que nem comecaram recebem pendingStatus com pendingMsg.
func (e *emitter) closeTasks(tasks []string, runningMsg, pendingStatus, pendingMsg string) {
	for _, k := range tasks {
		e.mu.Lock()
		st := e.status[k]
		e.mu.Unlock()
		switch st {
		case "ok", "warning", "error", "skipped":
		case "running":
			e.task(k, statusError, runningMsg)
		default:
			e.task(k, pendingStatus, pendingMsg)
		}
	}
}

// derivedStatus resume os status das tarefas pedidas: error > warning > ok.
func (e *emitter) derivedStatus(tasks []string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := statusOK
	for _, k := range tasks {
		switch e.status[k] {
		case "ok", "skipped":
		case "warning":
			if out == statusOK {
				out = statusWarning
			}
		default:
			return statusError
		}
	}
	return out
}

// rebootRequired: o rebootRequired de um evento result da tarefa prevalece; sem ele, vale o
// "reboot" do catalogo para tarefas que terminaram em ok ou warning.
func (e *emitter) rebootRequired(m *Module) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.anyRbt {
		return true
	}
	for _, k := range e.order {
		if rr, ok := e.rebootBy[k]; ok {
			if rr {
				return true
			}
			continue
		}
		st := e.status[k]
		if t := m.Task(k); t != nil && t.Reboot && (st == "ok" || st == "warning") {
			return true
		}
	}
	return false
}

// lineWriter separa a saida do processo em linhas.
type lineWriter struct {
	mu   sync.Mutex
	buf  []byte
	skip bool
	fn   func(string)
}

func newLineWriter(fn func(string)) *lineWriter { return &lineWriter{fn: fn} }

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := len(p)
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		chunk := p
		if i >= 0 {
			chunk = p[:i]
		}
		if !w.skip {
			if room := maxLine - len(w.buf); len(chunk) > room {
				w.buf = append(w.buf, chunk[:room]...)
				w.emit()
				w.skip = true
			} else {
				w.buf = append(w.buf, chunk...)
			}
		}
		if i < 0 {
			break
		}
		if !w.skip {
			w.emit()
		}
		w.skip = false
		p = p[i+1:]
	}
	return n, nil
}

// Flush entrega a ultima linha sem quebra.
func (w *lineWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.buf) > 0 && !w.skip {
		w.emit()
	}
	w.buf, w.skip = w.buf[:0], false
}

func (w *lineWriter) emit() {
	line := strings.TrimRight(string(w.buf), "\r")
	w.buf = w.buf[:0]
	w.fn(strings.ToValidUTF8(line, "\uFFFD"))
}

// text converte um valor JSON em texto (o servidor exige str em message, key e status).
func text(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(b)
}

// percent converte o valor de progresso em inteiro de 0 a 100.
func percent(v any) int {
	var f float64
	switch x := v.(type) {
	case json.Number:
		f, _ = x.Float64()
	case float64:
		f = x
	case string:
		_, _ = fmt.Sscan(x, &f)
	}
	switch {
	case f != f || f < 0:
		return 0
	case f > 100:
		return 100
	}
	return int(f)
}

// cleanText remove NUL e limita o tamanho sem cortar caracteres ao meio.
func cleanText(s string) string {
	s = strings.ReplaceAll(strings.ToValidUTF8(s, "\uFFFD"), "\x00", "")
	return truncate(strings.TrimRight(s, " \t\r\n"), maxMessage)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "..."
}

func humanDuration(d time.Duration) string {
	if d%time.Hour == 0 {
		return fmt.Sprintf("%d h", int(d/time.Hour))
	}
	if d%time.Minute == 0 {
		return fmt.Sprintf("%d min", int(d/time.Minute))
	}
	return d.String()
}
