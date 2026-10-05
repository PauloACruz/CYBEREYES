package logs

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

// fakeSource tem eventos numerados 1..N na chave "k"; a posicao e o numero do ultimo lido.
type fakeSource struct {
	mu     sync.Mutex
	events []Entry
	reads  int
}

func (f *fakeSource) add(n int, level string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := 0; i < n; i++ {
		id := len(f.events) + 1
		f.events = append(f.events, Entry{
			Time: time.Unix(1_790_000_000+int64(id), 0), Level: level, Source: "src", Log: "fake",
			Message: "evento " + strconv.Itoa(id), Key: "k", Pos: strconv.Itoa(id),
		})
	}
}

func (f *fakeSource) Read(_ context.Context, _ Config, cur map[string]string, emit func(Entry)) (map[string]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads++
	pos, ok := cur["k"]
	if !ok {
		return map[string]string{"k": strconv.Itoa(len(f.events))}, nil
	}
	from, _ := strconv.Atoi(pos)
	for _, e := range f.events[from:] {
		emit(e)
	}
	return map[string]string{"k": strconv.Itoa(len(f.events))}, nil
}

// fakeServer responde logconfig e recebe lotes; fail decide o status de cada POST.
type fakeServer struct {
	mu      sync.Mutex
	cfg     Config
	batches [][]map[string]any
	fail    func(n int) int
	posts   int
}

