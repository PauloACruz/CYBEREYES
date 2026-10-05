//go:build !windows

package care

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

type fakePub struct {
	mu   sync.Mutex
	msgs []string
	subj []string
	ch   chan map[string]any
}

func (p *fakePub) Publish(suffix string, body any) error {
	s, ok := body.(string)
	if !ok {
		panic(fmt.Sprintf("evento nao e string: %T", body))
	}
	p.mu.Lock()
	p.msgs = append(p.msgs, s)
	p.subj = append(p.subj, suffix)
	ch := p.ch
	p.mu.Unlock()
	if ch != nil {
		var ev map[string]any
		_ = json.Unmarshal([]byte(s), &ev)
		select {
		case ch <- ev:
		default:
		}
	}
	return nil
}

func (p *fakePub) events(t *testing.T) []map[string]any {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []map[string]any
	for _, s := range p.msgs {
		dec := json.NewDecoder(strings.NewReader(s))
		dec.UseNumber()
		var ev map[string]any
		if err := dec.Decode(&ev); err != nil {
			t.Fatalf("evento com JSON invalido: %s", s)
		}
		out = append(out, ev)
	}
	return out
}

const testRunID = "wc-0123456789abcdef0123456789abcdef"

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newTestService(t *testing.T, platform string, scripts fstest.MapFS) (*Service, *fakePub) {
	t.Helper()
	pub := &fakePub{ch: make(chan map[string]any, 10000)}
	rt, err := os.ReadFile("scripts/unix/_runtime.sh")
	if err != nil {
		t.Fatal(err)
	}
	scripts["scripts/unix/_runtime.sh"] = &fstest.MapFile{Data: rt}
	s, err := newService(t.Context(), pub, quietLog(), platform, scripts)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s.workDir = func() string { return dir }
	return s, pub
}

