package wua

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/vmihailenco/msgpack/v5"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const (
	agentID = "AGENTE123"
	g1      = "11111111-aaaa-bbbb-cccc-000000000001"
	g2      = "11111111-aaaa-bbbb-cccc-000000000002"
	g3      = "11111111-aaaa-bbbb-cccc-000000000003"
	g4      = "11111111-aaaa-bbbb-cccc-000000000004"
)

type call struct {
	Method string
	Path   string
	Auth   string
	Body   map[string]any
}

type recorder struct {
	mu     sync.Mutex
	calls  []call
	status func(method, path string, body map[string]any) int
}

func (r *recorder) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	data, _ := io.ReadAll(req.Body)
	var body map[string]any
	_ = json.Unmarshal(data, &body)
	r.mu.Lock()
	r.calls = append(r.calls, call{Method: req.Method, Path: req.URL.Path, Auth: req.Header.Get("Authorization"), Body: body})
	r.mu.Unlock()
	code := http.StatusOK
	if r.status != nil {
		code = r.status(req.Method, req.URL.Path, body)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if code == http.StatusOK {
		_, _ = w.Write([]byte(`"ok"`))
	} else {
		_, _ = w.Write([]byte(`"Empty payload"`))
	}
}

func (r *recorder) all() []call {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]call(nil), r.calls...)
}

type fakeBackend struct {
	mu           sync.Mutex
	pending      []Update
	installed    []Update
	results      map[string]InstallResult
	reboot       bool
	scans        int
	installCalls [][]string
}

func (f *fakeBackend) Scan(context.Context) ([]Update, []Update, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.scans++
	return f.pending, f.installed, nil
}

func (f *fakeBackend) Install(_ context.Context, guids []string, report func(InstallResult)) (bool, error) {
	f.mu.Lock()
	f.installCalls = append(f.installCalls, guids)
	f.mu.Unlock()
	for _, g := range guids {
		if r, ok := f.results[g]; ok {
			r.GUID = g
			report(r)
		}
	}
	return f.reboot, nil
}

func newTestService(t *testing.T, be backend, rec *recorder) (*service, *rpc.Registry) {
	t.Helper()
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	client, err := api.New(srv.URL, "tok", api.Options{})
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	reg := rpc.NewRegistry(log)
	e := &env.Env{Cfg: &config.Config{AgentID: agentID}, API: client, Reg: reg, Log: log, Ctx: context.Background()}
	s := newService(e, be)
	// Execucao sincrona: os testes conferem o efeito logo depois do despacho.
	s.spawn = func(_ string, fn func(context.Context)) { fn(context.Background()) }
	s.register(reg)
	return s, reg
}

// decodeRequest simula o caminho do NATS: msgpack -> rpc.Request.
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

func TestUpdateJSONKeys(t *testing.T) {
	u := normalize(Update{GUID: g1, KBArticleIDs: []string{"KB5001"}, Supersedes: []string{g2}})
	data, err := json.Marshal(u)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	want := []string{"categories", "description", "downloaded", "guid", "installed", "kb_article_ids",
		"more_info_urls", "revision_number", "severity", "support_url", "title"}
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("chaves = %v, quer %v", keys, want)
	}
	// Listas vazias saem como [] (nunca null) e o KB vai so com digitos.
	if !strings.Contains(string(data), `"categories":[]`) || !strings.Contains(string(data), `"kb_article_ids":["5001"]`) {
		t.Fatalf("json = %s", data)
	}
}

