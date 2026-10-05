package actions

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/winevt"
	"github.com/pauloacruz/cybereyes/agent/internal/winsys"
)

// wire codifica como o bus (tags json, inteiros compactos) e decodifica de volta.
func wire(t *testing.T, v any) any {
	t.Helper()
	var buf bytes.Buffer
	enc := msgpack.NewEncoder(&buf)
	enc.SetCustomStructTag("json")
	enc.UseCompactInts(true)
	if err := enc.Encode(v); err != nil {
		t.Fatalf("encode: %v", err)
	}
	var out any
	if err := msgpack.Unmarshal(buf.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func wireMap(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := wire(t, v).(map[string]any)
	if !ok {
		t.Fatalf("nao e mapa: %#v", v)
	}
	return m
}

func isInt(v any) bool {
	switch v.(type) {
	case int8, int16, int32, int64, uint8, uint16, uint32, uint64:
		return true
	}
	return false
}

func TestRawShell(t *testing.T) {
	ok := []struct{ goos, in, want string }{
		{"windows", "cmd", "cmd"},
		{"windows", "PowerShell", "powershell"},
		{"windows", "", "cmd"},
		{"linux", "/bin/bash", "/bin/bash"},
		{"linux", "/bin/sh", "/bin/sh"},
		{"darwin", "/bin/zsh", "/bin/zsh"},
		{"linux", "", "/bin/bash"},
	}
	for _, c := range ok {
		if got, err := rawShell(c.goos, c.in); err != nil || got != c.want {
			t.Errorf("rawShell(%s, %q) = %q, %v", c.goos, c.in, got, err)
		}
	}
	bad := [][2]string{{"windows", "/bin/bash"}, {"windows", "pwsh"}, {"linux", "cmd"}, {"linux", "bash"}, {"darwin", "/usr/bin/fish"}}
	for _, c := range bad {
		if _, err := rawShell(c[0], c[1]); err == nil {
			t.Errorf("rawShell(%s, %q) deveria falhar", c[0], c[1])
		}
	}
}

func TestScriptShell(t *testing.T) {
	for _, s := range []string{"powershell", "cmd", "python", "nushell", "deno"} {
		if got, err := scriptShell("windows", s); err != nil || got != s {
			t.Errorf("scriptShell(windows, %s) = %q %v", s, got, err)
		}
	}
	if got, err := scriptShell("linux", "Shell"); err != nil || got != "shell" {
		t.Errorf("shell no linux: %q %v", got, err)
	}
	if _, err := scriptShell("windows", "shell"); err == nil {
		t.Error("shell no Windows deveria falhar")
	}
	if _, err := scriptShell("linux", "ruby"); err == nil {
		t.Error("ruby deveria falhar")
	}
}

func TestEnvVarsAndTimeouts(t *testing.T) {
	got := envVars([]string{"A=1", "B=", "=x", "SEMIGUAL", " =y", "C=a=b"})
	if strings.Join(got, "|") != "A=1|B=|C=a=b" {
		t.Errorf("envVars = %q", got)
	}
	if killAt(30, time.Second) != 29*time.Second || killAt(1, time.Second) != time.Second {
		t.Error("killAt")
	}
	if timeoutSeconds(rpc.Request{"timeout": int8(15)}, 30, 3600) != 15 ||
		timeoutSeconds(rpc.Request{}, 30, 3600) != 30 ||
		timeoutSeconds(rpc.Request{"timeout": uint32(99999)}, 30, 3600) != 3600 {
		t.Error("timeoutSeconds")
	}
}

func TestCPU(t *testing.T) {
	if p := cpuPercent(500*time.Millisecond, time.Second, 2); math.Abs(p-25) > 1e-9 {
		t.Errorf("cpuPercent = %v", p)
	}
	if cpuPercent(time.Second, 0, 4) != 0 || cpuPercent(10*time.Second, time.Second, 1) != 100 {
		t.Error("limites do cpuPercent")
	}
	for in, want := range map[float64]string{1.54: "1.5", 0: "0.0", 100: "100.0", math.NaN(): "0.0", math.Inf(1): "0.0", -3: "0.0"} {
		if got := formatCPU(in); got != want {
			t.Errorf("formatCPU(%v) = %q", in, got)
		}
	}
	first := procTimes{1: time.Second, 2: 5 * time.Second}
	second := procTimes{1: 2 * time.Second, 2: 4 * time.Second, 3: time.Second}
	if usage(2, first, second, time.Second) != "0.0" || usage(3, first, second, time.Second) != "0.0" {
		t.Error("usage com tempo decrescente ou processo novo deve ser 0")
	}
}

func TestParsePS(t *testing.T) {
	out := `    1  12345   1:02.50 root             /sbin/launchd
  321    100   0:00.03 joao             /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  400      0   1-02:03:04 _windowserver  WindowServer
 lixo
`
	rows := parsePS(out)
	if len(rows) != 3 {
		t.Fatalf("linhas: %+v", rows)
	}
	if rows[0].pid != 1 || rows[0].rssKiB != 12345 || rows[0].name != "launchd" || rows[0].user != "root" || rows[0].cpu != 62500*time.Millisecond {
		t.Errorf("linha 1: %+v", rows[0])
	}
	if rows[1].name != "Google Chrome" || rows[1].cpu != 30*time.Millisecond {
		t.Errorf("linha 2: %+v", rows[1])
	}
	if rows[2].cpu != (26*3600+3*60+4)*time.Second {
		t.Errorf("linha 3: %+v", rows[2])
	}
	if parseCPUTime("x:1") != 0 || parseCPUTime("1:2:3:4") != 0 || parseCPUTime("05") != 5*time.Second {
		t.Error("parseCPUTime")
	}
}

func TestEventShape(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	items := eventItems([]winevt.Event{
		{Source: "Service Control Manager", EventID: 7036, Type: "CRITICAL", Message: "m", Time: ts},
		{Source: "x", EventID: 4624, Type: "AUDIT_SUCCESS"},
	})
	list, ok := wire(t, items).([]any)
	if !ok || len(list) != 2 {
		t.Fatalf("lista: %#v", list)
	}
	m := list[0].(map[string]any)
	if m["eventType"] != "ERROR" || !isInt(m["eventID"]) || m["source"] != "Service Control Manager" || m["time"] != "2026-01-02T03:04:05Z" || m["message"] != "m" {
		t.Errorf("evento: %#v", m)
	}
	if list[1].(map[string]any)["eventType"] != "AUDIT_SUCCESS" || list[1].(map[string]any)["time"] != "" {
		t.Errorf("evento 2: %#v", list[1])
	}
	if eventType("information") != "INFO" || eventType("warning") != "WARNING" || eventType("AUDIT_FAILURE") != "AUDIT_FAILURE" {
		t.Error("eventType")
	}
	if eventDays("7") != 7 || eventDays("") != 1 || eventDays("99") != 30 || eventDays("-2") != 1 {
		t.Error("eventDays")
	}
}

func TestReplyShapes(t *testing.T) {
	p := wireMap(t, Proc{PID: 42, Name: "a", Username: "u", MemBytes: 1 << 40, CPUPercent: "1.5"})
	if _, ok := p["cpu_percent"].(string); !ok || !isInt(p["pid"]) || !isInt(p["membytes"]) || p["name"] != "a" || p["username"] != "u" {
		t.Errorf("procs: %#v", p)
	}
	s := wireMap(t, NewScriptResult(execx.Result{Stdout: "o", Stderr: "e", ExitCode: 3, Elapsed: 1234567 * time.Microsecond}))
	if s["stdout"] != "o" || s["stderr"] != "e" || !isInt(s["retcode"]) || s["execution_time"] != 1.235 {
		t.Errorf("runscriptfull: %#v", s)
	}
	z := wireMap(t, NewScriptResult(execx.Result{}))
	if _, ok := z["execution_time"].(float64); !ok {
		t.Errorf("execution_time precisa ser numero: %#v", z["execution_time"])
	}
	r := wireMap(t, svcResult(errors.New("falhou")))
	if r["success"] != false || r["errormsg"] != "falhou" {
		t.Errorf("svc erro: %#v", r)
	}
	r = wireMap(t, svcResult(nil))
	if r["success"] != true || r["errormsg"] != "" {
		t.Errorf("svc ok: %#v", r)
	}
	if wireMap(t, svcResult(winsys.ErrServiceNotFound))["errormsg"] != "servico nao encontrado" {
		t.Error("svc nao encontrado")
	}
	l := wireMap(t, winsys.RootListing())
	sub := l["subkeys"].([]any)[0].(map[string]any)
	if _, ok := sub["hasSubkeys"]; !ok {
		t.Errorf("hasSubkeys: %#v", sub)
	}
	if _, ok := l["has_more"].(bool); !ok || l["path"] != "" {
		t.Errorf("listagem: %#v", l)
	}
	if _, ok := l["error"]; ok {
		t.Error("sucesso nao pode ter a chave error")
	}
	if vals, ok := l["values"].([]any); !ok || len(vals) != 0 {
		t.Errorf("values deve ser lista vazia: %#v", l["values"])
	}
	if wireMap(t, errMap("x"))["error"] != "x" {
		t.Error("errMap")
	}
	svc := wireMap(t, winsys.Service{Name: "n", AutoDelay: true, PID: 7})
	if svc["display_name"] != "" || svc["autodelay"] != true || !isInt(svc["pid"]) {
		t.Errorf("servico: %#v", svc)
	}
}

func TestRegPage(t *testing.T) {
	page, size := regPage(rpc.Request{"page": "3", "page_size": "200"})
	if page != 3 || size != 200 {
		t.Errorf("regPage = %d %d", page, size)
	}
	page, size = regPage(rpc.Request{"page": "x", "page_size": "99999"})
	if page != 1 || size != regMaxPageSize {
		t.Errorf("regPage invalido = %d %d", page, size)
	}
}

func TestGuard(t *testing.T) {
	v, err := guard(context.Background(), time.Second, func() int { return 7 })
	if v != 7 || err != nil {
		t.Fatalf("guard ok: %v %v", v, err)
	}
	_, err = guard(context.Background(), 20*time.Millisecond, func() int { time.Sleep(time.Second); return 1 })
	if err != errGuardTimeout {
		t.Fatalf("guard timeout: %v", err)
	}
	_, err = guard(context.Background(), time.Second, func() int { panic("boom") })
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("guard panic: %v", err)
	}
}

func TestHandlersUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("teste de Unix")
	}
	t.Setenv("EYES_DATA_DIR", t.TempDir())
	h := &handlers{}
	ctx := context.Background()
	out := h.rawcmd(ctx, rpc.Request{"timeout": int8(10), "payload": map[string]any{"command": "echo ola; echo erro >&2", "shell": "/bin/sh"}})
	if s, ok := out.(string); !ok || s != "ola\nerro" {
		t.Errorf("rawcmd = %#v", out)
	}
	if s := h.rawcmd(ctx, rpc.Request{"payload": map[string]any{"command": "echo", "shell": "cmd"}}).(string); !strings.HasPrefix(s, "error: shell nao suportado") {
		t.Errorf("rawcmd shell invalido = %q", s)
	}
	res, ok := h.runscript(ctx, rpc.Request{
		"timeout":     int8(10),
		"script_args": []any{"x y", "z"},
		"env_vars":    []any{"EYES_T=valor"},
		"payload":     map[string]any{"code": "#!/bin/sh\necho \"$1|$2|$EYES_T\"\nexit 3\n", "shell": "shell"},
	}).(ScriptResult)
	if !ok || res.Stdout != "x y|z|valor" || res.Retcode != 3 || res.ExecutionTime < 0 {
		t.Errorf("runscriptfull = %#v", res)
	}
	if res := h.runscript(ctx, rpc.Request{"payload": map[string]any{"code": "x", "shell": "ruby"}}).(ScriptResult); res.Retcode != 1 || res.Stderr == "" {
		t.Errorf("runscriptfull shell invalido = %#v", res)
	}

	list, ok := h.procs(ctx, rpc.Request{}).([]Proc)
	if !ok || len(list) == 0 {
		t.Fatalf("procs = %#v", list)
	}
	found := false
	for _, p := range list {
		if p.PID == os.Getpid() {
			found = p.Name != "" && p.MemBytes > 0 && p.CPUPercent != ""
		}
	}
	if !found {
		t.Error("procs nao trouxe o proprio processo completo")
	}

	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Skip("sleep indisponivel")
	}
	if got := h.killproc(ctx, rpc.Request{"procpid": cmd.Process.Pid}); got != "ok" {
		t.Errorf("killproc = %#v", got)
	}
	_ = cmd.Wait()
	if got := h.killproc(ctx, rpc.Request{"procpid": 0}); got == "ok" {
		t.Error("killproc pid 0 deveria falhar")
	}

	// Recursos do Windows respondem com o formato de erro de cada comando.
	if s, ok := h.winservices(ctx, rpc.Request{}).(string); !ok || !strings.HasPrefix(s, "error: ") {
		t.Errorf("winservices fora do Windows = %#v", s)
	}
	if r := h.winsvcaction(ctx, rpc.Request{"payload": map[string]any{"name": "x", "action": "start"}}).(SvcResult); r.Success || r.ErrorMsg == "" {
		t.Errorf("winsvcaction fora do Windows = %#v", r)
	}
	if m, ok := h.registryBrowse(ctx, rpc.Request{"payload": map[string]any{"path": "computer"}}).(map[string]any); !ok || m["error"] == "" {
		t.Errorf("registry_browse fora do Windows = %#v", m)
	}
	for name, fn := range h.registryWriters() {
		if m, ok := fn(ctx, rpc.Request{"payload": map[string]any{"path": `HKLM\x`}}).(map[string]any); !ok || m["error"] == nil {
			t.Errorf("%s fora do Windows = %#v", name, m)
		}
	}
	if s, ok := h.eventlog(ctx, rpc.Request{"payload": map[string]any{"logname": "System", "days": "1"}}).(string); !ok || !strings.HasPrefix(s, "error: ") {
		t.Errorf("eventlog fora do Windows = %#v", s)
	}
}

func TestRawcmdTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("teste de Unix")
	}
	h := &handlers{}
	start := time.Now()
	out := h.rawcmd(context.Background(), rpc.Request{"timeout": int8(2), "payload": map[string]any{"command": "echo parcial; sleep 30", "shell": "/bin/sh"}})
	s, _ := out.(string)
	if s != "parcial\n[timeout apos 2 s]" || time.Since(start) > 4*time.Second {
		t.Errorf("rawcmd com timeout = %q em %s", s, time.Since(start))
	}
}
