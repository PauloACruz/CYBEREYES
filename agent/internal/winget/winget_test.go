package winget

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	Path string
	Body map[string]any
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
	r.calls = append(r.calls, call{Path: req.Method + " " + req.URL.Path, Body: body})
	r.mu.Unlock()
	_, _ = w.Write([]byte(`"ok"`))
}

type fakeSystem struct {
	present bool
	results []execx.Result
	runs    [][]string
}

func (f *fakeSystem) Find() (string, bool) {
	return `C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_1.0_x64__8wekyb3d8bbwe\winget.exe`, f.present
}

func (f *fakeSystem) Install(_ context.Context, _ string, args []string) execx.Result {
	f.runs = append(f.runs, args)
	if len(f.results) == 0 {
		return execx.Result{}
	}
	r := f.results[0]
	f.results = f.results[1:]
	return r
}

func run(t *testing.T, sys *fakeSystem, req map[string]any) []call {
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
	data, _ := msgpack.Marshal(req)
	var r rpc.Request
	if err := msgpack.Unmarshal(data, &r); err != nil {
		t.Fatal(err)
	}
	if out := reg.Dispatch(context.Background(), r); out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	return rec.calls
}

func TestValidID(t *testing.T) {
	for _, id := range []string{"Google.Chrome", "7zip.7zip", "Notepad++.Notepad++", "Microsoft.VisualStudioCode", "Git.Git"} {
		if !ValidID(id) {
			t.Errorf("%q deveria ser aceito", id)
		}
	}
	for _, id := range []string{"", "-h", "--force", ".x", "a b", "a;b", "a&b", "a|b", "a\"b", "$(x)", `a\b`, "a/b", "é", strings.Repeat("a", maxID+1)} {
		if ValidID(id) {
			t.Errorf("%q deveria ser recusado", id)
		}
	}
}

func TestArgsAndPath(t *testing.T) {
	want := []string{"install", "--id", "Git.Git", "--exact", "--source", "winget", "--silent", "--disable-interactivity",
		"--accept-package-agreements", "--accept-source-agreements", "--scope", "machine"}
	if got := installArgs("Git.Git", true); !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %v", got)
	}
	if got := installArgs("Git.Git", false); len(got) != len(want)-2 {
		t.Fatalf("sem escopo = %v", got)
	}
	if got := resultPath(agentID, 7); got != "/api/v4/AGENTE123/7/wingetresult/" {
		t.Fatalf("rota = %s", got)
	}
}

func TestFormatResult(t *testing.T) {
	cases := []struct {
		res  execx.Result
		want string
	}{
		{execx.Result{Stdout: "Successfully installed"}, "Successfully installed"},
		{execx.Result{}, "ok"},
		{execx.Result{Stdout: "x", ExitCode: int(int32(-1978335135))}, "x\n\nO pacote ja esta instalado."}, // 0x8A150061
		{execx.Result{Stdout: "x", ExitCode: 3010}, "x\n\nInstalado; reinicio necessario (codigo 3010)"},
		{execx.Result{Stdout: "falhou", ExitCode: 1}, "error: winget terminou com codigo 0x00000001\n\nfalhou"},
		{execx.Result{Err: errors.New("arquivo nao encontrado")}, "error: arquivo nao encontrado"},
	}
	for _, c := range cases {
		if got := formatResult(c.res); got != c.want {
			t.Errorf("formatResult(%+v) = %q, quer %q", c.res, got, c.want)
		}
	}
}

func TestCleanOutputDropsProgress(t *testing.T) {
	in := "Found Git [Git.Git]\r\n   -\r   \\\r   |\r\n  ██████▒▒▒  1 MB / 2 MB\r  ██████████  2 MB / 2 MB\r\nSuccessfully installed\r\n"
	if got := cleanOutput(in); got != "Found Git [Git.Git]\nSuccessfully installed" {
		t.Fatalf("saida = %q", got)
	}
}

func TestPickWingetPrefersNativeAndNewest(t *testing.T) {
	root := t.TempDir()
	mk := func(name string) string {
		d := filepath.Join(root, name)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(d, "winget.exe"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return d
	}
	old := mk("Microsoft.DesktopAppInstaller_1.21.3482.0_x64__8wekyb3d8bbwe")
	newer := mk("Microsoft.DesktopAppInstaller_1.22.10582.0_x64__8wekyb3d8bbwe")
	arm := mk("Microsoft.DesktopAppInstaller_1.23.0.0_arm64__8wekyb3d8bbwe")
	empty := filepath.Join(root, "Microsoft.DesktopAppInstaller_9.0.0.0_x64__8wekyb3d8bbwe")
	_ = os.MkdirAll(empty, 0o755) // sem winget.exe: ignorada
	dirs := []string{old, arm, empty, newer}
	if got := pickWinget(dirs, "amd64"); got != filepath.Join(newer, "winget.exe") {
		t.Fatalf("amd64 escolheu %s", got)
	}
	if got := pickWinget(dirs, "arm64"); got != filepath.Join(arm, "winget.exe") {
		t.Fatalf("arm64 escolheu %s", got)
	}
	if pickWinget(nil, "amd64") != "" {
		t.Fatal("sem pastas nao ha winget")
	}
}

func TestInstallRetriesWithoutMachineScope(t *testing.T) {
	sys := &fakeSystem{present: true, results: []execx.Result{
		{Stdout: "No applicable installer found", ExitCode: int(int32(-1978335212))}, // 0x8A150014
		{Stdout: "Successfully installed"},
	}}
	calls := run(t, sys, map[string]any{"func": "installwithwinget", "winget_id": "Spotify.Spotify", "pending_action_pk": 5})
	if len(sys.runs) != 2 || !reflect.DeepEqual(sys.runs[0][len(sys.runs[0])-2:], []string{"--scope", "machine"}) || sys.runs[1][len(sys.runs[1])-1] == "machine" {
		t.Fatalf("execucoes = %v", sys.runs)
	}
	if len(calls) != 1 || calls[0].Path != "PATCH /api/v4/AGENTE123/5/wingetresult/" || calls[0].Body["results"] != "Successfully installed" {
		t.Fatalf("chamadas = %+v", calls)
	}
}

func TestInstallWithoutWingetOrBadID(t *testing.T) {
	calls := run(t, &fakeSystem{}, map[string]any{"func": "installwithwinget", "winget_id": "Git.Git", "pending_action_pk": 3})
	if len(calls) != 1 || !strings.HasPrefix(calls[0].Body["results"].(string), "error: winget nao encontrado") {
		t.Fatalf("sem winget = %+v", calls)
	}
	sys := &fakeSystem{present: true}
	calls = run(t, sys, map[string]any{"func": "installwithwinget", "winget_id": "Git.Git & calc", "pending_action_pk": 4})
	if len(calls) != 1 || !strings.HasPrefix(calls[0].Body["results"].(string), "error: identificador de pacote invalido") || len(sys.runs) != 0 {
		t.Fatalf("id invalido = %+v, execucoes %v", calls, sys.runs)
	}
}
