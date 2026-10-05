package tasks

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
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const testAgent = "AGENTEDETESTE"

type fakeServer struct {
	tasks   map[int]any
	mu      sync.Mutex
	patches map[int]json.RawMessage
	fails   int32 // PATCH com 502 antes de aceitar
	srv     *httptest.Server
}

func newFakeServer(t *testing.T, tasks map[int]any) *fakeServer {
	f := &fakeServer{tasks: tasks, patches: map[int]json.RawMessage{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeServer) handle(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	// api/v3/{pk}/{agent_id}/taskrunner
	if len(parts) != 5 || parts[0] != "api" || parts[1] != "v3" || parts[3] != testAgent || parts[4] != "taskrunner" || !strings.HasSuffix(r.URL.Path, "/") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	var pk int
	_ = json.Unmarshal([]byte(parts[2]), &pk)
	switch r.Method {
	case http.MethodGet:
		task, ok := f.tasks[pk]
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`""`))
			return
		}
		_ = json.NewEncoder(w).Encode(task)
	case http.MethodPatch:
		if atomic.AddInt32(&f.fails, -1) >= 0 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		data, _ := io.ReadAll(r.Body)
		// Mesma leitura do servidor: stdout/stderr precisam ser string (bug 4), retcode inteiro.
		var body map[string]json.RawMessage
		if json.Unmarshal(data, &body) != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		for _, k := range []string{"stdout", "stderr"} {
			var s string
			if v, ok := body[k]; ok && json.Unmarshal(v, &s) != nil && string(v) != "null" {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		f.mu.Lock()
		f.patches[pk] = data
		f.mu.Unlock()
		_, _ = w.Write([]byte(`"ok"`))
	}
}

func (f *fakeServer) result(t *testing.T, pk int) (Result, map[string]any) {
	t.Helper()
	f.mu.Lock()
	data, ok := f.patches[pk]
	f.mu.Unlock()
	if !ok {
		t.Fatalf("tarefa %d sem PATCH", pk)
	}
	var r Result
	var m map[string]any
	if err := json.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(data, &m)
	return r, m
}

func (f *fakeServer) runner(t *testing.T) *Runner {
	c, err := api.New(f.srv.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	return NewRunner(c, testAgent, nil)
}

func stub[T any](t *testing.T, p *T, v T) {
	old := *p
	*p = v
	t.Cleanup(func() { *p = old })
}

func cmd(command string) map[string]any {
	return map[string]any{"type": "cmd", "command": command, "shell": "/bin/sh", "timeout": 30}
}

func needShell(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("sem /bin/sh")
	}
}

func TestStopsOnFirstFailure(t *testing.T) {
	needShell(t)
	f := newFakeServer(t, map[int]any{7: map[string]any{"id": 7, "continue_on_error": false, "enabled": true,
		"task_actions": []any{cmd("echo um"), cmd("echo falhou >&2; exit 3"), cmd("echo tres")}}})
	if err := f.runner(t).Run(context.Background(), 7); err != nil {
		t.Fatal(err)
	}
	r, m := f.result(t, 7)
	if r.Retcode != 3 {
		t.Errorf("retcode = %d", r.Retcode)
	}
	if !strings.Contains(r.Stdout, "=== Acao 1/3") || !strings.Contains(r.Stdout, "um") || strings.Contains(r.Stdout, "tres") {
		t.Errorf("stdout = %q", r.Stdout)
	}
	if !strings.Contains(r.Stderr, "falhou") || !strings.Contains(r.Stderr, "1 acao(oes) nao executada(s)") {
		t.Errorf("stderr = %q", r.Stderr)
	}
	if _, ok := m["execution_time"].(float64); !ok {
		t.Errorf("execution_time ausente: %v", m)
	}
	if _, ok := m["stdout"].(string); !ok {
		t.Error("stdout precisa ser string")
	}
}

func TestContinueOnErrorKeepsLastFailure(t *testing.T) {
	needShell(t)
	f := newFakeServer(t, map[int]any{8: map[string]any{"id": 8, "continue_on_error": true, "enabled": true,
		"task_actions": []any{cmd("exit 4"), cmd("echo dois"), cmd("exit 5"), cmd("echo quatro")}}})
	if err := f.runner(t).Run(context.Background(), 8); err != nil {
		t.Fatal(err)
	}
	r, _ := f.result(t, 8)
	if r.Retcode != 5 || !strings.Contains(r.Stdout, "quatro") || !strings.Contains(r.Stdout, "=== Acao 4/4") {
		t.Errorf("resultado = %+v", r)
	}
}

func TestSingleActionAndDisabledTask(t *testing.T) {
	needShell(t)
	f := newFakeServer(t, map[int]any{9: map[string]any{"id": 9, "continue_on_error": false, "enabled": false,
		"task_actions": []any{cmd("echo ola")}}})
	if err := f.runner(t).Run(context.Background(), 9); err != nil {
		t.Fatal(err)
	}
	r, _ := f.result(t, 9)
	if r.Retcode != 0 || r.Stdout != "ola" || r.Stderr != "" {
		t.Errorf("resultado = %+v", r)
	}
}

func TestScriptActionSpec(t *testing.T) {
	var got execx.ScriptSpec
	stub(t, &runScript, func(_ context.Context, s execx.ScriptSpec) execx.Result {
		got = s
		return execx.Result{Stdout: "feito", ExitCode: 0, Elapsed: 250 * time.Millisecond}
	})
	stub(t, &runCommand, func(_ context.Context, shell, command string, timeout time.Duration, asUser bool) execx.Result {
		if shell != "powershell" || command != "Get-Date" || timeout != 90*time.Second || asUser {
			t.Errorf("cmd inesperado: %s %s %v %v", shell, command, timeout, asUser)
		}
		return execx.Result{Stdout: "data", Elapsed: 750 * time.Millisecond}
	})
	f := newFakeServer(t, map[int]any{10: map[string]any{"id": 10, "continue_on_error": false, "enabled": true,
		"task_actions": []any{
			map[string]any{"type": "cmd", "command": "Get-Date", "shell": "powershell", "timeout": 90},
			map[string]any{"type": "script", "script_name": "Limpeza", "code": "Write-Output 1", "script_args": []string{"-Force", "x"},
				"shell": "PowerShell", "timeout": 120, "run_as_user": true, "env_vars": []string{"A=1"},
				"nushell_enable_config": false, "deno_default_permissions": ""},
		}}})
	if err := f.runner(t).Run(context.Background(), 10); err != nil {
		t.Fatal(err)
	}
	if got.Shell != "powershell" || got.Body != "Write-Output 1" || strings.Join(got.Args, " ") != "-Force x" ||
		strings.Join(got.Env, ",") != "A=1" || got.Timeout != 120*time.Second || !got.AsUser {
		t.Errorf("spec = %+v", got)
	}
	r, _ := f.result(t, 10)
	if r.ExecutionTime != 1 || r.Retcode != 0 || !strings.Contains(r.Stdout, "=== Acao 2/2: script Limpeza") {
		t.Errorf("resultado = %+v", r)
	}
}

func TestActionErrors(t *testing.T) {
	stub(t, &runScript, func(context.Context, execx.ScriptSpec) execx.Result {
		return execx.Result{ExitCode: 1, Err: errors.New("tipo de script nao suportado: cobol")}
	})
	f := newFakeServer(t, map[int]any{11: map[string]any{"id": 11, "continue_on_error": true, "enabled": true,
		"task_actions": []any{
			map[string]any{"type": "script", "code": "x", "shell": "cobol", "timeout": 5},
			map[string]any{"type": "estranho"},
			"nao e mapa",
			map[string]any{"type": "cmd", "command": "", "shell": "/bin/sh"},
		}}})
	if err := f.runner(t).Run(context.Background(), 11); err != nil {
		t.Fatal(err)
	}
	r, _ := f.result(t, 11)
	if r.Retcode != 1 || !strings.Contains(r.Stderr, "cobol") || !strings.Contains(r.Stderr, "desconhecido") || !strings.Contains(r.Stderr, "sem comando") {
		t.Errorf("resultado = %+v", r)
	}
}

func TestEmptyTaskAndUnknownTask(t *testing.T) {
	f := newFakeServer(t, map[int]any{12: map[string]any{"id": 12, "continue_on_error": false, "enabled": true, "task_actions": []any{}}})
	r := f.runner(t)
	if err := r.Run(context.Background(), 12); err != nil {
		t.Fatal(err)
	}
	res, _ := f.result(t, 12)
	if res.Retcode != 0 || res.Stderr == "" {
		t.Errorf("tarefa vazia = %+v", res)
	}
	if err := r.Run(context.Background(), 99); err == nil || !api.IsStatus(errors.Unwrap(err), http.StatusBadRequest) {
		t.Errorf("tarefa desconhecida: %v", err)
	}
	f.mu.Lock()
	_, sent := f.patches[99]
	f.mu.Unlock()
	if sent {
		t.Error("tarefa desconhecida nao deve gerar PATCH")
	}
}

func TestPatchRetry(t *testing.T) {
	stub(t, &patchRetries, []time.Duration{time.Millisecond, time.Millisecond})
	stub(t, &runCommand, func(context.Context, string, string, time.Duration, bool) execx.Result { return execx.Result{} })
	f := newFakeServer(t, map[int]any{13: map[string]any{"id": 13, "enabled": true, "task_actions": []any{cmd("true")}}})
	f.fails = 2
	if err := f.runner(t).Run(context.Background(), 13); err != nil {
		t.Fatal(err)
	}
	f.result(t, 13)
}

func TestNoConcurrentSameTask(t *testing.T) {
	release := make(chan struct{})
	var runs int32
	stub(t, &runCommand, func(context.Context, string, string, time.Duration, bool) execx.Result {
		atomic.AddInt32(&runs, 1)
		<-release
		return execx.Result{}
	})
	f := newFakeServer(t, map[int]any{14: map[string]any{"id": 14, "enabled": true, "task_actions": []any{cmd("x")}}})
	r := f.runner(t)
	done := make(chan error, 1)
	go func() { done <- r.Run(context.Background(), 14) }()
	for atomic.LoadInt32(&runs) == 0 {
		time.Sleep(time.Millisecond)
	}
	if err := r.Run(context.Background(), 14); !errors.Is(err, ErrRunning) {
		t.Errorf("segunda execucao = %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if runs != 1 {
		t.Errorf("execucoes = %d", runs)
	}
}

func TestTaskPK(t *testing.T) {
	if taskPK(rpc.Request{"func": "runtask", "taskpk": int8(5)}) != 5 {
		t.Error("taskpk int8")
	}
	if taskPK(rpc.Request{"func": "runtask", "payload": map[string]any{"taskpk": "6"}}) != 6 {
		t.Error("taskpk no payload")
	}
	if taskPK(rpc.Request{"func": "runtask"}) != 0 {
		t.Error("sem taskpk")
	}
}
