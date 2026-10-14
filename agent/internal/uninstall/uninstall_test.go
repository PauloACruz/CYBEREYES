package uninstall

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// ---------- maquina falsa ----------

type fakeHost struct {
	layout   Layout
	dirs     map[string][]dirEntry
	keys     map[string][]string
	values   map[string]map[string]string
	services []namedImage
	tasks    []namedImage
}

func lower(s string) string { return strings.ToLower(s) }

func newFakeHost() *fakeHost {
	h := &fakeHost{
		layout: Layout{
			SystemRoot:    `C:\Windows`,
			ProgramFiles:  []string{`C:\Program Files`, `C:\Program Files (x86)`},
			CommonFiles:   []string{`C:\Program Files\Common Files`},
			ProgramData:   `C:\ProgramData`,
			StartMenu:     `C:\ProgramData\Microsoft\Windows\Start Menu\Programs`,
			PublicDesktop: `C:\Users\Public\Desktop`,
			Profiles:      []string{`C:\Users\joao`},
			UserHives:     []string{"S-1-5-21-1-2-3-1001"},
			Own:           []string{`C:\Program Files\Cybereyes\EYES`, `C:\ProgramData\Cybereyes\EYES`},
		},
		dirs:   map[string][]dirEntry{},
		keys:   map[string][]string{},
		values: map[string]map[string]string{},
	}
	for _, r := range h.layout.fileRoots() {
		h.mkdir(r.Path)
	}
	for _, r := range h.layout.regRoots() {
		h.key(r)
	}
	return h
}

