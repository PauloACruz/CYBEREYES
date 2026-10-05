//go:build smoke

package smoke

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// request e uma chamada REST recebida pelo servidor falso.
type request struct {
	Method string
	Path   string
	Auth   string
	Body   []byte
	Status int
	At     time.Time
}

// JSON decodifica o corpo (nil quando nao e JSON).
func (r request) JSON() map[string]any {
	var m map[string]any
	_ = json.Unmarshal(r.Body, &m)
	return m
}

// fakeAPI imita as rotas /api/v3 do Cybereyes usadas pelo agente (contrato, secoes 2 e 3).
type fakeAPI struct {
	t            testing.TB
	srv          *httptest.Server
	installToken string

	mu         sync.Mutex
	agentID    string
	agentToken string
	pk         int
	reqs       []request
	unknown    []string
}

// Check diskspace devolvido em checkrunner/runchecks.
const diskCheckID = 4242

var agentIDPattern = regexp.MustCompile(`^[A-Za-z]{40}$`)

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func newFakeAPI(t testing.TB) *fakeAPI {
	f := &fakeAPI{t: t, installToken: randomHex(32), pk: 101}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

// URL e o endereco base (http://127.0.0.1:porta).
func (f *fakeAPI) URL() string { return f.srv.URL }

// creds devolve o agent_id e o token emitidos no newagent (vazios antes do registro).
func (f *fakeAPI) creds() (string, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.agentID, f.agentToken
}

// requests devolve uma copia das chamadas recebidas.
func (f *fakeAPI) requests() []request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]request(nil), f.reqs...)
}

// find devolve as chamadas com o metodo e o caminho que casam com o padrao.
func (f *fakeAPI) find(method string, path *regexp.Regexp) []request {
	var out []request
	for _, r := range f.requests() {
		if r.Method == method && path.MatchString(r.Path) {
			out = append(out, r)
		}
	}
	return out
}

func (f *fakeAPI) unknownRoutes() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.unknown...)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeAPI) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	rec := request{Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"), Body: body, At: time.Now()}
	status, resp := f.route(rec)
	rec.Status = status
	f.mu.Lock()
	f.reqs = append(f.reqs, rec)
	f.mu.Unlock()
	writeJSON(w, status, resp)
}

// route decide a resposta de cada rota, com os formatos do contrato.
func (f *fakeAPI) route(r request) (int, any) {
	seg := strings.Split(strings.Trim(r.Path, "/"), "/")
	if !strings.HasSuffix(r.Path, "/") || len(seg) < 3 || seg[0] != "api" {
		return f.notFound(r)
	}
	ver, rest := seg[1], seg[2:]
	key := r.Method + " " + strings.Join(rest, "/")

	// Rotas de instalacao: token de instalacao.
	switch key {
	case "GET installer", "POST installer", "POST newagent":
		if ver != "v3" {
			return f.notFound(r)
		}
		if r.Auth != "Token "+f.installToken {
			return http.StatusUnauthorized, map[string]string{"detail": "token invalido"}
		}
		switch key {
		case "GET installer":
			return 200, "ok"
		case "POST installer":
			if s, ok := r.JSON()["version"].(string); !ok || s == "" {
				return 400, "Invalid data"
			}
			return 200, "ok"
		default:
			return f.newAgent(r)
		}
	}

	// Rotas do agente: token do agente.
	_, token := f.creds()
	if token == "" || r.Auth != "Token "+token {
		return http.StatusUnauthorized, map[string]string{"detail": "token invalido"}
	}
	body := r.JSON()
	if ver == "v4" {
		// PATCH /api/v4/{agent_id}/{pk}/chocoresult/
		if r.Method == http.MethodPatch && len(rest) == 3 && rest[2] == "chocoresult" {
			return 200, "ok"
		}
		return f.notFound(r)
	}
	if ver != "v3" {
		return f.notFound(r)
	}
	switch key {
	case "POST checkin", "POST choco", "PUT winupdates", "PATCH winupdates", "POST superseded",
		"POST snmp/results", "POST snmp/traps":
		return 200, "ok"
	case "POST software":
		if _, ok := body["software"].([]any); !ok {
			return 400, "Invalid data"
		}
		return 200, "ok"
	case "POST winupdates":
		if l, ok := body["wua_updates"].([]any); !ok || len(l) == 0 {
			return 400, "Empty payload"
		}
		return 200, "ok"
	case "PATCH checkrunner":
		if _, ok := body["agent_id"]; !ok {
			return 400, "Agent upgrade required"
		}
		if id, ok := body["id"].(float64); !ok || id != float64(int(id)) {
			return 400, "Invalid data"
		}
		if int(body["id"].(float64)) != diskCheckID {
			return 404, map[string]string{"detail": "Not found."}
		}
		return 200, "ok"
	case "POST traytoken":
		if u, _ := body["username"].(string); strings.TrimSpace(u) == "" {
			return 400, "username obrigatorio"
		}
		return 200, map[string]string{"token": randomHex(32), "expires_at": time.Now().Add(12 * time.Hour).UTC().Format(time.RFC3339)}
	case "POST logs":
		l, ok := body["entries"].([]any)
		if !ok {
			return 400, "Invalid data"
		}
		if len(l) > 1000 || len(r.Body) > 2<<20 {
			return 400, "Batch too large"
		}
		return 200, "ok"
	}
	// Rotas com agent_id (e pk) no caminho.
	switch {
	case len(rest) == 2 && r.Method == http.MethodGet:
		switch rest[1] {
		case "config":
			return 200, map[string]any{
				"checkin_hello": 30 + randInt(30), "checkin_agentinfo": 200 + randInt(200),
				"checkin_winsvc": 2400 + randInt(600), "checkin_pubip": 300 + randInt(200),
				"checkin_disks": 1000 + randInt(1000), "checkin_sw": 2800 + randInt(700),
				"checkin_wmi": 3000 + randInt(1000),
				"limit_data":  false, "install_nushell": false, "install_nushell_version": "",
				"install_nushell_url": "", "nushell_enable_config": false, "install_deno": false,
				"install_deno_version": "", "install_deno_url": "", "deno_default_permissions": "",
			}
		case "checkinterval":
			return 200, map[string]any{"agent": f.pk, "check_interval": 120}
		case "checkrunner", "runchecks":
			return 200, map[string]any{"agent": f.pk, "check_interval": 600, "checks": []any{diskCheck()}}
		case "logconfig":
			return 200, map[string]any{"enabled": true, "min_level": "warning", "windows_logs": []string{"System", "Application"}, "max_per_cycle": 500}
		case "snmp":
			return 200, map[string]any{"enabled": false, "trap_port": 162, "devices": []any{}}
		case "update":
			return 200, map[string]any{"version": "0.0.0", "sha256": "", "auto_update": false}
		}
	case len(rest) == 3 && rest[2] == "taskrunner":
		if r.Method == http.MethodGet {
			id, _ := strconv.Atoi(rest[0])
			if id != taskPK {
				return 400, ""
			}
			return 200, map[string]any{"id": id, "continue_on_error": true, "enabled": true, "task_actions": taskActions()}
		}
		if r.Method == http.MethodPatch {
			return 200, "ok"
		}
	case len(rest) == 3 && rest[2] == "histresult" && r.Method == http.MethodPatch:
		return 200, "ok"
	}
	return f.notFound(r)
}