func (s *fakeServer) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if r.Header.Get("Authorization") != "Token tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/AGENTE/logconfig/":
			_ = json.NewEncoder(w).Encode(s.cfg)
		case r.Method == http.MethodPost && r.URL.Path == "/api/v3/logs/":
			s.posts++
			data, _ := io.ReadAll(r.Body)
			if len(data) > 2*1024*1024 {
				t.Errorf("lote com %d bytes", len(data))
			}
			if s.fail != nil {
				if code := s.fail(s.posts); code != 0 {
					w.WriteHeader(code)
					_, _ = w.Write([]byte(`"Batch too large"`))
					return
				}
			}
			var body struct {
				Entries []map[string]any `json:"entries"`
			}
			if err := json.Unmarshal(data, &body); err != nil || body.Entries == nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if len(body.Entries) > 1000 {
				t.Errorf("lote com %d entradas", len(body.Entries))
			}
			s.batches = append(s.batches, body.Entries)
			_, _ = w.Write([]byte(`"ok"`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func (s *fakeServer) all() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, b := range s.batches {
		out = append(out, b...)
	}
	return out
}

func setup(t *testing.T, cfg Config) (*collector, *fakeSource, *fakeServer, string) {
	t.Helper()
	srv := &fakeServer{cfg: cfg}
	hs := httptest.NewServer(srv.handler(t))
	t.Cleanup(hs.Close)
	cl, err := api.New(hs.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	src := &fakeSource{}
	path := filepath.Join(t.TempDir(), "state", "logs.json")
	c := newCollector(cl, src, "AGENTE", path, slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.host = "maquina"
	if err := c.refreshConfig(context.Background()); err != nil {
		t.Fatal(err)
	}
	return c, src, srv, path
}

func savedCursor(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var st state
	if err := json.Unmarshal(data, &st); err != nil {
		t.Fatal(err)
	}
	return st.Cursors["k"]
}

func TestFirstRunStartsNowWithoutHistory(t *testing.T) {
	c, src, srv, path := setup(t, Config{Enabled: true, MinLevel: "info", MaxPerCycle: 500})
	src.add(10, "error")
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(srv.all()) != 0 {
		t.Fatalf("historico enviado na primeira execucao: %d", len(srv.all()))
	}
	if got := savedCursor(t, path); got != "10" {
		t.Fatalf("cursor = %q, esperado 10", got)
	}
	src.add(3, "error")
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := srv.all()
	if len(got) != 3 || got[0]["message"] != "evento 11" || got[2]["message"] != "evento 13" {
		t.Fatalf("entradas = %v", got)
	}
	e := got[0]
	if e["level"] != "error" || e["source"] != "src" || e["log"] != "fake" || e["host"] != "maquina" || e["event_id"] != nil {
		t.Fatalf("entrada = %v", e)
	}
	if _, err := time.Parse(time.RFC3339, e["time"].(string)); err != nil || !strings.HasSuffix(e["time"].(string), "Z") {
		t.Fatalf("hora = %v", e["time"])
	}
	if got := savedCursor(t, path); got != "13" {
		t.Fatalf("cursor = %q, esperado 13", got)
	}
}

func TestCapBatchesAndOverflowEntry(t *testing.T) {
	c, src, srv, path := setup(t, Config{Enabled: true, MinLevel: "warning", MaxPerCycle: 2500})
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	src.add(2000, "warning")
	src.add(500, "info") // abaixo do minimo: nao conta no limite
	src.add(1000, "critical")
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	srv.mu.Lock()
	sizes := []int{}
	for _, b := range srv.batches {
		sizes = append(sizes, len(b))
	}
	srv.mu.Unlock()
	if len(sizes) != 3 || sizes[0] != 1000 || sizes[1] != 1000 || sizes[2] != 501 {
		t.Fatalf("lotes = %v", sizes)
	}
	all := srv.all()
	last := all[len(all)-1]
	if last["source"] != SourceAgent || last["level"] != "warning" || last["message"] != "500 eventos descartados pelo limite" {
		t.Fatalf("entrada de excedente = %v", last)
	}
	for _, e := range all[:len(all)-1] {
		if e["level"] == "info" {
			t.Fatal("entrada abaixo do nivel minimo enviada")
		}
	}
	if got := savedCursor(t, path); got != "3500" {
		t.Fatalf("cursor = %q, esperado 3500 (inclui os descartados)", got)
	}
}

func TestFailedPostKeepsPositionAndRetries(t *testing.T) {
	c, src, srv, path := setup(t, Config{Enabled: true, MinLevel: "info", MaxPerCycle: 5000})
	_ = c.cycle(context.Background())
	src.add(1500, "error")
	srv.fail = func(n int) int {
		if n == 2 {
			return http.StatusServiceUnavailable
		}
		return 0
	}
	if err := c.cycle(context.Background()); err == nil {
		t.Fatal("esperava erro no envio")
	}
	// O primeiro lote foi confirmado: a posicao avanca so ate ele.
	if got := savedCursor(t, path); got != "1000" {
		t.Fatalf("cursor = %q, esperado 1000", got)
	}
	srv.fail = func(int) int { return http.StatusBadGateway }
	if err := c.cycle(context.Background()); err == nil {
		t.Fatal("esperava erro no envio")
	}
	if got := savedCursor(t, path); got != "1000" {
		t.Fatalf("cursor = %q, esperado 1000", got)
	}
	srv.fail = nil
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	all := srv.all()
	if len(all) != 1500 || all[1000]["message"] != "evento 1001" {
		t.Fatalf("total = %d", len(all))
	}
	if got := savedCursor(t, path); got != "1500" {
		t.Fatalf("cursor = %q", got)
	}
	// O estado persistido e retomado por uma nova instancia (reinicio do agente).
	c2 := newCollector(c.api, src, "AGENTE", path, c.log)
	c2.cfg, c2.cfgKnown = c.cfg, true
	src.add(1, "error")
	if err := c2.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if all := srv.all(); len(all) != 1501 || all[1500]["message"] != "evento 1501" {
		t.Fatalf("depois do reinicio: %d", len(all))
	}
}

func TestRejectedBatchIsSkipped(t *testing.T) {
	c, src, srv, path := setup(t, Config{Enabled: true, MinLevel: "info"})
	_ = c.cycle(context.Background())
	src.add(2, "error")
	srv.fail = func(int) int { return http.StatusBadRequest }
	if err := c.cycle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := savedCursor(t, path); got != "2" {
		t.Fatalf("cursor = %q", got)
	}
}

func TestDisabledDoesNothingAndReenableRestarts(t *testing.T) {
	c, src, srv, path := setup(t, Config{Enabled: true, MinLevel: "info"})
	_ = c.cycle(context.Background())
	src.add(1, "error")
	_ = c.cycle(context.Background())

	srv.cfg = Config{Enabled: false}
	if err := c.refreshConfig(context.Background()); err != nil {
		t.Fatal(err)
	}
	reads := src.reads
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.run(ctx); close(done) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	<-done
	if src.reads != reads {
		t.Fatal("coleta executada com a configuracao desligada")
	}
	src.add(5, "error")
	srv.cfg = Config{Enabled: true, MinLevel: "info"}
	if err := c.refreshConfig(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = c.cycle(context.Background())
	if n := len(srv.all()); n != 1 {
		t.Fatalf("eventos do periodo desligado enviados: %d", n)
	}
	if got := savedCursor(t, path); got != "6" {
		t.Fatalf("cursor = %q", got)
	}
}

func TestTruncateAndSplit(t *testing.T) {
	long := strings.Repeat("á", 9000) + "\x00"
	if got := truncate(long, maxMessage); len([]rune(got)) != maxMessage {
		t.Fatalf("runas = %d", len([]rune(got)))
	}
	if got := truncate("a\x00b\xffc", 10); got != "ab�c" {
		t.Fatalf("truncate = %q", got)
	}
	var entries []wireEntry
	msg := strings.Repeat("x", 7000)
	for i := 0; i < 900; i++ {
		entries = append(entries, wireEntry{Level: "info", Message: msg})
	}
	batches := split(entries)
	total := 0
	for _, b := range batches {
		data, _ := json.Marshal(map[string]any{"entries": b})
		if len(data) >= 2*1024*1024 || len(b) > 1000 {
			t.Fatalf("lote com %d bytes e %d entradas", len(data), len(b))
		}
		total += len(b)
	}
	if total != 900 || len(batches) < 3 {
		t.Fatalf("total %d em %d lotes", total, len(batches))
	}
}

func TestParseJournal(t *testing.T) {
	out := `{"__CURSOR":"s=1;i=1","__REALTIME_TIMESTAMP":"1790000000123456","PRIORITY":"3","SYSLOG_IDENTIFIER":"kernel","MESSAGE":"disco falhou","_HOSTNAME":"srv01"}
{"__CURSOR":"s=1;i=2","__REALTIME_TIMESTAMP":"1790000001000000","PRIORITY":"4","_SYSTEMD_UNIT":"nginx.service","MESSAGE":[104,105,255]}
{"__CURSOR":"s=1;i=3","__REALTIME_TIMESTAMP":"1790000002000000","PRIORITY":"0","_COMM":"app","MESSAGE":null}
lixo
`
	var got []Entry
	n, stopped, err := parseJournal(strings.NewReader(out), 0, func(e journalEntry) bool {
		got = append(got, e.toEntry(e.cursor))
		return true
	})
	if err != nil || stopped || n != 3 {
		t.Fatalf("n=%d stopped=%v err=%v", n, stopped, err)
	}
	if got[0].Level != "error" || got[0].Source != "kernel" || got[0].Host != "srv01" || got[0].Log != "journal" ||
		!got[0].Time.Equal(time.UnixMicro(1790000000123456)) || got[0].Pos != "s=1;i=1" {
		t.Fatalf("0 = %+v", got[0])
	}
	if got[1].Level != "warning" || got[1].Source != "nginx.service" || got[1].Message != "hi�" {
		t.Fatalf("1 = %+v", got[1])
	}
	if got[2].Level != "critical" || got[2].Source != "app" || got[2].Message != "" {
		t.Fatalf("2 = %+v", got[2])
	}
	if _, stopped, _ := parseJournal(strings.NewReader(out), 2, func(journalEntry) bool { return true }); !stopped {
		t.Fatal("limite ignorado")
	}
	for p, want := range map[string]string{"0": "critical", "2": "critical", "3": "error", "4": "warning", "5": "info", "7": "info", "": "info"} {
		if got := journalLevel(p); got != want {
			t.Errorf("journalLevel(%q) = %s", p, got)
		}
	}
	for l, want := range map[string]string{"critical": "2", "error": "3", "warning": "4", "info": "6"} {
		if got := journalPriority(l); got != want {
			t.Errorf("journalPriority(%q) = %s", l, got)
		}
	}
}

func TestJournalMissingBinary(t *testing.T) {
	s := &journalSource{bin: filepath.Join(t.TempDir(), "nao-existe")}
	if _, err := s.Read(context.Background(), Config{}, map[string]string{}, func(Entry) {}); err == nil {
		t.Fatal("esperava erro sem journalctl")
	}
}

func TestParseUnified(t *testing.T) {
	since := time.Date(2026, 10, 5, 12, 0, 0, 500000000, time.UTC)
	out := `{"timestamp":"2026-10-05 09:00:00.400000-0300","messageType":"Error","eventType":"logEvent","eventMessage":"antigo","subsystem":"com.apple.x"}
{"timestamp":"2026-10-05 09:00:01.000000-0300","messageType":"Fault","eventType":"logEvent","eventMessage":"falha","subsystem":"com.apple.x","category":"io"}
{"timestamp":"2026-10-05 09:00:02.000000-0300","messageType":"Default","eventType":"logEvent","eventMessage":"aviso","processImagePath":"/usr/libexec/foo"}
{"timestamp":"2026-10-05 09:00:03.000000-0300","messageType":"Error","eventType":"activityCreateEvent","eventMessage":"atividade"}
`
	var got []Entry
	last, n, stopped, err := parseUnified(strings.NewReader(out), since, 0, func(e Entry) { got = append(got, e) })
	if err != nil || stopped || n != 2 || len(got) != 2 {
		t.Fatalf("n=%d err=%v got=%+v", n, err, got)
	}
	if got[0].Level != "critical" || got[0].Source != "com.apple.x:io" || got[0].Log != "unified" ||
		!got[0].Time.Equal(time.Date(2026, 10, 5, 12, 0, 1, 0, time.UTC)) {
		t.Fatalf("0 = %+v", got[0])
	}
	if got[1].Level != "info" || got[1].Source != "foo" {
		t.Fatalf("1 = %+v", got[1])
	}
	if !last.Equal(time.Date(2026, 10, 5, 12, 0, 2, 0, time.UTC)) {
		t.Fatalf("ultimo = %v", last)
	}
	if !strings.Contains(unifiedPredicate("info"), "default") || strings.Contains(unifiedPredicate("warning"), "default") {
		t.Fatal("predicado")
	}
}

func TestUnifiedFirstRun(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	s := &unifiedSource{bin: "/nao/existe", now: func() time.Time { return now }}
	next, err := s.Read(context.Background(), Config{}, map[string]string{}, func(Entry) { t.Fatal("historico emitido") })
	if err != nil || next[unifiedKey] != now.Format(time.RFC3339Nano) {
		t.Fatalf("next=%v err=%v", next, err)
	}
}

type fakeEventLog struct {
	events map[string][]winevt.Event
}

func (f *fakeEventLog) After(name string, after uint64, max int) ([]winevt.Event, error) {
	var out []winevt.Event
	for _, e := range f.events[name] {
		if e.RecordID > after && len(out) < max {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeEventLog) LastRecordID(name string) (uint64, error) {
	evs := f.events[name]
	if len(evs) == 0 {
		return 0, nil
	}
	return evs[len(evs)-1].RecordID, nil
}

func TestEventLogSource(t *testing.T) {
	f := &fakeEventLog{events: map[string][]winevt.Event{}}
	for i := 1; i <= 1500; i++ {
		f.events["System"] = append(f.events["System"], winevt.Event{RecordID: uint64(i), Log: "System", Source: "disk", EventID: 7, Type: "ERROR", Level: 2, Message: "m"})
	}
	s := &eventLogSource{api: f}
	cfg := Config{WindowsLogs: []string{"System", "Application"}}
	next, err := s.Read(context.Background(), cfg, map[string]string{}, func(Entry) { t.Fatal("historico emitido") })
	if err != nil || next["win:System"] != "1500" || next["win:Application"] != "0" {
		t.Fatalf("next=%v err=%v", next, err)
	}
	cur := map[string]string{"win:System": "200", "win:Application": "0"}
	var got []Entry
	next, err = s.Read(context.Background(), cfg, cur, func(e Entry) { got = append(got, e) })
	if err != nil || len(got) != 1300 || next["win:System"] != "1500" {
		t.Fatalf("lidos %d next=%v err=%v", len(got), next, err)
	}
	if e := got[0]; e.Level != "error" || *e.EventID != 7 || e.Key != "win:System" || e.Pos != "201" || e.Log != "System" {
		t.Fatalf("entrada = %+v", e)
	}
	// Log limpo: a posicao guardada passa do ultimo RecordID e a leitura recomeca do inicio.
	f.events["System"] = []winevt.Event{{RecordID: 1, Type: "WARNING"}, {RecordID: 2, Type: "AUDIT_FAILURE"}}
	got = nil
	next, _ = s.Read(context.Background(), Config{WindowsLogs: []string{"System"}}, map[string]string{"win:System": "1500"}, func(e Entry) { got = append(got, e) })
	if len(got) != 2 || next["win:System"] != "2" || got[0].Level != "warning" || got[1].Level != "warning" || got[0].Log != "System" {
		t.Fatalf("depois de limpar: %+v %v", got, next)
	}
	for _, c := range []struct {
		ev   winevt.Event
		want string
	}{
		{winevt.Event{Type: "CRITICAL"}, "critical"},
		{winevt.Event{Type: "INFO"}, "info"},
		{winevt.Event{Type: "AUDIT_SUCCESS"}, "info"},
		{winevt.Event{Level: 1}, "critical"},
		{winevt.Event{Level: 3}, "warning"},
		{winevt.Event{Level: 0}, "info"},
	} {
		if got := eventLogLevel(c.ev); got != c.want {
			t.Errorf("eventLogLevel(%+v) = %s", c.ev, got)
		}
	}
}