func split(p string) (string, string) {
	i := strings.LastIndex(p, `\`)
	return p[:i], p[i+1:]
}

func (h *fakeHost) addEntry(parent string, e dirEntry) {
	for _, x := range h.dirs[lower(parent)] {
		if strings.EqualFold(x.Name, e.Name) {
			return
		}
	}
	h.dirs[lower(parent)] = append(h.dirs[lower(parent)], e)
}

func (h *fakeHost) mkdir(p string) {
	if _, ok := h.dirs[lower(p)]; ok {
		return
	}
	h.dirs[lower(p)] = nil
	if parent, name := split(p); len(parent) > 2 {
		h.mkdir(parent)
		h.addEntry(parent, dirEntry{Name: name, Dir: true})
	}
}

func (h *fakeHost) file(p string) {
	parent, name := split(p)
	h.mkdir(parent)
	h.addEntry(parent, dirEntry{Name: name})
}

func (h *fakeHost) key(k string) {
	if _, ok := h.keys[lower(k)]; ok {
		return
	}
	h.keys[lower(k)] = nil
	if parent, name := split(k); strings.Contains(parent, `\`) {
		h.key(parent)
		h.keys[lower(parent)] = append(h.keys[lower(parent)], name)
	}
}

func (h *fakeHost) Layout() Layout { return h.layout }

func (h *fakeHost) ReadDir(dir string) ([]dirEntry, error) {
	e, ok := h.dirs[lower(dir)]
	if !ok {
		return nil, errors.New("nao existe")
	}
	return e, nil
}

func (h *fakeHost) IsDir(p string) bool { _, ok := h.dirs[lower(p)]; return ok }

func (h *fakeHost) DirSize(string) (uint64, int) { return 2048, 2 }

func (h *fakeHost) SubKeys(k string) ([]string, error) {
	s, ok := h.keys[lower(k)]
	if !ok {
		return nil, errors.New("nao existe")
	}
	return s, nil
}

func (h *fakeHost) KeyExists(k string) bool { _, ok := h.keys[lower(k)]; return ok }

func (h *fakeHost) StringValues(k string) (map[string]string, error) {
	v, ok := h.values[lower(k)]
	if !ok {
		return nil, errors.New("nao existe")
	}
	return v, nil
}

func (h *fakeHost) Services() []namedImage { return h.services }
func (h *fakeHost) Tasks() []namedImage    { return h.tasks }

const (
	firefoxKey = `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Mozilla Firefox 120.0 (x64 pt-BR)`
	firefoxDir = `C:\Program Files\Mozilla Firefox`
	runKey     = `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`
)

// firefoxHost simula sobras do Firefox ao lado de itens de outros programas e do Windows.
func firefoxHost() *fakeHost {
	h := newFakeHost()
	h.file(firefoxDir + `\updater.exe`)
	h.file(`C:\Program Files (x86)\Firefox Developer Edition\firefox.exe`)
	h.file(`C:\Program Files\VideoLAN\VLC\vlc.exe`)
	h.mkdir(`C:\ProgramData\Microsoft\Firefox`)
	h.file(`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Firefox.lnk`)
	h.file(`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\VLC media player.lnk`)
	h.file(`C:\Users\Public\Desktop\Firefox.lnk`)
	h.mkdir(`C:\Users\joao\AppData\Roaming\Mozilla\Firefox`)
	h.mkdir(`C:\Users\joao\AppData\Roaming\Mozilla\Extensions`)
	h.mkdir(`C:\Users\joao\AppData\Local\Mozilla\Firefox`)
	h.mkdir(`C:\Users\joao\Documents\Firefox`)
	h.key(firefoxKey)
	h.key(`HKLM\SOFTWARE\Mozilla\Mozilla Firefox`)
	h.key(`HKLM\SOFTWARE\Mozilla\Firefox`)
	h.key(`HKLM\SOFTWARE\Mozilla\Thunderbird`)
	h.key(`HKLM\SOFTWARE\Microsoft\Firefox`)
	h.key(`HKLM\SOFTWARE\Classes\Firefox`)
	h.key(`HKU\S-1-5-21-1-2-3-1001\Software\Mozilla\Firefox`)
	h.key(runKey)
	h.values[lower(runKey)] = map[string]string{
		"Updater": `"C:\Program Files\Mozilla Firefox\updater.exe" --background`,
		"Outro":   `C:\Program Files\Outro\outro.exe`,
	}
	h.services = []namedImage{
		{Name: "FirefoxHelper", Image: `"C:\Program Files\Mozilla Firefox\helper.exe"`},
		{Name: "Spooler", Image: `C:\Windows\System32\spoolsv.exe`},
		{Name: "Firefox", Image: `C:\Windows\System32\svchost.exe -k netsvcs`},
	}
	h.tasks = []namedImage{
		{Name: `\Mozilla\Firefox Default Browser Agent 308046B0AF4A39CB`, Image: `C:\Program Files\Mozilla Firefox\default-browser-agent.exe`},
		{Name: `\Microsoft\Windows\Firefox`, Image: `C:\Program Files\Mozilla Firefox\x.exe`},
	}
	return h
}

func firefoxTarget() Target {
	return Target{Name: "Mozilla Firefox (x64 pt-BR)", Version: "120.0", Publisher: "Mozilla", Key: firefoxKey, Dirs: []string{firefoxDir}}
}

type found struct{ kind, path, name, level string }

func summarize(list []Leftover) map[found]bool {
	out := map[found]bool{}
	for _, l := range list {
		out[found{l.Kind, l.Path, l.Name, l.Level}] = true
	}
	return out
}

// ---------- nomes ----------

func TestCleanName(t *testing.T) {
	cases := map[string]string{
		"Mozilla Firefox (x64 pt-BR)":         "Mozilla Firefox",
		"7-Zip 23.01 (x64)":                   "7-Zip",
		"Notepad++ (64-bit x64)":              "Notepad++",
		"Adobe Acrobat Reader DC - Português": "Adobe Acrobat Reader DC",
		"AnyDesk":                             "AnyDesk",
		"VLC media player":                    "VLC media player",
		"Foo v2.1.0 beta":                     "Foo",
		"Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33130": "Microsoft Visual C++ 2015-2022 Redistributable",
	}
	for in, want := range cases {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, quero %q", in, got, want)
		}
	}
	pubs := map[string]string{"Mozilla Corporation": "Mozilla", "Google LLC": "Google", "AnyDesk Software GmbH": "AnyDesk", "Igor Pavlov": "Igor Pavlov", "Notepad++ Team": "Notepad++", "Adobe Inc.": "Adobe"}
	for in, want := range pubs {
		if got := cleanPublisher(in); got != want {
			t.Errorf("cleanPublisher(%q) = %q, quero %q", in, got, want)
		}
	}
}

func TestNamesMatch(t *testing.T) {
	n := newNames("Mozilla Firefox (x64 pt-BR)", "Mozilla Corporation")
	if strings.Join(n.exact, ",") != "mozillafirefox,firefox" || !n.isPublisher("Mozilla") || !n.isPublisher("Mozilla Corporation") {
		t.Fatalf("variantes inesperadas: %+v", n)
	}
	checks := []struct {
		item string
		pub  bool
		mode Mode
		want level
	}{
		{"Mozilla Firefox", false, Safe, high},
		{"firefox", false, Safe, high},
		{"Firefox Developer Edition", false, Safe, none},
		{"Firefox Developer Edition", false, Moderate, none},
		{"Firefox Developer Edition", false, Advanced, low},
		{"Firefox Developer Edition", true, Moderate, medium},
		{"Microsoft", false, Advanced, none},
		{"", false, Advanced, none},
	}
	for _, c := range checks {
		if got := n.match(c.item, c.pub, c.mode); got != c.want {
			t.Errorf("match(%q, %v, %d) = %v, quero %v", c.item, c.pub, c.mode, got, c.want)
		}
	}
	vlc := newNames("VLC media player", "VideoLAN")
	if vlc.token != "vlc" || vlc.match("VLC", true, Moderate) != medium || vlc.match("VLC", false, Moderate) != none || vlc.match("VLC", false, Advanced) != low {
		t.Fatalf("token do VLC: %+v", vlc)
	}
	// Nome generico nao vira variante.
	if g := newNames("Update", ""); len(g.exact) != 0 {
		t.Fatalf("nome generico aceito: %+v", g)
	}
}

// ---------- linha de comando ----------

func TestPlanUninstall(t *testing.T) {
	const sys = `C:\Windows`
	cases := []struct {
		name  string
		entry Entry
		kind  string
		line  string
	}{
		{"msi pela chave", Entry{Key: `HKLM\X\Uninstall\{AC76BA86-7AD7-1046-7B44-AC0F074E4100}`, WindowsInstaller: true, UninstallString: `MsiExec.exe /I{AC76BA86-7AD7-1046-7B44-AC0F074E4100}`},
			"msi", `"C:\Windows\System32\msiexec.exe" /x {AC76BA86-7AD7-1046-7B44-AC0F074E4100} /qn /norestart`},
		{"msi pela linha", Entry{Key: `HKLM\X\Uninstall\Produto`, UninstallString: `MsiExec.exe /X{ac76ba86-7ad7-1046-7b44-ac0f074e4100}`},
			"msi", `"C:\Windows\System32\msiexec.exe" /x {AC76BA86-7AD7-1046-7B44-AC0F074E4100} /qn /norestart`},
		{"quiet", Entry{UninstallString: `"C:\P\u.exe"`, QuietUninstallString: `"C:\P\u.exe" /quiet`}, "quiet", `"C:\P\u.exe" /quiet`},
		{"inno", Entry{UninstallString: `"C:\Program Files\App\unins000.exe"`}, "inno", `"C:\Program Files\App\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`},
		{"inno ja silencioso", Entry{UninstallString: `"C:\App\unins001.exe" /SILENT`}, "inno", `"C:\App\unins001.exe" /SILENT`},
		{"squirrel", Entry{UninstallString: `"C:\Users\j\AppData\Local\Discord\Update.exe" --uninstall`}, "squirrel", `"C:\Users\j\AppData\Local\Discord\Update.exe" --uninstall -s`},
		{"burn", Entry{UninstallString: `"C:\ProgramData\Package Cache\{X}\setup.exe" /uninstall`}, "burn", `"C:\ProgramData\Package Cache\{X}\setup.exe" /uninstall /quiet /norestart`},
		{"nsis sem aspas", Entry{UninstallString: `C:\Program Files\App X\uninstall.exe`, NSIS: true}, "nsis", `"C:\Program Files\App X\uninstall.exe" /S`},
	}
	for _, c := range cases {
		p, err := planUninstall(c.entry, sys)
		if err != nil || p.Kind != c.kind || p.CmdLine != c.line {
			t.Errorf("%s: plano = %+v, erro %v; quero %s %s", c.name, p, err, c.kind, c.line)
		}
	}
	if _, err := planUninstall(Entry{UninstallString: `"C:\App\setup.exe" -runfromtemp -removeonly`}, sys); !errors.Is(err, errNoSilent) {
		t.Fatalf("desinstalador desconhecido: erro %v", err)
	}
	if _, err := planUninstall(Entry{}, sys); err == nil {
		t.Fatal("entrada sem desinstalador aceita")
	}
}