func TestBuildPayload(t *testing.T) {
	pending := []Update{
		{GUID: strings.ToUpper(g1), KBArticleIDs: []string{"5001"}, Severity: "critical", Supersedes: []string{g2}},
		{GUID: g2, KBArticleIDs: []string{"5002"}},                // substituida por g1
		{GUID: g1, KBArticleIDs: []string{"5001"}},                // duplicada
		{GUID: "nao-e-guid", KBArticleIDs: []string{"9"}},         // descartada
		{GUID: "{" + g3 + "}", KBArticleIDs: []string{"KB 5003"}}, // instalada por este processo
	}
	installed := []Update{{GUID: g4, KBArticleIDs: []string{"4000"}}, {GUID: g1}}
	last := map[string]bool{"11111111-aaaa-bbbb-cccc-0000000000ff": true}
	pending[0].Supersedes = append(pending[0].Supersedes, "11111111-aaaa-bbbb-cccc-0000000000ff")

	items, superseded := buildPayload(pending, installed, map[string]bool{g3: true}, last)
	var got []string
	for _, u := range items {
		got = append(got, u.GUID)
	}
	if want := []string{g1, g3, g4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("itens = %v, quer %v", got, want)
	}
	if items[0].Severity != "Critical" || items[0].Installed {
		t.Fatalf("pendente mal normalizada: %+v", items[0])
	}
	if !items[1].Installed || !items[1].Downloaded || items[1].KBArticleIDs[0] != "5003" {
		t.Fatalf("instalada por este processo deveria ir como instalada: %+v", items[1])
	}
	if !items[2].Installed {
		t.Fatalf("instalada deveria ir com installed=true: %+v", items[2])
	}
	if want := []string{g2, "11111111-aaaa-bbbb-cccc-0000000000ff"}; !reflect.DeepEqual(superseded, want) {
		t.Fatalf("superseded = %v, quer %v", superseded, want)
	}
}

func TestBuildPayloadLimit(t *testing.T) {
	var installed []Update
	for i := 0; i < maxItems+50; i++ {
		installed = append(installed, Update{GUID: fmt.Sprintf("%08x-0000-0000-0000-000000000000", i)})
	}
	items, _ := buildPayload([]Update{{GUID: g1}}, installed, nil, nil)
	if len(items) != maxItems || items[0].GUID != g1 {
		t.Fatalf("limite nao respeitado: %d itens, primeiro %s", len(items), items[0].GUID)
	}
}

func TestGUIDHelpers(t *testing.T) {
	if !isGUID(g1) || isGUID("x") || isGUID(g1+"'") || isGUID("11111111-aaaa-bbbb-cccc-00000000000g") {
		t.Fatal("isGUID")
	}
	// Aspas e espacos nunca passam: o GUID vai para o criterio UpdateID='...'.
	if normGUID("' or 1=1 or UpdateID='") != "" {
		t.Fatal("normGUID aceitou injecao")
	}
	got := sanitizeGUIDs([]string{strings.ToUpper(g1), g1, "", "lixo", "{" + g2 + "}"})
	if want := []string{g1, g2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("sanitizeGUIDs = %v", got)
	}
	found, missing := filterByGUID([]Update{{GUID: g2}, {GUID: strings.ToUpper(g1)}, {GUID: g4}},
		func(u Update) string { return u.GUID }, []string{g1, g3, g2})
	if len(found) != 2 || found[0].GUID != strings.ToUpper(g1) || found[1].GUID != g2 {
		t.Fatalf("found = %+v", found)
	}
	if !reflect.DeepEqual(missing, []string{g3}) {
		t.Fatalf("missing = %v", missing)
	}
}

func TestScanPostsUpdatesAndSuperseded(t *testing.T) {
	be := &fakeBackend{pending: []Update{
		{GUID: g1, KBArticleIDs: []string{"5001"}, Title: "Atualizacao", Severity: "Important", Supersedes: []string{g2}},
		{GUID: g2, KBArticleIDs: []string{"5002"}},
	}}
	rec := &recorder{}
	s, reg := newTestService(t, be, rec)
	if out := reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "getwinupdates"})); out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	calls := rec.all()
	if len(calls) != 2 {
		t.Fatalf("chamadas = %+v", calls)
	}
	post := calls[0]
	if post.Method != http.MethodPost || post.Path != pathWinUpdates || post.Auth != "Token tok" || post.Body["agent_id"] != agentID {
		t.Fatalf("POST winupdates = %+v", post)
	}
	list := post.Body["wua_updates"].([]any)
	if len(list) != 1 {
		t.Fatalf("wua_updates = %v", list)
	}
	item := list[0].(map[string]any)
	if item["guid"] != g1 || item["severity"] != "Important" || item["installed"] != false ||
		!reflect.DeepEqual(item["kb_article_ids"], []any{"5001"}) {
		t.Fatalf("item = %v", item)
	}
	sup := calls[1]
	if sup.Method != http.MethodPost || sup.Path != pathSuperseded || sup.Body["guid"] != g2 {
		t.Fatalf("superseded = %+v", sup)
	}
	if !s.lastPending[g1] || len(s.lastPending) != 1 {
		t.Fatalf("lastPending = %v", s.lastPending)
	}
}

