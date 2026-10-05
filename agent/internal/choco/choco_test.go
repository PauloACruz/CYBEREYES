package choco

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const agentID = "AGENTE123"

type call struct {
	Method string
	Path   string
	Body   map[string]any
}

type recorder struct {
	mu    sync.Mutex
	calls []call
}

func (r *recorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	data, _ := io.ReadAll(req.Body)
	var body map[string]any
	_ = json.Unmarshal(data, &body)
	r.mu.Lock()
	r.calls = append(r.calls, call{Method: req.Method, Path: req.URL.Path, Body: body})
	r.mu.Unlock()
	_, _ = w.Write([]byte(`"ok"`))
}

func (r *recorder) all() []call {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]call(nil), r.calls...)
}

type fakeSystem struct {
	present     bool
	installWork bool
	installs    int
	packages    []string
	result      execx.Result
}

func (f *fakeSystem) Find() (string, bool) {
	if f.present {
		return `C:\ProgramData\chocolatey\bin\choco.exe`, true
	}
	return "", false
}

func (f *fakeSystem) InstallChoco(context.Context) execx.Result {
	f.installs++
	if f.installWork {
		f.present = true
		return execx.Result{}
	}
	return execx.Result{ExitCode: 1, Stderr: "falha de rede"}
}

func (f *fakeSystem) InstallPackage(_ context.Context, _ string, pkg string) execx.Result {
	f.packages = append(f.packages, pkg)
	return f.result
}