func TestDirsAndGUID(t *testing.T) {
	e := Entry{InstallLocation: `"C:\Program Files\App\"`, DisplayIcon: `C:\Program Files\App\bin\app.exe,0`, UninstallString: `MsiExec.exe /X{AC76BA86-7AD7-1046-7B44-AC0F074E4100}`}
	got := e.dirs(`C:\Windows`)
	if strings.Join(got, "|") != `C:\Program Files\App|C:\Program Files\App\bin` {
		t.Fatalf("pastas = %v", got)
	}
	if d := exeDir(`C:\Windows\System32\rundll32.exe x`, `C:\Windows`); d != "" {
		t.Fatalf("pasta do Windows aceita: %s", d)
	}
	if g := packGUID("{12345678-90AB-CDEF-1234-567890ABCDEF}"); g != "87654321BA09FEDC2143658709BADCFE" {
		t.Fatalf("packGUID = %s", g)
	}
	if packGUID("{nao-e-guid}") != "" {
		t.Fatal("GUID invalido aceito")
	}
}

// ---------- regras de seguranca ----------

func TestLayoutCheck(t *testing.T) {
	l := newFakeHost().layout
	ok := []Leftover{
		{Kind: KindDir, Path: `C:\Program Files\Mozilla Firefox`},
		{Kind: KindDir, Path: `c:/program files (x86)/Vendor/App`},
		{Kind: KindDir, Path: `C:\Users\joao\AppData\Local\Programs\Code`},
		{Kind: KindFile, Path: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Firefox.lnk`},
		{Kind: KindFile, Path: `C:\Users\joao\Desktop\Site.url`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Mozilla\Firefox`},
		{Kind: KindKey, Path: `HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Vendor`},
		{Kind: KindKey, Path: firefoxKey},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Classes\Installer\Products\87654321BA09FEDC2143658709BADCFE`},
		{Kind: KindKey, Path: `HKU\S-1-5-21-1-2-3-1001\Software\Vendor\App`},
		{Kind: KindValue, Path: runKey, Name: "Updater"},
		{Kind: KindService, Path: "FirefoxHelper"},
		{Kind: KindTask, Path: `\Mozilla\Firefox Agent`},
	}
	for _, it := range ok {
		if err := l.check(it); err != nil {
			t.Errorf("%s %s recusado: %v", it.Kind, it.Path, err)
		}
	}
	bad := []Leftover{
		{Kind: KindDir, Path: `C:\Windows\System32`},
		{Kind: KindDir, Path: `C:\Windows`},
		{Kind: KindDir, Path: `C:\`},
		{Kind: KindDir, Path: `C:\Program Files`},
		{Kind: KindDir, Path: `C:\Program Files\Common Files`},
		{Kind: KindDir, Path: `C:\Program Files\Cybereyes`},
		{Kind: KindDir, Path: `C:\Program Files\Cybereyes\EYES\bin`},
		{Kind: KindDir, Path: `C:\ProgramData\Microsoft\Windows\WER`},
		{Kind: KindDir, Path: `C:\Users\joao`},
		{Kind: KindDir, Path: `C:\Users\joao\Documents\Firefox`},
		{Kind: KindDir, Path: `C:\Users\joao\AppData\Local\Microsoft\Teams`},
		{Kind: KindDir, Path: `C:\Users\joao\AppData\Roaming`},
		{Kind: KindDir, Path: `C:\Program Files\App\..\..\Windows`},
		{Kind: KindDir, Path: `\\servidor\share\App`},
		{Kind: KindDir, Path: `C:\Program Files\App*`},
		{Kind: KindDir, Path: `C:\Program Files\App.`},
		{Kind: KindDir, Path: `Program Files\App`},
		{Kind: KindDir, Path: `C:\Program Files\a\b\c\d\e`},
		{Kind: KindFile, Path: `C:\Program Files\App\app.exe`},
		{Kind: KindFile, Path: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\x.exe`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Microsoft`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Microsoft\Firefox`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\WOW6432Node`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Classes\Firefox`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Policies\Mozilla`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`},
		{Kind: KindKey, Path: `HKLM\SYSTEM\CurrentControlSet\Services\Spooler`},
		{Kind: KindKey, Path: `HKLM\SOFTWARE\Vendor\App\Sub`},
		{Kind: KindKey, Path: `HKU\S-1-5-21-9-9-9-9\Software\Vendor`},
		{Kind: KindKey, Path: `HKCU\Software\Vendor`},
		{Kind: KindValue, Path: `HKLM\SOFTWARE\Vendor`, Name: "x"},
		{Kind: KindValue, Path: runKey, Name: ""},
		{Kind: KindService, Path: "eyes"},
		{Kind: KindService, Path: `..\x`},
		{Kind: KindTask, Path: `\Microsoft\Windows\Defrag\ScheduledDefrag`},
		{Kind: KindTask, Path: `\..\x`},
		{Kind: KindTask, Path: `Mozilla\x`},
		{Kind: "outro", Path: `C:\Program Files\App`},
	}
	for _, it := range bad {
		if err := l.check(it); err == nil {
			t.Errorf("%s %s %s aceito", it.Kind, it.Path, it.Name)
		}
	}
}

