package checks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
)

const testAgent = "AGENTEDETESTE"

// fakeServer implementa GET checkrunner/runchecks e PATCH checkrunner.
type fakeServer struct {
	t        *testing.T
	checks   []any
	interval any
	mu       sync.Mutex
	patches  map[int]map[string]any
	gets     []string
	srv      *httptest.Server
}

func newFakeServer(t *testing.T, checks []any) *fakeServer {
	f := &fakeServer{t: t, checks: checks, interval: 137, patches: map[int]map[string]any{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeServer) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Token tok" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodGet && (r.URL.Path == "/api/v3/"+testAgent+"/checkrunner/" || r.URL.Path == "/api/v3/"+testAgent+"/runchecks/"):
		f.mu.Lock()
		f.gets = append(f.gets, r.URL.Path)
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"agent": 12, "check_interval": f.interval, "checks": f.checks})
	case r.Method == http.MethodPatch && r.URL.Path == "/api/v3/checkrunner/":
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(data, &body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`"Invalid data"`))
			return
		}
		if _, ok := body["agent_id"]; !ok {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`"Agent upgrade required"`))
			return
		}
		id, ok := body["id"].(float64)
		if !ok || id != float64(int(id)) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`"Invalid data"`))
			return
		}
		f.mu.Lock()
		f.patches[int(id)] = body
		f.mu.Unlock()
		_, _ = w.Write([]byte(`"ok"`))
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"detail":"Not found."}`))
	}
}

func (f *fakeServer) patch(id int) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.patches[id]
}

func (f *fakeServer) runner(t *testing.T, s *Sampler) *Runner {
	c, err := api.New(f.srv.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	return NewRunner(c, testAgent, nil, s)
}

// fixedSampler devolve valores fixos sem tocar no sistema.
type fixedSource struct{ v float64 }

func (f fixedSource) next(context.Context) (float64, error) { return f.v, nil }

func fixedSampler(cpu, mem float64) *Sampler {
	s := NewSampler(time.Minute)
	s.src = fixedSource{cpu}
	s.mem = func() (float64, error) { return mem, nil }
	return s
}

// stub troca uma variavel do pacote e restaura no fim do teste.
func stub[T any](t *testing.T, p *T, v T) {
	old := *p
	*p = v
	t.Cleanup(func() { *p = old })
}

func baseCheck(id int, typ string) map[string]any {
	return map[string]any{
		"id": id, "agent": nil, "check_type": typ, "run_interval": 0, "alert_severity": "warning",
		"error_threshold": 10, "warning_threshold": 20, "disk": nil, "ip": nil, "script": nil,
		"script_args": []string{}, "env_vars": []string{}, "info_return_codes": []int{}, "warning_return_codes": []int{},
		"success_return_codes": []int{}, "timeout": 60, "svc_name": nil, "pass_if_start_pending": false,
		"pass_if_svc_not_exist": false, "restart_if_stopped": false, "log_name": nil, "event_id": 0,
		"event_id_is_wildcard": false, "event_type": nil, "event_source": "", "event_message": "",
		"fail_when": "contains", "search_last_days": 1, "number_of_events_b4_alert": 1, "managed_by_policy": false,
	}
}

func with(m map[string]any, kv ...any) map[string]any {
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	return m
}

func TestRunOnceSendsBodiesPerType(t *testing.T) {
	stub(t, &readDisk, func(name string) (diskUsage, error) {
		if name == "/" {
			return usageFrom(100<<30, 5<<30, 5<<30), nil
		}
		return diskUsage{}, errors.New("no such file or directory")
	})
	stub(t, &runScript, func(_ context.Context, s execx.ScriptSpec) execx.Result {
		if s.Shell != "shell" || s.Body != "exit 3" || strings.Join(s.Args, ",") != "-a,b" {
			t.Errorf("spec inesperada: %+v", s)
		}
		if strings.Join(s.Env, ",") != "A=1,B=2,A=3" || s.Timeout != 45*time.Second || s.AsUser {
			t.Errorf("env/timeout inesperados: %+v", s)
		}
		return execx.Result{Stdout: "saida", Stderr: "aviso", ExitCode: 3, Elapsed: 1500 * time.Millisecond}
	})
	stub(t, &icmpPing, func(_ context.Context, host string, _ time.Duration) (pingResult, error) {
		if host == "10.0.0.1" {
			return pingResult{Addr: host, Sent: 4, Recv: 0, Loss: 100}, nil
		}
		return pingResult{Addr: host, IP: "1.1.1.1", Sent: 4, Recv: 4, Avg: 10 * time.Millisecond}, nil
	})
	stub(t, &svcQuery, func(name string) (string, error) {
		if name == "Spooler" {
			return svcRunning, nil
		}
		return "", errNoService
	})
	now := time.Now()
	stub(t, &queryEvents, func(log string, since time.Time, _ int) ([]winevt.Event, error) {
		if log != "System" || since.After(now.Add(-23*time.Hour)) || since.Before(now.Add(-6*24*time.Hour)) {
			t.Errorf("consulta inesperada: %s %v", log, since)
		}
		return []winevt.Event{
			{Source: "Service Control Manager", EventID: 7031, Type: "ERROR", Message: "O servico X terminou inesperadamente", Time: now.Add(-time.Hour)},
			{Source: "Service Control Manager", EventID: 7036, Type: "INFO", Message: "O servico Y entrou em execucao", Time: now.Add(-time.Hour)},
			{Source: "Kernel-Power", EventID: 41, Type: "CRITICAL", Message: "reinicio inesperado", Time: now.Add(-2 * time.Hour)},
		}, nil
	})

	checks := []any{
		with(baseCheck(1, "diskspace"), "disk", "/"),
		with(baseCheck(2, "diskspace"), "disk", "/naoexiste"),
		baseCheck(3, "cpuload"),
		baseCheck(4, "memory"),
		with(baseCheck(5, "script"), "timeout", 45, "script_args", []string{"-a", "b"}, "env_vars", []string{"A=3"},
			"script", map[string]any{"code": "exit 3", "shell": "shell", "run_as_user": false, "env_vars": []string{"A=1", "B=2"}, "script_hash": ""}),
		with(baseCheck(6, "ping"), "ip", "8.8.8.8"),
		with(baseCheck(7, "ping"), "ip", "10.0.0.1"),
		with(baseCheck(8, "winsvc"), "svc_name", "Spooler"),
		with(baseCheck(9, "winsvc"), "svc_name", "NaoExiste", "pass_if_svc_not_exist", true),
		with(baseCheck(10, "eventlog"), "log_name", "System", "event_type", "ERROR", "event_source", "service control", "search_last_days", 5),
		with(baseCheck(11, "eventlog"), "log_name", "System", "event_id", 41, "event_type", nil),
		// Malformados: nao derrubam o laco.
		map[string]any{"check_type": "diskspace"},
		"texto",
		with(baseCheck(12, "desconhecido")),
		map[string]any{"id": "13", "check_type": "memory", "timeout": "x", "script": "nao e mapa", "script_args": 5},
	}
	f := newFakeServer(t, checks)
	r := f.runner(t, fixedSampler(37.456, 61.2))
	interval, err := r.RunOnce(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	r.Wait()
	if interval != 137*time.Second {
		t.Errorf("intervalo = %v", interval)
	}
	if f.gets[0] != "/api/v3/"+testAgent+"/runchecks/" {
		t.Errorf("rota = %s", f.gets[0])
	}

	expect := func(id int, want map[string]any) {
		t.Helper()
		got := f.patch(id)
		if got == nil {
			t.Errorf("check %d: sem PATCH", id)
			return
		}
		if got["agent_id"] != testAgent || got["id"] != float64(id) {
			t.Errorf("check %d: corpo comum errado: %v", id, got)
		}
		for k, v := range want {
			if gv := got[k]; !jsonEqual(gv, v) {
				t.Errorf("check %d: %s = %#v, esperado %#v", id, k, gv, v)
			}
		}
	}
	expect(1, map[string]any{"exists": true, "percent_used": 95.0})
	if mi, _ := f.patch(1)["more_info"].(string); !strings.Contains(mi, "Total: 100 GB") || !strings.Contains(mi, "Livre: 5 GB") {
		t.Errorf("more_info = %q", mi)
	}
	expect(2, map[string]any{"exists": false})
	expect(3, map[string]any{"percent": 37.46})
	expect(4, map[string]any{"percent": 61.2})
	expect(5, map[string]any{"retcode": 3, "stdout": "saida", "stderr": "aviso", "runtime": 1.5})
	if _, ok := f.patch(5)["execution_time"]; ok {
		t.Error("check script deve usar runtime, nao execution_time")
	}
	expect(6, map[string]any{"status": "passing"})
	expect(7, map[string]any{"status": "failing"})
	if out, _ := f.patch(6)["output"].(string); !strings.Contains(out, "4 recebidos") {
		t.Errorf("output do ping = %q", out)
	}
	expect(8, map[string]any{"status": "passing"})
	expect(9, map[string]any{"status": "passing"})
	expect(13, map[string]any{"percent": 61.2})

	log10, _ := f.patch(10)["log"].([]any)
	if len(log10) != 1 {
		t.Fatalf("eventlog 10: %d itens, esperado 1: %v", len(log10), f.patch(10))
	}
	item := log10[0].(map[string]any)
	for _, k := range []string{"source", "eventType", "eventID", "message", "time"} {
		if _, ok := item[k]; !ok {
			t.Errorf("item do log sem %s: %v", k, item)
		}
	}
	if item["eventID"] != float64(7031) {
		t.Errorf("eventID = %v", item["eventID"])
	}
	log11, _ := f.patch(11)["log"].([]any)
	if len(log11) != 1 {
		t.Errorf("eventlog 11: %d itens, esperado 1", len(log11))
	}
	if f.patch(12) != nil {
		t.Error("tipo desconhecido nao deve ser enviado")
	}
}

func jsonEqual(a, b any) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

func TestEventLogEmptyListIsSent(t *testing.T) {
	stub(t, &queryEvents, func(string, time.Time, int) ([]winevt.Event, error) { return nil, nil })
	body, err := eventLogCheck(Check{LogName: "Application", SearchLastDays: 1}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(body)
	if string(data) != `{"log":[]}` {
		t.Errorf("corpo = %s", data)
	}
	stub(t, &queryEvents, func(string, time.Time, int) ([]winevt.Event, error) { return nil, winevt.ErrUnsupported })
	if _, err := eventLogCheck(Check{LogName: "Application"}, time.Now()); !errors.Is(err, errSkip) {
		t.Errorf("sem suporte deveria ignorar: %v", err)
	}
}

func TestEventMatches(t *testing.T) {
	now := time.Now()
	since := now.Add(-24 * time.Hour)
	ev := winevt.Event{Source: "Microsoft-Windows-Kernel-Power", EventID: 41, Type: "CRITICAL", Message: "O sistema reiniciou", Time: now}
	cases := []struct {
		name string
		c    Check
		want bool
	}{
		{"sem filtro", Check{}, true},
		{"id igual", Check{EventID: 41}, true},
		{"id diferente", Check{EventID: 42}, false},
		{"curinga ignora id", Check{EventID: 42, EventIDWildcard: true}, true},
		{"ERROR inclui CRITICAL", Check{EventType: "ERROR"}, true},
		{"WARNING", Check{EventType: "WARNING"}, false},
		{"origem contida", Check{EventSource: "kernel-power"}, true},
		{"origem diferente", Check{EventSource: "Disk"}, false},
		{"mensagem contida", Check{EventMessage: "REINICIOU"}, true},
		{"mensagem ausente", Check{EventMessage: "desligou"}, false},
	}
	for _, tc := range cases {
		if got := eventMatches(tc.c, ev, since); got != tc.want {
			t.Errorf("%s: %v, esperado %v", tc.name, got, tc.want)
		}
	}
	old := ev
	old.Time = now.Add(-48 * time.Hour)
	if eventMatches(Check{}, old, since) {
		t.Error("evento fora da janela casou")
	}
	if !typeMatches("AUDIT_FAILURE", winevt.Event{Type: "audit failure"}) || !typeMatches("INFO", winevt.Event{Type: "Information"}) {
		t.Error("normalizacao de tipo falhou")
	}
}

func TestWinSvcDecision(t *testing.T) {
	stub(t, &svcPoll, time.Millisecond)
	type tc struct {
		name    string
		state   string
		err     error
		c       Check
		start   error
		after   string
		want    string
		started bool
	}
	cases := []tc{
		{name: "rodando", state: svcRunning, want: statusPassing},
		{name: "parado", state: svcStopped, want: statusFailing},
		{name: "iniciando sem opcao", state: svcStartPending, want: statusFailing},
		{name: "iniciando com opcao", state: svcStartPending, c: Check{PassIfStartPending: true}, want: statusPassing},
		{name: "inexistente", err: errNoService, want: statusFailing},
		{name: "inexistente permitido", err: errNoService, c: Check{PassIfSvcNotExist: true}, want: statusPassing},
		{name: "reinicia com sucesso", state: svcStopped, c: Check{RestartIfStopped: true}, after: svcRunning, want: statusPassing, started: true},
		{name: "reinicia e falha", state: svcStopped, c: Check{RestartIfStopped: true}, start: errors.New("acesso negado"), want: statusFailing, started: true},
		{name: "reinicia e volta a parar", state: svcStopped, c: Check{RestartIfStopped: true}, after: svcStopped, want: statusFailing, started: true},
		{name: "pausado nao reinicia", state: svcPaused, c: Check{RestartIfStopped: true}, want: statusFailing},
		{name: "erro de consulta", err: errors.New("rpc"), want: statusFailing},
	}
	for _, x := range cases {
		started := false
		stub(t, &svcQuery, func(string) (string, error) {
			if started && x.after != "" {
				return x.after, nil
			}
			return x.state, x.err
		})
		stub(t, &svcStart, func(string) error { started = true; return x.start })
		c := x.c
		c.SvcName = "Svc"
		c.Timeout = time.Second
		body, err := winsvcCheck(context.Background(), c)
		if err != nil {
			t.Fatalf("%s: %v", x.name, err)
		}
		if body["status"] != x.want || started != x.started {
			t.Errorf("%s: status %v (iniciado %v), esperado %s (%v); more_info %v", x.name, body["status"], started, x.want, x.started, body["more_info"])
		}
		if mi, _ := body["more_info"].(string); mi == "" {
			t.Errorf("%s: more_info vazio", x.name)
		}
	}
}

func TestScriptCheckErrors(t *testing.T) {
	body := scriptCheck(context.Background(), Check{Timeout: time.Second})
	if body["retcode"] != 1 || body["stderr"] == "" {
		t.Errorf("sem script: %v", body)
	}
	stub(t, &runScript, func(context.Context, execx.ScriptSpec) execx.Result {
		return execx.Result{ExitCode: 0, Err: errors.New("python nao encontrado")}
	})
	body = scriptCheck(context.Background(), Check{Timeout: time.Second, Script: &ScriptInfo{Code: "print(1)", Shell: "python"}})
	if body["retcode"] != 1 || body["stderr"] != "python nao encontrado" {
		t.Errorf("falha ao iniciar: %v", body)
	}
	stub(t, &runScript, func(context.Context, execx.ScriptSpec) execx.Result {
		return execx.Result{ExitCode: 98, TimedOut: true, Stderr: "Tempo limite de 1s excedido"}
	})
	body = scriptCheck(context.Background(), Check{Timeout: time.Second, Script: &ScriptInfo{Code: "sleep 5", Shell: "shell"}})
	if body["retcode"] != 98 {
		t.Errorf("tempo limite: %v", body)
	}
}

func TestScriptCheckRealShell(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("sem /bin/sh")
	}
	t.Setenv("EYES_DATA_DIR", t.TempDir())
	body := scriptCheck(context.Background(), Check{Timeout: 10 * time.Second, ScriptArgs: []string{"x"},
		EnvVars: []string{"V=check"}, Script: &ScriptInfo{Code: "echo \"$1 $V\"\necho erro >&2\nexit 2", Shell: "shell", EnvVars: []string{"V=script"}}})
	if body["retcode"] != 2 || body["stdout"] != "x check" || body["stderr"] != "erro" {
		t.Errorf("script real: %v", body)
	}
}

func TestDiskUsage(t *testing.T) {
	u := usageFrom(1000, 300, 200)
	// usado 700, disponivel 200 -> 700/900 (como o df).
	if u.Used != 700 || u.Free != 200 || u.PercentUsed < 77.7 || u.PercentUsed > 77.8 {
		t.Errorf("uso = %+v", u)
	}
	if usageFrom(0, 0, 0).PercentUsed != 0 {
		t.Error("disco vazio")
	}
	real, err := platformDiskUsage("/")
	if err != nil || real.Total == 0 || real.PercentUsed <= 0 || real.PercentUsed > 100 {
		t.Errorf("disco raiz: %+v %v", real, err)
	}
	if _, err := platformDiskUsage("/caminho/que/nao/existe"); err == nil {
		t.Error("disco inexistente sem erro")
	}
	body := diskCheck(Check{})
	if body["exists"] != false {
		t.Errorf("sem disco: %v", body)
	}
	if humanBytes(5<<30) != "5 GB" || humanBytes(1536) != "1.5 KB" || humanBytes(12) != "12 B" {
		t.Errorf("humanBytes: %s %s %s", humanBytes(5<<30), humanBytes(1536), humanBytes(12))
	}
}

func TestCPUPercent(t *testing.T) {
	p, err := cpuPercent(cpuTimes{Idle: 100, Total: 200}, cpuTimes{Idle: 175, Total: 300})
	if err != nil || p != 25 {
		t.Errorf("cpu = %v %v", p, err)
	}
	if _, err := cpuPercent(cpuTimes{Total: 10}, cpuTimes{Total: 10}); err == nil {
		t.Error("delta zero deveria falhar")
	}
	calls := 0
	src := &timesSource{read: func() (cpuTimes, error) {
		calls++
		return cpuTimes{Idle: float64(calls * 50), Total: float64(calls * 100)}, nil
	}}
	p, err = src.next(context.Background())
	if err != nil || p != 50 || calls != 2 {
		t.Errorf("primeira amostra = %v %v (%d leituras)", p, err, calls)
	}
}

func TestSamplerFallbackAndFreshness(t *testing.T) {
	n := int32(0)
	s := NewSampler(time.Minute)
	s.src = sourceFunc(func(context.Context) (float64, error) { atomic.AddInt32(&n, 1); return 42, nil })
	s.mem = func() (float64, error) { return 0, errors.New("falhou") }
	for range 3 {
		if p, err := s.CPU(context.Background()); err != nil || p != 42 {
			t.Fatalf("cpu = %v %v", p, err)
		}
	}
	if atomic.LoadInt32(&n) != 1 {
		t.Errorf("amostra recente deveria ser reaproveitada: %d leituras", n)
	}
	if _, err := s.Memory(); err == nil {
		t.Error("memoria sem amostra deveria falhar")
	}
	s.mu.Lock()
	s.memV, s.memAt = 55, time.Now()
	s.mu.Unlock()
	if p, err := s.Memory(); err != nil || p != 55 {
		t.Errorf("memoria cacheada = %v %v", p, err)
	}
}

type sourceFunc func(context.Context) (float64, error)

func (f sourceFunc) next(ctx context.Context) (float64, error) { return f(ctx) }

func TestDeduplicatesRunningCheck(t *testing.T) {
	release := make(chan struct{})
	var runs int32
	stub(t, &runScript, func(context.Context, execx.ScriptSpec) execx.Result {
		atomic.AddInt32(&runs, 1)
		<-release
		return execx.Result{}
	})
	f := newFakeServer(t, []any{with(baseCheck(1, "script"), "script", map[string]any{"code": "x", "shell": "shell"})})
	r := f.runner(t, fixedSampler(0, 0))
	for range 3 {
		if _, err := r.RunOnce(context.Background(), true); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	r.Wait()
	if runs != 1 {
		t.Errorf("check executado %d vezes", runs)
	}
}

func TestRecentlySentAndInterval(t *testing.T) {
	f := newFakeServer(t, []any{with(baseCheck(1, "memory"), "run_interval", 300), baseCheck(2, "memory")})
	f.interval = 2
	r := f.runner(t, fixedSampler(0, 10))
	interval, err := r.RunOnce(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	r.Wait()
	if interval != minInterval {
		t.Errorf("intervalo deveria ter piso de 15 s: %v", interval)
	}
	f.mu.Lock()
	f.patches = map[int]map[string]any{}
	f.mu.Unlock()
	if _, err := r.RunOnce(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	r.Wait()
	if f.patch(1) != nil {
		t.Error("check com run_interval 300 repetido logo em seguida")
	}
	if f.patch(2) == nil {
		t.Error("check sem run_interval proprio deveria seguir o servidor")
	}
	// runchecks executa todos, mesmo os recentes.
	if _, err := r.RunOnce(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	r.Wait()
	if f.patch(1) == nil {
		t.Error("runchecks deveria executar todos")
	}
}

func TestFetchErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"agent": 1, "check_interval": "x", "checks": [1, null, {"id": 5}]}`))
	}))
	defer srv.Close()
	c, _ := api.New(srv.URL, "tok", api.Options{})
	r := NewRunner(c, testAgent, nil, fixedSampler(0, 0))
	interval, list, err := r.fetch(context.Background(), false)
	if err != nil || interval != fallbackInterval || len(list) != 0 {
		t.Errorf("fetch tolerante: %v %v %v", interval, list, err)
	}
}