func newTestService(t *testing.T, sys system) (*service, *rpc.Registry, *recorder) {
	t.Helper()
	rec := &recorder{}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	client, err := api.New(srv.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	reg := rpc.NewRegistry(log)
	s := newService(&env.Env{Cfg: &config.Config{AgentID: agentID}, API: client, Reg: reg, Log: log, Ctx: context.Background()}, sys)
	s.spawn = func(_ string, fn func(context.Context)) { fn(context.Background()) }
	s.register(reg)
	return s, reg, rec
}

func decodeRequest(t *testing.T, m map[string]any) rpc.Request {
	t.Helper()
	data, err := msgpack.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var req rpc.Request
	if err := msgpack.Unmarshal(data, &req); err != nil {
		t.Fatal(err)
	}
	return req
}

func TestValidPackageName(t *testing.T) {
	ok := []string{"googlechrome", "7zip", "notepadplusplus.install", "vcredist-all", "dotnet_runtime", "Git"}
	bad := []string{"", "-force", ".hidden", "pkg name", "pkg;calc", "pkg&calc", "pkg|x", "a\"b", "a'b", "pkg`x",
		"$(calc)", "pkg/../x", `pkg\x`, "pkg\nx", "pacote-ç", strings.Repeat("a", maxPackageName+1)}
	for _, n := range ok {
		if !ValidPackageName(n) {
			t.Errorf("%q deveria ser aceito", n)
		}
	}
	for _, n := range bad {
		if ValidPackageName(n) {
			t.Errorf("%q deveria ser recusado", n)
		}
	}
}

func TestPackageArgsAndPath(t *testing.T) {
	if got := packageArgs("git"); !reflect.DeepEqual(got, []string{"install", "git", "-y", "--no-progress"}) {
		t.Fatalf("args = %v", got)
	}
	if got := resultPath(agentID, 42); got != "/api/v4/AGENTE123/42/chocoresult/" {
		t.Fatalf("rota = %s", got)
	}
}

func TestFormatResult(t *testing.T) {
	cases := []struct {
		res  execx.Result
		want string
	}{
		{execx.Result{Stdout: "instalado"}, "instalado"},
		{execx.Result{}, "ok"},
		{execx.Result{Stdout: "x", ExitCode: 3010}, "x\n\nInstalado; reinicio necessario (codigo 3010)"},
		{execx.Result{Stdout: "x", Stderr: "y", ExitCode: 1}, "x\ny\n\nerror: choco terminou com codigo 1"},
		{execx.Result{ExitCode: 1, Err: errors.New("arquivo nao encontrado")}, "error: arquivo nao encontrado"},
	}
	for _, c := range cases {
		if got := formatResult(c.res); got != c.want {
			t.Errorf("formatResult(%+v) = %q, quer %q", c.res, got, c.want)
		}
	}
	timed := formatResult(execx.Result{Stdout: "parcial", TimedOut: true, ExitCode: 98})
	if !strings.HasPrefix(timed, "parcial") || !strings.Contains(timed, "error: tempo limite") {
		t.Errorf("tempo limite = %q", timed)
	}
	big := formatResult(execx.Result{Stdout: strings.Repeat("a", maxResult+10) + "FIM"})
	if len(big) > maxResult+64 || !strings.HasSuffix(big, "FIM") {
		t.Errorf("saida grande nao foi cortada pelo inicio (%d bytes)", len(big))
	}
}

func TestInstallWithChoco(t *testing.T) {
	sys := &fakeSystem{installWork: true, result: execx.Result{Stdout: "Chocolatey installed 1/1 packages."}}
	_, reg, rec := newTestService(t, sys)
	// O servidor manda pending_action_pk como inteiro msgpack (pode chegar como int8/uint8...).
	req := decodeRequest(t, map[string]any{"func": "installwithchoco", "choco_prog_name": "googlechrome", "pending_action_pk": 7})
	if out := reg.Dispatch(context.Background(), req); out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	calls := rec.all()
	if len(calls) != 2 {
		t.Fatalf("chamadas = %+v", calls)
	}
	// O Chocolatey faltava: instala, informa installed:true e so entao instala o pacote.
	if c := calls[0]; c.Method != http.MethodPost || c.Path != "/api/v3/choco/" || c.Body["installed"] != true {
		t.Fatalf("POST choco = %+v", c)
	}
	if c := calls[1]; c.Method != http.MethodPatch || c.Path != "/api/v4/AGENTE123/7/chocoresult/" ||
		c.Body["results"] != "Chocolatey installed 1/1 packages." {
		t.Fatalf("PATCH chocoresult = %+v", c)
	}
	if sys.installs != 1 || !reflect.DeepEqual(sys.packages, []string{"googlechrome"}) {
		t.Fatalf("instalacoes = %d, pacotes = %v", sys.installs, sys.packages)
	}
}

func TestInstallWithChocoInvalidName(t *testing.T) {
	sys := &fakeSystem{present: true}
	_, reg, rec := newTestService(t, sys)
	reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installwithchoco", "choco_prog_name": "git & calc", "pending_action_pk": 9}))
	calls := rec.all()
	if len(calls) != 1 || calls[0].Path != "/api/v4/AGENTE123/9/chocoresult/" ||
		!strings.HasPrefix(calls[0].Body["results"].(string), "error: nome de pacote invalido") {
		t.Fatalf("chamadas = %+v", calls)
	}
	if len(sys.packages) != 0 {
		t.Fatal("nome invalido nao pode chegar ao choco")
	}
}

func TestInstallWithChocoMissingPK(t *testing.T) {
	_, reg, rec := newTestService(t, &fakeSystem{present: true})
	out := reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installwithchoco", "choco_prog_name": "git"}))
	if s, _ := out.(string); !strings.HasPrefix(s, "error:") || len(rec.all()) != 0 {
		t.Fatalf("resposta = %v, chamadas = %v", out, rec.all())
	}
}

func TestInstallWithChocoWhenInstallFails(t *testing.T) {
	sys := &fakeSystem{}
	_, reg, rec := newTestService(t, sys)
	reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installwithchoco", "choco_prog_name": "git", "pending_action_pk": 3}))
	calls := rec.all()
	if len(calls) != 1 || !strings.Contains(calls[0].Body["results"].(string), "Chocolatey nao esta instalado") || len(sys.packages) != 0 {
		t.Fatalf("chamadas = %+v", calls)
	}
}

func TestInstallChoco(t *testing.T) {
	sys := &fakeSystem{present: true}
	_, reg, rec := newTestService(t, sys)
	if out := reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installchoco"})); out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	calls := rec.all()
	// Ja instalado: nao roda o script e informa installed:true.
	if sys.installs != 0 || len(calls) != 1 || calls[0].Path != "/api/v3/choco/" || calls[0].Body["installed"] != true {
		t.Fatalf("instalacoes = %d, chamadas = %+v", sys.installs, calls)
	}

	sys2 := &fakeSystem{}
	_, reg2, rec2 := newTestService(t, sys2)
	reg2.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installchoco"}))
	if c := rec2.all(); sys2.installs != 1 || len(c) != 1 || c[0].Body["installed"] != false {
		t.Fatalf("falha deveria informar installed:false: %+v", c)
	}
}

func TestInstallChocoCoalesces(t *testing.T) {
	sys := &fakeSystem{present: true}
	s, _, rec := newTestService(t, sys)
	var queued []func(context.Context)
	s.spawn = func(_ string, fn func(context.Context)) { queued = append(queued, fn) }
	s.requestInstallChoco()
	s.requestInstallChoco()
	s.requestInstallChoco()
	if len(queued) != 1 {
		t.Fatalf("pedidos repetidos deveriam virar uma execucao, viraram %d", len(queued))
	}
	queued[0](context.Background())
	s.requestInstallChoco()
	if len(queued) != 2 || len(rec.all()) != 1 {
		t.Fatalf("depois do inicio um novo pedido deve ser aceito: %d, %d", len(queued), len(rec.all()))
	}
}

func TestInstallCommand(t *testing.T) {
	cmd := installCommand("")
	for _, want := range []string{"-bor 3072", "Set-ExecutionPolicy Bypass -Scope Process", "DownloadString('" + InstallScriptURL + "')"} {
		if !strings.Contains(cmd, want) {
			t.Fatalf("comando sem %q: %s", want, cmd)
		}
	}
	if strings.Contains(cmd, "Proxy") {
		t.Fatalf("sem proxy configurado: %s", cmd)
	}
	withProxy := installCommand("http://proxy:3128/'x")
	if !strings.Contains(withProxy, "$env:chocolateyProxyLocation='http://proxy:3128/''x'") {
		t.Fatalf("proxy mal escapado: %s", withProxy)
	}
}