// ---------- varredura ----------

func TestScanModerate(t *testing.T) {
	got := summarize(Scan(firefoxHost(), firefoxTarget(), Moderate))
	want := []found{
		{KindKey, firefoxKey, "", "high"},
		{KindKey, `HKLM\SOFTWARE\Mozilla\Firefox`, "", "high"},
		{KindKey, `HKLM\SOFTWARE\Mozilla\Mozilla Firefox`, "", "high"},
		{KindKey, `HKU\S-1-5-21-1-2-3-1001\Software\Mozilla`, "", "high"},
		{KindValue, runKey, "Updater", "high"},
		{KindDir, firefoxDir, "", "high"},
		{KindDir, `C:\Users\joao\AppData\Roaming\Mozilla\Firefox`, "", "medium"},
		{KindDir, `C:\Users\joao\AppData\Local\Mozilla`, "", "medium"},
		{KindFile, `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Firefox.lnk`, "", "high"},
		{KindFile, `C:\Users\Public\Desktop\Firefox.lnk`, "", "high"},
		{KindService, "FirefoxHelper", "", "high"},
		{KindTask, `\Mozilla\Firefox Default Browser Agent 308046B0AF4A39CB`, "", "high"},
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("faltou %+v", w)
		}
	}
	if len(got) != len(want) {
		t.Errorf("itens a mais: %d encontrados, %d esperados: %+v", len(got), len(want), got)
	}
}