// waitDone espera o evento done e devolve todos os eventos publicados.
func waitDone(t *testing.T, s *Service, pub *fakePub, timeout time.Duration) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.Running() == "" {
			evs := pub.events(t)
			if len(evs) > 0 && evs[len(evs)-1]["type"] == "done" {
				return evs
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("execucao nao terminou; eventos: %v", pub.msgs)
	return nil
}

// checkStream confere seq 1..n, time RFC 3339, assunto e um unico done no fim.
func checkStream(t *testing.T, pub *fakePub, evs []map[string]any) map[string]any {
	t.Helper()
	for i, ev := range evs {
		seq, ok := ev["seq"].(json.Number)
		if !ok || seq.String() != fmt.Sprint(i+1) {
			t.Fatalf("evento %d com seq %v (esperado inteiro %d): %v", i, ev["seq"], i+1, ev)
		}
		ts, _ := ev["time"].(string)
		if _, err := time.Parse(time.RFC3339, ts); err != nil {
			t.Fatalf("time invalido %q", ts)
		}
		if pub.subj[i] != "cmdoutput."+testRunID {
			t.Fatalf("assunto %q", pub.subj[i])
		}
		if ev["type"] == "done" && i != len(evs)-1 {
			t.Fatalf("done antes do fim: %d de %d", i, len(evs))
		}
		switch ev["type"] {
		case "log":
			if _, ok := ev["message"].(string); !ok || !logLevels[fmt.Sprint(ev["level"])] {
				t.Fatalf("log invalido: %v", ev)
			}
		case "task":
			if _, ok := ev["key"].(string); !ok || !taskStatuses[fmt.Sprint(ev["status"])] {
				t.Fatalf("task invalido: %v", ev)
			}
		}
	}
	done := evs[len(evs)-1]
	if _, err := done["durationMs"].(json.Number).Int64(); err != nil {
		t.Fatalf("durationMs nao inteiro: %v", done["durationMs"])
	}
	if _, ok := done["rebootRequired"].(bool); !ok {
		t.Fatalf("rebootRequired nao bool: %v", done)
	}
	return done
}

func taskStatus(evs []map[string]any, key string) []string {
	var out []string
	for _, ev := range evs {
		if ev["type"] == "task" && ev["key"] == key {
			out = append(out, ev["status"].(string))
		}
	}
	return out
}

func TestStartValidation(t *testing.T) {
	cat := `{"version":"3.0.0","modules":[{"key":"m","label":"M","description":"","platforms":["linux","windows"],"tasks":[
	 {"key":"a","label":"A","group":"","description":"","default":true,"platforms":["linux"],"selfService":false,"reboot":false,"dangerous":false,"params":[{"name":"q","label":"Q","type":"string","required":true}]},
	 {"key":"w","label":"W","group":"","description":"","default":true,"platforms":["windows"],"selfService":false,"reboot":false,"dangerous":false,"params":[]}]},
	 {"key":"winonly","label":"W","description":"","platforms":["windows"],"tasks":[]}]}`
	s, pub := newTestService(t, "linux", fstest.MapFS{
		"scripts/catalog.json": {Data: []byte(cat)},
		"scripts/unix/m.sh":    {Data: []byte(`. "$(dirname "$0")/_runtime.sh"` + "\ntask_a() { sleep 5; }\nwc_main\n")},
	})
	cases := []struct{ id, mod, tasks, params, want string }{
		{"wc-123", "m", "a", `{"q":"x"}`, "error: run_id invalido"},
		{"WC-0123456789abcdef0123456789abcdef", "m", "a", `{"q":"x"}`, "error: run_id invalido"},
		{testRunID, "nada", "a", "", "error: modulo desconhecido: nada"},
		{testRunID, "winonly", "a", "", "error: modulo nao suportado neste sistema: winonly"},
		{testRunID, "m", "w", "", "error: tarefa nao suportada neste sistema: w"},
		{testRunID, "m", "zz", "", "error: tarefa desconhecida: zz"},
		{testRunID, "m", " , ", "", "error: nenhuma tarefa informada"},
		{testRunID, "m", "a", `[1]`, "error: params invalido (esperado objeto JSON)"},
		{testRunID, "m", "a", `{}`, "error: parametro obrigatorio ausente: q (tarefa a)"},
		{testRunID, "m", "a", `{"q":"  "}`, "error: parametro obrigatorio ausente: q (tarefa a)"},
	}
	for _, c := range cases {
		if got := s.Start(c.id, c.mod, c.tasks, c.params); got != c.want {
			t.Errorf("Start(%q,%q,%q,%q) = %q, esperado %q", c.id, c.mod, c.tasks, c.params, got, c.want)
		}
	}
	if got := s.Cancel(testRunID); got != "error: not running" {
		t.Errorf("cancel sem execucao: %q", got)
	}
	if got := s.Start(testRunID, "m", "a", `{"q":"x"}`); got != "started" {
		t.Fatalf("Start = %q", got)
	}
	if got := s.Start("wc-ffffffffffffffffffffffffffffffff", "m", "a", `{"q":"x"}`); got != "error: busy" {
		t.Errorf("segunda execucao: %q", got)
	}
	if got := s.Cancel("wc-ffffffffffffffffffffffffffffffff"); got != "error: not running" {
		t.Errorf("cancel de outro run_id: %q", got)
	}
	s.Cancel(testRunID)
	if done := checkStream(t, pub, waitDone(t, s, pub, 15*time.Second)); done["status"] != "cancelled" {
		t.Fatalf("done: %v", done)
	}
}

// Executa o modulo maintenance real (tarefa disk_space, so leitura) pelo harness bash.
func TestRunRealModule(t *testing.T) {
	s, err := newService(t.Context(), &fakePub{}, quietLog(), "linux", embedded)
	if err != nil {
		t.Fatal(err)
	}
	pub := &fakePub{}
	s.pub = pub
	dir := t.TempDir()
	s.workDir = func() string { return dir }
	if got := s.Start(testRunID, "maintenance", "disk_space", "{}"); got != "started" {
		t.Fatalf("Start = %q", got)
	}
	evs := waitDone(t, s, pub, 60*time.Second)
	done := checkStream(t, pub, evs)
	st := taskStatus(evs, "disk_space")
	if len(st) != 2 || st[0] != "running" || (st[1] != "ok" && st[1] != "warning") {
		t.Fatalf("status da tarefa: %v", st)
	}
	if done["status"] != st[1] || done["rebootRequired"] != false {
		t.Fatalf("done: %v", done)
	}
	var result, progress100 bool
	for _, ev := range evs {
		if ev["type"] == "result" {
			data, _ := ev["data"].(map[string]any)
			_, result = data["volumes"]
		}
		if ev["type"] == "progress" && ev["value"].(json.Number).String() == "100" {
			progress100 = true
		}
	}
	if !result || !progress100 {
		t.Fatalf("faltou result ou progresso 100: %v", pub.msgs)
	}
	// A pasta privada da execucao e removida no fim.
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("pasta de trabalho nao foi limpa: %v", entries)
	}
}