func TestScanEmptyListOldServer(t *testing.T) {
	rec := &recorder{status: func(method, path string, body map[string]any) int {
		if list, ok := body["wua_updates"].([]any); ok && len(list) == 0 {
			return http.StatusBadRequest
		}
		return http.StatusOK
	}}
	s, _ := newTestService(t, &fakeBackend{}, rec)
	if err := s.scan(context.Background()); err != nil {
		t.Fatalf("lista vazia recusada nao deveria ser erro: %v", err)
	}
	calls := rec.all()
	if len(calls) != 1 {
		t.Fatalf("chamadas = %+v", calls)
	}
	// O corpo leva a lista vazia (e nao null), que o servidor corrigido aceita.
	if list, ok := calls[0].Body["wua_updates"].([]any); !ok || len(list) != 0 {
		t.Fatalf("corpo = %v", calls[0].Body)
	}
}

func TestInstallReportsEachGUIDAndReboot(t *testing.T) {
	be := &fakeBackend{
		results: map[string]InstallResult{g1: {Success: true, RebootRequired: true}, g2: {Success: false, Detail: "0x80240022"}},
		reboot:  true,
		pending: []Update{{GUID: g1, KBArticleIDs: []string{"5001"}}},
	}
	rec := &recorder{}
	s, reg := newTestService(t, be, rec)
	req := decodeRequest(t, map[string]any{"func": "installwinupdates", "guids": []string{g1, strings.ToUpper(g2), g3, "invalido"}})
	if out := reg.Dispatch(context.Background(), req); out != "ok" {
		t.Fatalf("resposta = %v", out)
	}
	if want := [][]string{{g1, g2, g3}}; !reflect.DeepEqual(be.installCalls, want) {
		t.Fatalf("backend recebeu %v", be.installCalls)
	}
	calls := rec.all()
	var patches []string
	for _, c := range calls[:3] {
		if c.Method != http.MethodPatch || c.Path != pathWinUpdates || c.Body["agent_id"] != agentID {
			t.Fatalf("PATCH = %+v", c)
		}
		patches = append(patches, c.Body["guid"].(string)+"="+jsonText(c.Body["success"]))
	}
	if want := []string{g1 + "=true", g2 + "=false", g3 + "=false"}; !reflect.DeepEqual(patches, want) {
		t.Fatalf("patches = %v", patches)
	}
	put := calls[3]
	if put.Method != http.MethodPut || put.Path != pathWinUpdates || put.Body["needs_reboot"] != true {
		t.Fatalf("PUT = %+v", put)
	}
	// Com reinicio pendente nao ha nova varredura (ela desfaria o installed do PATCH).
	if len(calls) != 4 || be.scans != 0 {
		t.Fatalf("varredura inesperada: %d chamadas, %d varreduras", len(calls), be.scans)
	}
	// Uma varredura feita antes do reinicio mantem g1 como instalada.
	if err := s.scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	last := rec.all()[4]
	item := last.Body["wua_updates"].([]any)[0].(map[string]any)
	if item["guid"] != g1 || item["installed"] != true {
		t.Fatalf("g1 deveria continuar instalada: %v", item)
	}
}

func TestInstallWithoutRebootRescans(t *testing.T) {
	be := &fakeBackend{results: map[string]InstallResult{g1: {Success: true}}}
	rec := &recorder{}
	_, reg := newTestService(t, be, rec)
	reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installwinupdates", "guids": []string{g1}}))
	calls := rec.all()
	if len(calls) != 3 || calls[1].Body["needs_reboot"] != false || calls[2].Method != http.MethodPost || be.scans != 1 {
		t.Fatalf("chamadas = %+v, varreduras = %d", calls, be.scans)
	}
}

func TestInstallWithoutGUIDs(t *testing.T) {
	rec := &recorder{}
	_, reg := newTestService(t, &fakeBackend{}, rec)
	out := reg.Dispatch(context.Background(), decodeRequest(t, map[string]any{"func": "installwinupdates", "guids": []string{"x"}}))
	if s, _ := out.(string); !strings.HasPrefix(s, "error:") || len(rec.all()) != 0 {
		t.Fatalf("resposta = %v, chamadas = %v", out, rec.all())
	}
}

func jsonText(v any) string { b, _ := json.Marshal(v); return string(b) }