func (f *fakeAPI) notFound(r request) (int, any) {
	f.mu.Lock()
	f.unknown = append(f.unknown, r.Method+" "+r.Path)
	f.mu.Unlock()
	return 404, map[string]string{"detail": "Not found."}
}

func (f *fakeAPI) newAgent(r request) (int, any) {
	body := r.JSON()
	id, _ := body["agent_id"].(string)
	host, _ := body["hostname"].(string)
	if id == "" || host == "" || len(id) > 200 {
		return 400, "Invalid data"
	}
	switch s := body["site"].(type) {
	case string:
		if s == "" || strings.Trim(s, "0123456789") != "" {
			return 400, "Invalid data"
		}
	case float64:
	default:
		return 400, "Invalid data"
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.agentID != "" {
		return 400, "Agent already exists. Remove old agent first if trying to re-install"
	}
	f.agentID = id
	f.agentToken = randomHex(20)
	return 200, map[string]any{"pk": f.pk, "token": f.agentToken}
}

// Tarefa devolvida em taskrunner: um comando que imprime taskMarker.
const (
	taskPK     = 77
	taskMarker = "task-ok"
)

func taskActions() []any {
	shell := "/bin/sh"
	if runtime.GOOS == "windows" {
		shell = "cmd"
	}
	return []any{map[string]any{"type": "cmd", "command": "echo " + taskMarker, "shell": shell, "timeout": 60}}
}

// diskCheck e um check diskspace do disco do sistema com todas as chaves do contrato (3.5).
func diskCheck() map[string]any {
	disk := "/"
	if runtime.GOOS == "windows" {
		disk = "C:"
	}
	return map[string]any{
		"id": diskCheckID, "agent": nil, "check_type": "diskspace", "run_interval": 0,
		"alert_severity": "warning", "error_threshold": 5, "warning_threshold": 10,
		"disk": disk, "ip": nil, "script": nil, "script_args": []string{}, "env_vars": []string{},
		"info_return_codes": []int{}, "warning_return_codes": []int{}, "success_return_codes": []int{},
		"timeout": 60, "svc_name": nil, "pass_if_start_pending": false, "pass_if_svc_not_exist": false,
		"restart_if_stopped": false, "log_name": nil, "event_id": 0, "event_id_is_wildcard": false,
		"event_type": nil, "event_source": "", "event_message": "", "fail_when": "contains",
		"search_last_days": 1, "number_of_events_b4_alert": 1, "managed_by_policy": true,
	}
}

func randInt(n int) int {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return (int(b[0])<<8 | int(b[1])) % n
}

// describe resume as chamadas recebidas (para o log do CI).
func (f *fakeAPI) describe() string {
	var sb strings.Builder
	for _, r := range f.requests() {
		fmt.Fprintf(&sb, "  %s %s %s -> %d (%d bytes)\n", r.At.Format("15:04:05.000"), r.Method, r.Path, r.Status, len(r.Body))
	}
	return sb.String()
}