const fakeCatalog = `{"version":"3.0.0","modules":[{"key":"fake","label":"F","description":"","platforms":["linux","darwin"],"tasks":[
 {"key":"slow","label":"S","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"after","label":"A","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"rb","label":"R","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":true,"dangerous":false,"params":[]},
 {"key":"rr","label":"R","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"noisy","label":"N","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"warn","label":"W","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"crash","label":"C","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]},
 {"key":"flood","label":"F","group":"","description":"","default":true,"platforms":["linux","darwin"],"selfService":false,"reboot":false,"dangerous":false,"params":[]}]}]}`

const fakeModule = `. "$(dirname "$0")/_runtime.sh"
task_slow() { wc_log INFO "dormindo"; sleep 30; }
task_after() { wc_log INFO "depois"; }
task_rb() { wc_log SUCCESS "feito"; }
task_rr() { wc_result '"rebootRequired":true'; }
task_noisy() {
	echo "linha comum"
	echo "erro no stderr" >&2
	echo '##WC {nao e json'
	echo '##WC {"type":"log","level":"DEBUG","message":42}'
	echo '##WC {"type":"done","status":"ok"}'
	echo '##WC {"type":"progress","value":250}'
	printf '##WC {"type":"log","level":"INFO","message":"sem quebra"}'
	echo
}
task_warn() { wc_log WARN "atencao"; }
task_crash() { kill -9 0; }
task_flood() { i=0; while [ $i -lt 6000 ]; do echo "linha $i"; i=$((i+1)); done; }
wc_main
`

func fakeService(t *testing.T) (*Service, *fakePub) {
	return newTestService(t, "linux", fstest.MapFS{
		"scripts/catalog.json": {Data: []byte(fakeCatalog)},
		"scripts/unix/fake.sh": {Data: []byte(fakeModule)},
	})
}

func waitTaskRunning(t *testing.T, pub *fakePub, key string) {
	t.Helper()
	timeout := time.After(20 * time.Second)
	for {
		select {
		case ev := <-pub.ch:
			if ev["type"] == "task" && ev["key"] == key && ev["status"] == "running" {
				return
			}
		case <-timeout:
			t.Fatalf("tarefa %s nao comecou: %v", key, pub.msgs)
		}
	}
}

func TestCancelKillsModule(t *testing.T) {
	s, pub := fakeService(t)
	if got := s.Start(testRunID, "fake", "slow,after", "{}"); got != "started" {
		t.Fatalf("Start = %q", got)
	}
	waitTaskRunning(t, pub, "slow")
	start := time.Now()
	if got := s.Cancel(testRunID); got != "ok" {
		t.Fatalf("Cancel = %q", got)
	}
	evs := waitDone(t, s, pub, 15*time.Second)
	if time.Since(start) > 10*time.Second {
		t.Fatalf("cancelamento demorou %s", time.Since(start))
	}
	done := checkStream(t, pub, evs)
	if done["status"] != "cancelled" {
		t.Fatalf("done: %v", done)
	}
	if st := taskStatus(evs, "slow"); st[len(st)-1] != "error" {
		t.Fatalf("slow: %v", st)
	}
	if st := taskStatus(evs, "after"); len(st) != 1 || st[0] != "skipped" {
		t.Fatalf("after: %v", st)
	}
	// Depois do fim, outra execucao pode comecar.
	if got := s.Start("wc-ffffffffffffffffffffffffffffffff", "fake", "after", "{}"); got != "started" {
		t.Fatalf("Start depois do cancelamento = %q", got)
	}
	waitDone(t, s, pub, 20*time.Second)
}