func TestScanSafeAndAdvanced(t *testing.T) {
	safe := summarize(Scan(firefoxHost(), firefoxTarget(), Safe))
	for f := range safe {
		if f.kind == KindValue || f.kind == KindService || f.kind == KindTask {
			t.Errorf("modo seguro trouxe %+v", f)
		}
	}
	if !safe[found{KindKey, `HKU\S-1-5-21-1-2-3-1001\Software\Mozilla\Firefox`, "", "high"}] {
		t.Errorf("modo seguro deveria trazer so a chave do programa, sem a do fabricante: %+v", safe)
	}
	adv := summarize(Scan(firefoxHost(), firefoxTarget(), Advanced))
	if !adv[found{KindDir, `C:\Program Files (x86)\Firefox Developer Edition`, "", "low"}] {
		t.Errorf("modo avancado deveria trazer o nome parecido como baixa confianca: %+v", adv)
	}
	for f := range adv {
		if strings.Contains(f.path, `\Microsoft\Firefox`) || strings.Contains(f.path, `Classes`) || strings.Contains(f.path, "Documents") ||
			f.path == "Spooler" || f.path == "Firefox" || strings.HasPrefix(f.path, `\Microsoft`) || strings.Contains(f.path, "VLC") ||
			strings.Contains(f.path, "Thunderbird") || f.name == "Outro" {
			t.Errorf("item protegido ou de outro programa: %+v", f)
		}
	}
}

// ---------- fluxo completo ----------

type fakeSystem struct {
	*fakeHost
	mu        sync.Mutex
	entries   map[string]Entry
	run       runResult
	removeKey bool
	ran       []string
	removed   []Leftover
	failPath  string
}

func (f *fakeSystem) Find(key, name, version string) (Entry, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, e := range f.entries {
		if key != "" {
			if strings.EqualFold(k, key) {
				return e, true
			}
			continue
		}
		if strings.EqualFold(e.Name, name) && (version == "" || e.Version == version) {
			return e, true
		}
	}
	return Entry{}, false
}