func TestTimeoutKillsModule(t *testing.T) {
	s, pub := fakeService(t)
	s.limit = func(string) time.Duration { return 1500 * time.Millisecond }
	if got := s.Start(testRunID, "fake", "slow", "{}"); got != "started" {
		t.Fatalf("Start = %q", got)
	}
	evs := waitDone(t, s, pub, 15*time.Second)
	done := checkStream(t, pub, evs)
	if done["status"] != "timeout" {
		t.Fatalf("done: %v", done)
	}
}

func TestStatusRebootAndOutput(t *testing.T) {
	s, pub := fakeService(t)
	if got := s.Start(testRunID, "fake", "rb,noisy,after", "{}"); got != "started" {
		t.Fatalf("Start = %q", got)
	}
	evs := waitDone(t, s, pub, 20*time.Second)
	done := checkStream(t, pub, evs)
	if done["status"] != "ok" || done["rebootRequired"] != true {
		t.Fatalf("done: %v", done)
	}
	var msgs []string
	for _, ev := range evs {
		switch ev["type"] {
		case "log":
			msgs = append(msgs, ev["level"].(string)+" "+ev["message"].(string))
		case "progress":
			if v, _ := ev["value"].(json.Number).Int64(); v < 0 || v > 100 {
				t.Fatalf("progresso fora da faixa: %v", ev)
			}
		}
	}
	joined := strings.Join(msgs, "\n")
	for _, want := range []string{"INFO linha comum", "WARN erro no stderr", "WARN Evento invalido do modulo", "INFO 42", "INFO sem quebra"} {
		if !strings.Contains(joined, want) {
			t.Errorf("faltou log %q em:\n%s", want, joined)
		}
	}

	// rebootRequired vindo de um result prevalece; warning vira status geral warning.
	s2, pub2 := fakeService(t)
	s2.Start(testRunID, "fake", "rr,warn", "{}")
	done = checkStream(t, pub2, waitDone(t, s2, pub2, 20*time.Second))
	if done["status"] != "warning" || done["rebootRequired"] != true {
		t.Fatalf("done: %v", done)
	}
}

func TestModuleCrash(t *testing.T) {
	s, pub := fakeService(t)
	s.Start(testRunID, "fake", "crash,after", "{}")
	evs := waitDone(t, s, pub, 20*time.Second)
	done := checkStream(t, pub, evs)
	if done["status"] != "error" {
		t.Fatalf("done: %v", done)
	}
	if st := taskStatus(evs, "after"); len(st) != 1 || st[0] != "error" {
		t.Fatalf("after: %v", st)
	}
}

func TestEventLimit(t *testing.T) {
	s, pub := fakeService(t)
	s.Start(testRunID, "fake", "flood,after", "{}")
	evs := waitDone(t, s, pub, 60*time.Second)
	done := checkStream(t, pub, evs)
	if len(evs) > maxEvents+10 {
		t.Fatalf("%d eventos, acima do limite do servidor", len(evs))
	}
	if done["status"] != "ok" {
		t.Fatalf("done: %v", done)
	}
	if st := taskStatus(evs, "after"); len(st) != 2 || st[1] != "ok" {
		t.Fatalf("tarefa depois do limite: %v", st)
	}
}

func TestLineWriter(t *testing.T) {
	var lines []string
	w := newLineWriter(func(s string) { lines = append(lines, s) })
	w.Write([]byte("a\r\nb"))
	w.Write([]byte("c\n\n"))
	w.Write([]byte(strings.Repeat("x", maxLine+10) + "\nfim"))
	w.Flush()
	if len(lines) != 5 || lines[0] != "a" || lines[1] != "bc" || lines[2] != "" || len(lines[3]) != maxLine || lines[4] != "fim" {
		t.Fatalf("linhas: %d %q", len(lines), lines[:3])
	}
}