func (f *fakeSystem) SystemRoot() string { return `C:\Windows` }

func (f *fakeSystem) RestorePoint(context.Context, string) (string, error) {
	return "", errors.New("restauracao do sistema desligada")
}

func (f *fakeSystem) Run(_ context.Context, cmd string, _ time.Duration) runResult {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ran = append(f.ran, cmd)
	if f.removeKey {
		f.entries = map[string]Entry{}
	}
	return f.run
}

func (f *fakeSystem) Remove(_ context.Context, it Leftover, _ string) (bool, error) {
	if it.Path == f.failPath {
		return false, errors.New("acesso negado")
	}
	f.removed = append(f.removed, it)
	return it.Kind == KindDir, nil
}

func (f *fakeSystem) BackupDir(string) string { return `C:\ProgramData\Cybereyes\EYES\desinstalacao\x` }

type recorder struct {
	mu    sync.Mutex
	paths []string
	body  []map[string]any
}

func (r *recorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	data, _ := io.ReadAll(req.Body)
	var body map[string]any
	_ = json.Unmarshal(data, &body)
	r.mu.Lock()
	r.paths = append(r.paths, req.Method+" "+req.URL.Path)
	r.body = append(r.body, body)
	r.mu.Unlock()
	_, _ = w.Write([]byte(`"ok"`))
}

func newTestWorker(t *testing.T, sys system) (*rpc.Registry, *recorder) {
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
	w := newService(&env.Env{Cfg: &config.Config{AgentID: "AGENTE1"}, API: client, Reg: reg, Log: log, Ctx: context.Background()}, sys)
	w.spawn = func(_ string, fn func(context.Context)) { fn(context.Background()) }
	w.sleep = func(context.Context, time.Duration) {}
	w.register(reg)
	return reg, rec
}

func dispatch(t *testing.T, reg *rpc.Registry, m map[string]any) any {
	t.Helper()
	data, err := msgpack.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var req rpc.Request
	if err := msgpack.Unmarshal(data, &req); err != nil {
		t.Fatal(err)
	}
	return reg.Dispatch(context.Background(), req)
}

func firefoxSystem() *fakeSystem {
	return &fakeSystem{fakeHost: firefoxHost(), entries: map[string]Entry{firefoxKey: {
		Key: firefoxKey, Name: "Mozilla Firefox (x64 pt-BR)", Version: "120.0", Publisher: "Mozilla",
		InstallLocation: firefoxDir, UninstallString: `"C:\Program Files\Mozilla Firefox\uninstall\helper.exe"`, NSIS: true,
	}}}
}

func TestUninstallFlow(t *testing.T) {
	sys := firefoxSystem()
	sys.removeKey = true
	reg, rec := newTestWorker(t, sys)
	out := dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 7, "name": "Mozilla Firefox (x64 pt-BR)",
		"version": "120.0", "key": firefoxKey, "mode": "moderate", "run_uninstaller": true, "restore_point": true})
	if out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	if len(sys.ran) != 1 || sys.ran[0] != `"C:\Program Files\Mozilla Firefox\uninstall\helper.exe" /S` {
		t.Fatalf("desinstalador = %v", sys.ran)
	}
	if len(rec.paths) != 1 || rec.paths[0] != "PATCH /api/v4/AGENTE1/7/softwareresult/" {
		t.Fatalf("chamadas = %v", rec.paths)
	}
	body := rec.body[0]
	if body["ok"] != true || body["scanned"] != true || body["ran_uninstaller"] != true || body["still_installed"] != nil {
		t.Fatalf("resultado = %v", body)
	}
	results, _ := body["results"].(string)
	if !strings.Contains(results, "Ponto de restauracao nao criado") || !strings.Contains(results, "sobra(s) encontrada(s)") {
		t.Fatalf("registro = %s", results)
	}
	if left, _ := body["leftovers"].([]any); len(left) < 5 {
		t.Fatalf("sobras = %v", body["leftovers"])
	}
}

func TestUninstallUnknownInstallerDoesNotScan(t *testing.T) {
	sys := firefoxSystem()
	e := sys.entries[firefoxKey]
	e.NSIS = false
	sys.entries[firefoxKey] = e
	reg, rec := newTestWorker(t, sys)
	dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 8, "name": e.Name, "key": firefoxKey, "run_uninstaller": true})
	body := rec.body[0]
	if body["ok"] != false || body["scanned"] != nil || len(sys.ran) != 0 {
		t.Fatalf("resultado = %v, executados %v", body, sys.ran)
	}
	if !strings.Contains(body["results"].(string), "remocao forcada") {
		t.Fatalf("registro = %s", body["results"])
	}
}

func TestUninstallFailureKeepsProgram(t *testing.T) {
	sys := firefoxSystem()
	sys.run = runResult{ExitCode: 1603}
	reg, rec := newTestWorker(t, sys)
	dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 9, "name": "Mozilla Firefox (x64 pt-BR)", "key": firefoxKey, "run_uninstaller": true})
	body := rec.body[0]
	if body["ok"] != false || body["scanned"] != nil || body["still_installed"] != true {
		t.Fatalf("resultado = %v", body)
	}
	if !strings.Contains(body["results"].(string), "1603") {
		t.Fatalf("registro = %s", body["results"])
	}
}

func TestForcedUninstallAndOtherVersion(t *testing.T) {
	sys := firefoxSystem()
	reg, rec := newTestWorker(t, sys)
	dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 10, "name": "Mozilla Firefox (x64 pt-BR)", "key": firefoxKey, "mode": "safe", "run_uninstaller": false})
	body := rec.body[0]
	if len(sys.ran) != 0 || body["ok"] != true || body["scanned"] != true || body["still_installed"] != true {
		t.Fatalf("remocao forcada: %v", body)
	}
	// Chave antiga com a versao instalada diferente: nao mexe.
	dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 11, "name": "Mozilla Firefox (x64 pt-BR)", "version": "115.0",
		"key": `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Antiga`, "run_uninstaller": true})
	body = rec.body[1]
	if body["ok"] != false || body["scanned"] != nil || !strings.Contains(body["results"].(string), "outra versao") {
		t.Fatalf("outra versao: %v", body)
	}
}

func TestCleanupChecksEveryItem(t *testing.T) {
	sys := firefoxSystem()
	sys.failPath = `HKLM\SOFTWARE\Mozilla\Firefox`
	reg, rec := newTestWorker(t, sys)
	items := []map[string]any{
		{"kind": KindDir, "path": firefoxDir},
		{"kind": KindKey, "path": `HKLM\SOFTWARE\Mozilla\Firefox`},
		{"kind": KindService, "path": "FirefoxHelper"},
		{"kind": KindDir, "path": `C:\Windows\System32`},
		{"kind": KindKey, "path": `HKLM\SOFTWARE\Microsoft`},
	}
	out := dispatch(t, reg, map[string]any{"func": "softwarecleanup", "pending_action_pk": 12, "name": "Firefox", "items": items})
	if out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	if len(sys.removed) != 2 || sys.removed[0].Kind != KindService || sys.removed[1].Path != firefoxDir {
		t.Fatalf("removidos (servico antes da pasta) = %+v", sys.removed)
	}
	body := rec.body[0]
	if body["ok"] != false || body["removed"] != float64(2) || body["failed"] != float64(3) || body["reboot"] != true || body["backup"] == nil {
		t.Fatalf("resultado = %v", body)
	}
	results := body["results"].(string)
	for _, s := range []string{"Recusado: pasta C:\\Windows\\System32", "Recusado: chave HKLM\\SOFTWARE\\Microsoft", "Falhou: chave HKLM\\SOFTWARE\\Mozilla\\Firefox", "Agendado para o proximo reinicio"} {
		if !strings.Contains(results, s) {
			t.Errorf("registro sem %q:\n%s", s, results)
		}
	}
	if dispatch(t, reg, map[string]any{"func": "softwarecleanup", "items": items}) == "ok" {
		t.Fatal("pedido sem pending_action_pk aceito")
	}
}

func TestUninstallTimeoutButRemoved(t *testing.T) {
	sys := firefoxSystem()
	sys.run = runResult{TimedOut: true}
	sys.removeKey = true
	reg, rec := newTestWorker(t, sys)
	dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 13, "name": "Mozilla Firefox (x64 pt-BR)", "key": firefoxKey, "run_uninstaller": true})
	body := rec.body[0]
	if body["ok"] != true || body["scanned"] != true || !strings.Contains(body["results"].(string), "saiu do registro") {
		t.Fatalf("resultado = %v", body)
	}
}
