//go:build smoke

package smoke

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/vmihailenco/msgpack/v5"
)

// Prazos generosos: nos runners Windows a primeira consulta WMI e o PowerShell levam dezenas de segundos.
const (
	checkinWait = 5 * time.Minute
	cmdTimeout  = 2 * time.Minute
)

var (
	reInstaller   = regexp.MustCompile(`^/api/v3/installer/$`)
	reNewAgent    = regexp.MustCompile(`^/api/v3/newagent/$`)
	reConfig      = regexp.MustCompile(`^/api/v3/[A-Za-z]+/config/$`)
	reRunChecks   = regexp.MustCompile(`^/api/v3/[A-Za-z]+/runchecks/$`)
	reCheckRunner = regexp.MustCompile(`^/api/v3/checkrunner/$`)
	reCheckin     = regexp.MustCompile(`^/api/v3/checkin/$`)
	reLogConfig   = regexp.MustCompile(`^/api/v3/[A-Za-z]+/logconfig/$`)
	reLogs        = regexp.MustCompile(`^/api/v3/logs/$`)
	reSnmp        = regexp.MustCompile(`^/api/v3/[A-Za-z]+/snmp/$`)
	reSoftware    = regexp.MustCompile(`^/api/v3/software/$`)
	reChoco       = regexp.MustCompile(`^/api/v3/choco/$`)
	reTaskRunner  = regexp.MustCompile(`^/api/v3/\d+/[A-Za-z]+/taskrunner/$`)
)

// TestAgent registra o agente com "eyes install --no-service", roda "eyes run" em primeiro plano
// e confere check-ins, comandos NATS, terminal, checks e as rotas REST periodicas.
func TestAgent(t *testing.T) {
	h := newHarness(t)
	work, err := os.MkdirTemp("", "eyes-smoke")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Melhor esforco: no Windows algum processo filho pode ainda segurar arquivos.
		if err := os.RemoveAll(work); err != nil {
			t.Logf("aviso: nao foi possivel apagar %s: %v", work, err)
		}
	})
	dataDir := filepath.Join(work, "data")
	env := cleanEnv("EYES_DATA_DIR=" + dataDir)
	if runtime.GOOS != "windows" {
		// O socket padrao do app de bandeja fica em /run ou /var/run (exige root).
		env = append(env, "EYES_TRAY_SOCKET="+filepath.Join(work, "tray.sock"))
	}

	// 1. Registro.
	_, err = runEyes(t, env, 3*time.Minute, "install", "--no-service",
		"--api", h.api.URL(), "--nats-url", h.NatsURL(),
		"--client-id", "1", "--site-id", "1", "--agent-type", "server", "--auth", h.api.installToken, "--desc", "smoke")
	if err != nil {
		t.Fatalf("eyes install falhou: %v\nchamadas REST:\n%s", err, h.api.describe())
	}
	checkRegistration(t, h, dataDir)
	agentID := h.agentID()

	// 2. Agente em primeiro plano.
	p := startAgent(t, env, filepath.Join(work, "eyes-run.log"))
	started := time.Now()
	t.Cleanup(func() {
		p.stop(t)
		if t.Failed() {
			t.Logf("log do agente (%s):\n%s", p.logPath, p.tail(96<<10))
			t.Logf("chamadas REST recebidas:\n%s", h.api.describe())
		}
	})

	// 3. Check-ins do primeiro contato.
	kinds := []string{"agent-hello", "agent-agentinfo", "agent-disks", "agent-wmi"}
	if runtime.GOOS == "windows" {
		kinds = append(kinds, "agent-winsvc")
	}
	ok := waitFor(checkinWait, time.Second, func() bool {
		if p.exited() {
			return true
		}
		for _, k := range kinds {
			if h.countCheckins(k) == 0 {
				return false
			}
		}
		return true
	})
	if p.exited() {
		t.Fatalf("eyes run terminou antes da hora: %v", p.err)
	}
	if !ok {
		var missing []string
		for _, k := range kinds {
			if h.countCheckins(k) == 0 {
				missing = append(missing, k)
			}
		}
		t.Fatalf("check-ins ausentes apos %s: %v", checkinWait, missing)
	}
	t.Logf("check-ins iniciais recebidos em %s", time.Since(started).Round(time.Millisecond))
	checkCheckins(t, h)

	// Os logs de sistema levam um ciclo (60 s) para chegar: o evento de teste e gerado em paralelo.
	logMarker := "eyes-smoke-" + randomHex(6)
	var logFound atomic.Bool
	logDone := make(chan struct{})
	go func() {
		defer close(logDone)
		emitLogsUntilSeen(t, h, logMarker, &logFound, 5*time.Minute)
	}()

	// 4. Comandos NATS.
	t.Run("ping", func(t *testing.T) {
		if v := h.call(t, "ping", nil, nil, 30*time.Second); v != "pong" {
			t.Fatalf("ping: esperado \"pong\", veio %s", brief(v))
		}
	})
	t.Run("rawcmd", func(t *testing.T) { testRawCmd(t, h) })
	t.Run("runscriptfull", func(t *testing.T) { testRunScript(t, h) })
	t.Run("procs", func(t *testing.T) { testProcs(t, h) })
	t.Run("sysinfo", func(t *testing.T) {
		before := h.countCheckins("agent-agentinfo")
		if v := h.call(t, "sysinfo", nil, nil, 30*time.Second); v != "ok" {
			t.Fatalf("sysinfo: esperado \"ok\", veio %s", brief(v))
		}
		if !waitFor(cmdTimeout, time.Second, func() bool { return h.countCheckins("agent-agentinfo") > before }) {
			t.Error("sysinfo nao reenviou agent-agentinfo")
		}
	})
	t.Run("softwarelist", func(t *testing.T) { testSoftwareList(t, h) })
	t.Run("wincare_catalog", func(t *testing.T) { testCareCatalog(t, h) })
	t.Run("wincare_health", func(t *testing.T) { testCareHealth(t, h) })
	t.Run("snmp_test", func(t *testing.T) { testSnmp(t, h) })
	if runtime.GOOS == "windows" {
		t.Run("winservices", func(t *testing.T) { testWinServices(t, h) })
		t.Run("eventlog", func(t *testing.T) { testEventLog(t, h) })
		t.Run("registry", func(t *testing.T) { testRegistry(t, h) })
	}
	t.Run("terminal", func(t *testing.T) { testTerminal(t, h, agentID) })
	t.Run("unknown_func", func(t *testing.T) {
		if v := h.call(t, "nao_existe", nil, nil, 30*time.Second); !isErrorText(v) {
			t.Fatalf("func desconhecido: esperado texto de erro, veio %s", brief(v))
		}
	})

	// 5. runchecks -> GET runchecks -> PATCH checkrunner com o resultado do diskspace.
	t.Run("runchecks", func(t *testing.T) { testRunChecks(t, h, agentID) })

	t.Run("runtask", func(t *testing.T) { testRunTask(t, h, agentID) })

	// 6. Rotas REST periodicas.
	t.Run("rest", func(t *testing.T) { testRestLoops(t, h, agentID, started) })

	<-logDone
	t.Run("logs", func(t *testing.T) {
		if logFound.Load() {
			return
		}
		msg := fmt.Sprintf("nenhum POST /api/v3/logs/ trouxe o evento %s (%d POSTs recebidos)", logMarker, len(h.api.find("POST", reLogs)))
		if runtime.GOOS == "darwin" {
			// O log unificado do macOS nao garante o nivel do "logger": so registra.
			t.Log("aviso: " + msg)
			return
		}
		t.Error(msg)
	})

	// 7. Conferencias finais.
	if p.exited() {
		t.Errorf("eyes run terminou durante o teste: %v", p.err)
	}
	if u := h.api.unknownRoutes(); len(u) > 0 {
		t.Errorf("o agente chamou rotas que o servidor nao tem: %v", u)
	}
	for _, r := range h.api.requests() {
		if r.Status == 401 || r.Status == 400 || r.Status >= 500 {
			t.Errorf("chamada REST recusada: %s %s -> %d (%s)", r.Method, r.Path, r.Status, truncate(string(r.Body), 300))
		}
	}
	if bad := h.badCheckins(); len(bad) > 0 {
		t.Errorf("check-ins invalidos: %v", bad)
	}
	h.auth.mu.Lock()
	rejected := h.auth.rejected
	h.auth.mu.Unlock()
	if rejected > 0 {
		t.Errorf("o NATS recusou %d autenticacoes", rejected)
	}
	t.Logf("resumo das chamadas REST:\n%s", h.api.describe())
}

// call envia o comando, falha o teste em erro de transporte e registra a resposta no log.
func (h *harness) call(t *testing.T, fn string, top map[string]any, payload map[string]string, timeout time.Duration) any {
	t.Helper()
	start := time.Now()
	v, err := h.request(fn, top, payload, timeout)
	if err != nil {
		t.Fatalf("%v (apos %s)", err, time.Since(start).Round(time.Millisecond))
	}
	t.Logf("%s %v -> (%s) %s", fn, payload, time.Since(start).Round(time.Millisecond), brief(v))
	return v
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

// ---------------------------------------------------------------------------------------------

func checkRegistration(t *testing.T, h *harness, dataDir string) {
	t.Helper()
	inst := h.api.find("POST", reInstaller)
	if len(h.api.find("GET", reInstaller)) == 0 || len(inst) == 0 {
		t.Fatalf("o install nao chamou GET e POST /api/v3/installer/:\n%s", h.api.describe())
	}
	if v, _ := inst[0].JSON()["version"].(string); !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(v) {
		t.Errorf("POST installer: version %q nao e X.Y.Z", v)
	}
	reg := h.api.find("POST", reNewAgent)
	if len(reg) != 1 {
		t.Fatalf("esperado 1 POST newagent, vieram %d", len(reg))
	}
	body := reg[0].JSON()
	t.Logf("newagent: %s", reg[0].Body)
	id, _ := body["agent_id"].(string)
	if !agentIDPattern.MatchString(id) {
		t.Errorf("agent_id %q nao tem 40 letras", id)
	}
	if body["plat"] != runtime.GOOS || body["goarch"] != runtime.GOARCH {
		t.Errorf("newagent: plat/goarch = %v/%v, esperado %s/%s", body["plat"], body["goarch"], runtime.GOOS, runtime.GOARCH)
	}
	if body["monitoring_type"] != "server" || body["description"] != "smoke" {
		t.Errorf("newagent: monitoring_type/description = %v/%v", body["monitoring_type"], body["description"])
	}
	if _, ok := body["mesh_node_id"]; ok {
		t.Errorf("newagent nao deveria mandar mesh_node_id (o MeshAgent saiu na fase 12.8)")
	}
	data, err := os.ReadFile(filepath.Join(dataDir, "eyes.json"))
	if err != nil {
		t.Fatalf("configuracao nao gravada em EYES_DATA_DIR: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("eyes.json invalido: %v", err)
	}
	wantID, wantToken := h.api.creds()
	if cfg["agent_id"] != wantID || cfg["token"] != wantToken || cfg["nats_url"] != h.NatsURL() {
		t.Fatalf("eyes.json nao guarda agent_id/token/nats_url emitidos: %v", cfg["agent_id"])
	}
}

// checkCheckins confere os tipos de cada check-in (contrato 3.2 e 3.3).
func checkCheckins(t *testing.T, h *harness) {
	t.Run("checkin/agent-hello", func(t *testing.T) {
		c, _ := h.lastCheckin("agent-hello")
		t.Logf("agent-hello: %s", brief(c.Body))
		if v, ok := c.Body["version"].(string); !ok || !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(v) {
			t.Errorf("version deve ser str X.Y.Z, veio %s", brief(c.Body["version"]))
		}
	})
	t.Run("checkin/agent-agentinfo", func(t *testing.T) {
		c, _ := h.lastCheckin("agent-agentinfo")
		b := c.Body
		t.Logf("agent-agentinfo: %s", brief(b))
		for _, k := range []string{"hostname", "operating_system", "plat", "logged_in_username", "goarch"} {
			if _, ok := b[k].(string); !ok {
				t.Errorf("%s deve ser str, veio %s", k, brief(b[k]))
			}
		}
		if b["plat"] != runtime.GOOS || b["goarch"] != runtime.GOARCH {
			t.Errorf("plat/goarch = %v/%v", b["plat"], b["goarch"])
		}
		if s, _ := b["operating_system"].(string); strings.TrimSpace(s) == "" {
			t.Error("operating_system vazio")
		}
		if n, ok := asNumber(b["total_ram"]); !ok || n <= 0 {
			t.Errorf("total_ram deve ser numero > 0 (GB), veio %s", brief(b["total_ram"]))
		}
		if n, ok := asNumber(b["boot_time"]); !ok || n < 1e9 || n > float64(time.Now().Unix()+60) {
			t.Errorf("boot_time deve ser segundos Unix, veio %s", brief(b["boot_time"]))
		}
		if _, ok := b["needs_reboot"].(bool); !ok {
			t.Errorf("needs_reboot deve ser bool, veio %s", brief(b["needs_reboot"]))
		}
	})
	t.Run("checkin/agent-disks", func(t *testing.T) {
		c, _ := h.lastCheckin("agent-disks")
		disks, ok := asList(c.Body["disks"])
		t.Logf("agent-disks: %s", brief(c.Body["disks"]))
		if !ok || len(disks) == 0 {
			t.Fatalf("disks deve ser lista nao vazia, veio %s", brief(c.Body["disks"]))
		}
		for _, d := range disks {
			m, ok := asMap(d)
			if !ok {
				t.Fatalf("item de disks nao e mapa: %s", brief(d))
			}
			for _, k := range []string{"device", "fstype", "total", "used", "free"} {
				if _, ok := m[k].(string); !ok {
					t.Errorf("disks[].%s deve ser str, veio %s", k, brief(m[k]))
				}
			}
			if n, ok := asNumber(m["percent"]); !ok || n < 0 || n > 100 {
				t.Errorf("disks[].percent deve ser numero 0..100, veio %s", brief(m["percent"]))
			}
		}
	})
	t.Run("checkin/agent-wmi", func(t *testing.T) {
		c, _ := h.lastCheckin("agent-wmi")
		w, ok := asMap(c.Body["wmi"])
		t.Logf("agent-wmi: %s", brief(c.Body["wmi"]))
		if !ok || len(w) == 0 {
			t.Fatalf("wmi deve ser mapa nao vazio, veio %s", brief(c.Body["wmi"]))
		}
		if runtime.GOOS == "windows" {
			// Secoes como listas de objetos com chaves em PascalCase (contrato 3.3).
			for _, sec := range []string{"comp_sys", "cpu"} {
				if _, ok := w[sec]; !ok {
					t.Errorf("wmi sem a secao %s", sec)
				}
			}
			return
		}
		for _, k := range []string{"cpus", "gpus", "disks", "local_ips"} {
			v, present := w[k]
			if !present {
				continue
			}
			l, ok := asList(v)
			if !ok {
				t.Errorf("wmi.%s deve ser lista de str, veio %s", k, brief(v))
				continue
			}
			for _, i := range l {
				if _, ok := i.(string); !ok {
					t.Errorf("wmi.%s tem item nao str: %s", k, brief(i))
				}
			}
		}
		if l, _ := asList(w["cpus"]); len(l) == 0 {
			t.Error("wmi.cpus vazio")
		}
		if _, ok := w["make_model"].(string); !ok {
			t.Logf("aviso: wmi.make_model ausente (%s)", brief(w["make_model"]))
		}
	})
	if runtime.GOOS == "windows" {
		t.Run("checkin/agent-winsvc", func(t *testing.T) {
			c, _ := h.lastCheckin("agent-winsvc")
			l, ok := asList(c.Body["services"])
			if !ok || len(l) == 0 {
				t.Fatalf("services deve ser lista nao vazia, veio %s", brief(c.Body["services"]))
			}
			t.Logf("agent-winsvc: %d servicos, primeiro %s", len(l), brief(l[0]))
			checkServiceItem(t, l[0])
		})
	}
	if c, ok := h.lastCheckin("agent-publicip"); ok {
		t.Logf("agent-publicip: %s", brief(c.Body))
	} else {
		t.Log("agent-publicip ainda nao chegou (depende de acesso a internet)")
	}
}

func checkServiceItem(t *testing.T, v any) {
	t.Helper()
	m, ok := asMap(v)
	if !ok {
		t.Fatalf("servico nao e mapa: %s", brief(v))
	}
	for _, k := range []string{"name", "display_name", "status", "start_type", "binpath", "username", "description"} {
		if _, ok := m[k].(string); !ok {
			t.Errorf("servico.%s deve ser str, veio %s", k, brief(m[k]))
		}
	}
	if !isInteger(m["pid"]) {
		t.Errorf("servico.pid deve ser int, veio %s", brief(m["pid"]))
	}
	if _, ok := m["autodelay"].(bool); !ok {
		t.Errorf("servico.autodelay deve ser bool, veio %s", brief(m["autodelay"]))
	}
}

// ---------------------------------------------------------------------------------------------
// Comandos

func testRawCmd(t *testing.T, h *harness) {
	type tc struct{ shell, command string }
	cases := []tc{{"/bin/sh", "echo ok"}, {"/bin/bash", "echo ok"}}
	if runtime.GOOS == "windows" {
		cases = []tc{{"cmd", "echo ok"}, {"powershell", "Write-Output ok"}}
	}
	for i, c := range cases {
		v := h.call(t, "rawcmd", map[string]any{"timeout": 120, "run_as_user": false, "id": 1000 + i},
			map[string]string{"command": c.command, "shell": c.shell}, 130*time.Second)
		s, ok := v.(string)
		if !ok || strings.TrimSpace(s) != "ok" {
			t.Errorf("rawcmd %s: esperado \"ok\", veio %s", c.shell, brief(v))
		}
	}
	// Erro: shell fora da lista do sistema.
	v := h.call(t, "rawcmd", map[string]any{"timeout": 30}, map[string]string{"command": "echo x", "shell": "nao-existe"}, time.Minute)
	if !isErrorText(v) {
		t.Errorf("rawcmd com shell invalido: esperado \"error: ...\", veio %s", brief(v))
	}
}

func testRunScript(t *testing.T, h *harness) {
	shell, code := "shell", "#!/bin/sh\necho \"script $1\"\necho \"var $SMOKE_VAR\"\necho erro-smoke >&2\nexit 3\n"
	if runtime.GOOS == "windows" {
		shell = "powershell"
		code = "Write-Output \"script $($args[0])\"\nWrite-Output \"var $env:SMOKE_VAR\"\n[Console]::Error.WriteLine('erro-smoke')\nexit 3\n"
	}
	v := h.call(t, "runscriptfull", map[string]any{
		"timeout": 120, "script_args": []string{"arg1"}, "run_as_user": false, "env_vars": []string{"SMOKE_VAR=valor"},
		"nushell_enable_config": false, "deno_default_permissions": "", "id": 2000,
	}, map[string]string{"code": code, "shell": shell}, 135*time.Second)
	m, ok := asMap(v)
	if !ok {
		t.Fatalf("runscriptfull deve responder mapa, veio %s", brief(v))
	}
	stdout, ok1 := m["stdout"].(string)
	stderr, ok2 := m["stderr"].(string)
	if !ok1 || !ok2 {
		t.Fatalf("stdout/stderr devem ser str: %s", brief(m))
	}
	if !strings.Contains(stdout, "script arg1") || !strings.Contains(stdout, "var valor") {
		t.Errorf("stdout sem argumento ou variavel de ambiente: %q", stdout)
	}
	if !strings.Contains(stderr, "erro-smoke") {
		t.Errorf("stderr sem a mensagem: %q", stderr)
	}
	if n, ok := asNumber(m["retcode"]); !ok || !isInteger(m["retcode"]) || n != 3 {
		t.Errorf("retcode deve ser int 3, veio %s", brief(m["retcode"]))
	}
	if n, ok := asNumber(m["execution_time"]); !ok || n < 0 {
		t.Errorf("execution_time deve ser numero >= 0, veio %s", brief(m["execution_time"]))
	}
}

func testProcs(t *testing.T, h *harness) {
	v := h.call(t, "procs", nil, nil, 30*time.Second)
	l, ok := asList(v)
	if !ok || len(l) == 0 {
		t.Fatalf("procs deve ser lista nao vazia, veio %s", brief(v))
	}
	self := false
	for _, i := range l {
		m, ok := asMap(i)
		if !ok {
			t.Fatalf("item de procs nao e mapa: %s", brief(i))
		}
		if !isInteger(m["pid"]) || !isInteger(m["membytes"]) {
			t.Fatalf("pid/membytes devem ser int: %s", brief(m))
		}
		if _, ok := m["name"].(string); !ok {
			t.Fatalf("name deve ser str: %s", brief(m))
		}
		if _, ok := m["username"].(string); !ok {
			t.Fatalf("username deve ser str: %s", brief(m))
		}
		cpu, ok := m["cpu_percent"].(string)
		if !ok {
			t.Fatalf("cpu_percent deve ser str (contrato 4.3), veio %s", brief(m["cpu_percent"]))
		}
		if !regexp.MustCompile(`^\d+(\.\d+)?$`).MatchString(cpu) {
			t.Errorf("cpu_percent %q nao e numero em texto", cpu)
		}
		if n, _ := asNumber(m["pid"]); int(n) == os.Getpid() {
			self = true
		}
	}
	if !self {
		t.Errorf("procs (%d itens) nao lista o proprio processo do teste (pid %d)", len(l), os.Getpid())
	}
}

func testSoftwareList(t *testing.T, h *harness) {
	v := h.call(t, "softwarelist", nil, nil, 70*time.Second)
	l, ok := asList(v)
	if !ok {
		t.Fatalf("softwarelist deve ser lista, veio %s", brief(v))
	}
	t.Logf("softwarelist: %d itens", len(l))
	if len(l) == 0 && runtime.GOOS != "darwin" {
		t.Error("softwarelist vazio")
	}
	for _, i := range l {
		m, ok := asMap(i)
		if !ok {
			t.Fatalf("item nao e mapa: %s", brief(i))
		}
		for k, val := range m {
			if _, ok := val.(string); !ok {
				t.Fatalf("software.%s deve ser str (o console le so str), veio %s", k, brief(val))
			}
		}
		if s, _ := m["name"].(string); s == "" {
			t.Fatalf("software sem nome: %s", brief(m))
		}
	}
}

func testCareCatalog(t *testing.T, h *harness) {
	v := h.call(t, "wincare_catalog", nil, map[string]string{}, 30*time.Second)
	s, ok := v.(string)
	if !ok || isErrorText(v) {
		t.Fatalf("wincare_catalog deve ser str JSON, veio %s", brief(v))
	}
	var cat struct {
		Version string `json:"version"`
		Modules []struct {
			Key       string   `json:"key"`
			Platforms []string `json:"platforms"`
			Tasks     []struct {
				Key         string   `json:"key"`
				Platforms   []string `json:"platforms"`
				SelfService *bool    `json:"selfService"`
			} `json:"tasks"`
		} `json:"modules"`
	}
	if err := json.Unmarshal([]byte(s), &cat); err != nil {
		t.Fatalf("catalogo nao e JSON: %v", err)
	}
	if len(cat.Modules) == 0 {
		t.Fatal("catalogo sem modulos")
	}
	var keys []string
	for _, m := range cat.Modules {
		keys = append(keys, m.Key)
		if strings.Contains(m.Key, ".") || !slices.Contains(m.Platforms, runtime.GOOS) {
			t.Errorf("modulo %q invalido para %s (platforms %v)", m.Key, runtime.GOOS, m.Platforms)
		}
		if len(m.Tasks) == 0 {
			t.Errorf("modulo %q sem tarefas", m.Key)
		}
		for _, tk := range m.Tasks {
			if tk.Key == "" || strings.ContainsAny(tk.Key, ".,") || len(tk.Key) > 64 {
				t.Errorf("tarefa %q invalida no modulo %s", tk.Key, m.Key)
			}
			if len(tk.Platforms) > 0 && !slices.Contains(tk.Platforms, runtime.GOOS) {
				t.Errorf("tarefa %s.%s nao e de %s (platforms %v)", m.Key, tk.Key, runtime.GOOS, tk.Platforms)
			}
		}
	}
	t.Logf("catalogo %s: modulos %v", cat.Version, keys)
	if !slices.Contains(keys, "maintenance") {
		t.Error("catalogo sem o modulo maintenance")
	}
	if runtime.GOOS == "windows" && !slices.Contains(keys, "windows_update") {
		t.Error("catalogo do Windows sem o modulo windows_update")
	}
	if runtime.GOOS != "windows" && slices.Contains(keys, "windows_update") {
		t.Error("catalogo fora do Windows com o modulo windows_update")
	}
}

func testCareHealth(t *testing.T, h *harness) {
	v := h.call(t, "wincare_health", nil, map[string]string{}, 7*time.Minute)
	s, ok := v.(string)
	if !ok || isErrorText(v) {
		t.Fatalf("wincare_health deve ser str JSON, veio %s", brief(v))
	}
	var rep map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &rep); err != nil {
		t.Fatalf("relatorio nao e JSON: %v", err)
	}
	var score int
	if err := json.Unmarshal(rep["score"], &score); err != nil || score < 0 || score > 100 {
		t.Errorf("score deve ser inteiro 0..100, veio %s (%v)", rep["score"], err)
	}
	var grade, platform, collected string
	_ = json.Unmarshal(rep["grade"], &grade)
	_ = json.Unmarshal(rep["platform"], &platform)
	_ = json.Unmarshal(rep["collectedAt"], &collected)
	if !slices.Contains([]string{"otimo", "bom", "atencao", "critico"}, grade) {
		t.Errorf("grade invalido: %q", grade)
	}
	if platform != runtime.GOOS {
		t.Errorf("platform = %q, esperado %s", platform, runtime.GOOS)
	}
	if _, err := time.Parse(time.RFC3339, collected); err != nil {
		t.Errorf("collectedAt nao e RFC 3339: %q", collected)
	}
	var items []struct {
		Key    string   `json:"key"`
		Status string   `json:"status"`
		Value  *string  `json:"value"`
		Weight *float64 `json:"weight"`
		Points *float64 `json:"points"`
	}
	if err := json.Unmarshal(rep["items"], &items); err != nil || len(items) == 0 {
		t.Fatalf("items deve ser lista nao vazia: %v", err)
	}
	for _, it := range items {
		if !slices.Contains([]string{"ok", "warning", "critical", "unknown"}, it.Status) || it.Value == nil || it.Weight == nil || it.Points == nil {
			t.Errorf("item de saude invalido: %+v", it)
		}
	}
}

func testSnmp(t *testing.T, h *harness) {
	target := `{"host":"127.0.0.1","port":1,"version":"v2c","community":"public","timeout":1,"retries":0,"interval":60,"interfaces":false,"sensors":[]}`
	v := h.call(t, "snmp_test", nil, map[string]string{"target": target}, 60*time.Second)
	s, ok := v.(string)
	if !ok || isErrorText(v) {
		t.Fatalf("snmp_test deve ser str JSON, veio %s", brief(v))
	}
	var rep struct {
		Reachable *bool    `json:"reachable"`
		Error     *string  `json:"error"`
		RTT       *float64 `json:"rtt_ms"`
	}
	if err := json.Unmarshal([]byte(s), &rep); err != nil {
		t.Fatalf("snmp_test nao e JSON: %v", err)
	}
	if rep.Reachable == nil || *rep.Reachable {
		t.Errorf("127.0.0.1:1 deveria ser reachable=false: %s", s)
	}
	if rep.Error == nil || *rep.Error == "" {
		t.Errorf("snmp_test sem mensagem de erro: %s", s)
	}
	if rep.RTT == nil {
		t.Errorf("snmp_test sem rtt_ms: %s", s)
	}
}

// ---------------------------------------------------------------------------------------------
// Somente Windows

func testWinServices(t *testing.T, h *harness) {
	v := h.call(t, "winservices", nil, nil, 30*time.Second)
	l, ok := asList(v)
	if !ok || len(l) == 0 {
		t.Fatalf("winservices deve ser lista nao vazia, veio %s", brief(v))
	}
	found := false
	for _, i := range l {
		if m, ok := asMap(i); ok && strings.EqualFold(fmt.Sprint(m["name"]), "EventLog") {
			found = true
			checkServiceItem(t, m)
		}
	}
	if !found {
		t.Error("winservices nao lista o EventLog")
	}
	v = h.call(t, "winsvcdetail", nil, map[string]string{"name": "EventLog"}, 30*time.Second)
	m, ok := asMap(v)
	if !ok {
		t.Fatalf("winsvcdetail deve ser mapa, veio %s", brief(v))
	}
	checkServiceItem(t, m)
	if m["status"] != "running" {
		t.Errorf("EventLog deveria estar running, veio %v", m["status"])
	}
	v = h.call(t, "winsvcdetail", nil, map[string]string{"name": "NaoExisteEyesSmoke"}, 30*time.Second)
	if !isErrorText(v) {
		t.Errorf("winsvcdetail de servico inexistente: esperado \"error: ...\", veio %s", brief(v))
	}
}

func testEventLog(t *testing.T, h *harness) {
	v := h.call(t, "eventlog", map[string]any{"timeout": 90}, map[string]string{"logname": "System", "days": "1"}, 100*time.Second)
	l, ok := asList(v)
	if !ok {
		t.Fatalf("eventlog deve ser lista, veio %s", brief(v))
	}
	t.Logf("eventlog System: %d eventos", len(l))
	for _, i := range l {
		m, ok := asMap(i)
		if !ok {
			t.Fatalf("evento nao e mapa: %s", brief(i))
		}
		if !isInteger(m["eventID"]) {
			t.Fatalf("eventID deve ser int: %s", brief(m))
		}
		for _, k := range []string{"source", "eventType", "message", "time"} {
			if _, ok := m[k].(string); !ok {
				t.Fatalf("%s deve ser str: %s", k, brief(m))
			}
		}
	}
}

func testRegistry(t *testing.T, h *harness) {
	const base = `HKCU\Software\EYESSmoke`
	const renamed = `HKCU\Software\EYESSmoke2`
	// Limpa restos de execucoes anteriores (ignora erro).
	for _, p := range []string{base, renamed} {
		_, _ = h.request("registry_delete_key", nil, map[string]string{"path": p}, 30*time.Second)
	}
	t.Cleanup(func() {
		for _, p := range []string{base, renamed} {
			_ = exec.Command("reg", "delete", p, "/f").Run()
		}
	})
	browse := func(path string) map[string]any {
		t.Helper()
		v := h.call(t, "registry_browse", nil, map[string]string{"path": path, "page": "1", "page_size": "200"}, 30*time.Second)
		m, ok := asMap(v)
		if !ok {
			t.Fatalf("registry_browse %s deve ser mapa, veio %s", path, brief(v))
		}
		if e, ok := m["error"]; ok {
			t.Fatalf("registry_browse %s: erro %v", path, e)
		}
		if _, ok := m["has_more"].(bool); !ok {
			t.Errorf("registry_browse %s: has_more deve ser bool", path)
		}
		return m
	}
	names := func(m map[string]any, key, field string) []string {
		var out []string
		l, _ := asList(m[key])
		for _, i := range l {
			if mm, ok := asMap(i); ok {
				out = append(out, fmt.Sprint(mm[field]))
			}
		}
		return out
	}
	write := func(fn string, payload map[string]string) {
		t.Helper()
		v := h.call(t, fn, nil, payload, 30*time.Second)
		if v != "ok" {
			t.Fatalf("%s: esperado \"ok\", veio %s", fn, brief(v))
		}
	}

	root := browse("computer")
	if subs := names(root, "subkeys", "name"); !slices.Contains(subs, "HKLM") && !slices.Contains(subs, "HKEY_LOCAL_MACHINE") {
		t.Errorf("raiz sem HKLM: %v", subs)
	}
	sw := browse(`HKLM\SOFTWARE`)
	if subs := names(sw, "subkeys", "name"); !slices.ContainsFunc(subs, func(s string) bool { return strings.EqualFold(s, "Microsoft") }) {
		t.Errorf(`HKLM\SOFTWARE sem Microsoft: %v`, subs)
	}

	write("registry_create_key", map[string]string{"path": base})
	write("registry_create_value", map[string]string{"path": base, "name": "Texto", "type": "REG_SZ", "data": "abc"})
	write("registry_create_value", map[string]string{"path": base, "name": "Numero", "type": "REG_DWORD", "data": "0x10"})
	m := browse(base)
	values := map[string]string{}
	l, _ := asList(m["values"])
	for _, i := range l {
		if mm, ok := asMap(i); ok {
			values[fmt.Sprint(mm["name"])] = fmt.Sprint(mm["data"])
		}
	}
	if values["Texto"] != "abc" || values["Numero"] != "16" {
		t.Errorf("valores criados nao conferem: %v", values)
	}
	write("registry_modify_value", map[string]string{"path": base, "name": "Texto", "type": "REG_SZ", "data": "def"})
	write("registry_rename_value", map[string]string{"path": base, "old_name": "Texto", "new_name": "Texto2"})
	m = browse(base)
	if vs := names(m, "values", "name"); !slices.Contains(vs, "Texto2") || slices.Contains(vs, "Texto") {
		t.Errorf("rename_value nao refletiu: %v", vs)
	}
	write("registry_delete_value", map[string]string{"path": base, "name": "Texto2"})
	write("registry_rename_key", map[string]string{"old_path": base, "new_path": renamed})
	m = browse(renamed)
	if vs := names(m, "values", "name"); !slices.Contains(vs, "Numero") {
		t.Errorf("rename_key perdeu os valores: %v", vs)
	}
	write("registry_delete_key", map[string]string{"path": renamed})
	v := h.call(t, "registry_browse", nil, map[string]string{"path": renamed, "page": "1", "page_size": "200"}, 30*time.Second)
	if mm, ok := asMap(v); !ok || mm["error"] == nil {
		t.Errorf("browse de chave apagada deveria devolver {error}, veio %s", brief(v))
	}
}

// ---------------------------------------------------------------------------------------------
// Terminal

func testTerminal(t *testing.T, h *harness, agentID string) {
	session := randomHex(16)
	frames := make(chan *nats.Msg, 4096)
	sub, err := h.nc.ChanSubscribe(agentID+".terminal."+session, frames)
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Unsubscribe()
	if err := h.nc.Flush(); err != nil {
		t.Fatal(err)
	}
	shell, enter := "/bin/bash", "\n"
	if runtime.GOOS == "windows" {
		shell, enter = "cmd", "\r"
	}
	h.publish("terminal_start", map[string]any{"run_as_user": false}, map[string]string{"session_id": session, "shell": shell})
	h.publish("terminal_resize", nil, map[string]string{"session_id": session, "cols": "120", "rows": "30"})

	var out []byte
	var end map[string]any
	read := func(timeout time.Duration, until func() bool) {
		deadline := time.After(timeout)
		for end == nil && !until() {
			select {
			case msg := <-frames:
				var v any
				if err := msgpack.Unmarshal(msg.Data, &v); err != nil {
					t.Errorf("quadro msgpack invalido: %v", err)
					continue
				}
				switch x := v.(type) {
				case []byte:
					out = append(out, x...)
				case string:
					t.Errorf("quadro de saida em str (o contrato pede bin): %q", x)
					out = append(out, x...)
				case map[string]any:
					end = x
				default:
					t.Errorf("quadro de tipo inesperado: %s", brief(v))
				}
			case <-deadline:
				return
			}
		}
	}
	// Espera o prompt antes de digitar (no Windows o cmd demora a abrir).
	read(60*time.Second, func() bool { return len(out) > 0 })
	if end != nil {
		t.Fatalf("terminal terminou antes da entrada: %v; saida %q", end, stripANSI(out))
	}
	if len(out) == 0 {
		t.Log("aviso: nenhum prompt em 60 s; enviando a entrada mesmo assim")
	}
	h.publish("terminal_input", nil, map[string]string{"session_id": session, "data": "echo smoke-term" + enter})
	seen := func() bool { return terminalEchoed(stripANSI(out)) }
	read(60*time.Second, seen)
	text := stripANSI(out)
	t.Logf("saida do terminal (sem ANSI, %d bytes crus):\n%s", len(out), truncate(text, 2000))
	if !strings.Contains(text, "smoke-term") {
		t.Errorf("a saida do terminal nao contem smoke-term")
	} else if !seen() {
		t.Errorf("a saida do terminal so tem o eco da entrada, sem a saida do echo")
	}
	h.publish("terminal_kill", nil, map[string]string{"session_id": session})
	read(45*time.Second, func() bool { return false })
	if end == nil {
		t.Fatal("o quadro de fim { done, exit_code } nao chegou depois do terminal_kill")
	}
	t.Logf("quadro de fim: %s", brief(end))
	if end["done"] != true || !isInteger(end["exit_code"]) {
		t.Errorf("quadro de fim invalido: %s", brief(end))
	}
	if _, ok := end["output"]; ok {
		t.Errorf("quadro de fim nao deveria ter output: %s", brief(end))
	}
}

// terminalEchoed informa se a saida do comando apareceu (uma linha so com smoke-term, ou o texto
// repetido: eco da entrada mais a saida).
func terminalEchoed(text string) bool {
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "smoke-term" {
			return true
		}
	}
	return strings.Count(text, "smoke-term") >= 2
}

// ---------------------------------------------------------------------------------------------
// Checks e REST

func testRunChecks(t *testing.T, h *harness, agentID string) {
	before := len(h.api.find("GET", reRunChecks))
	sent := time.Now()
	h.publish("runchecks", nil, nil)
	var patch request
	ok := waitFor(cmdTimeout, 500*time.Millisecond, func() bool {
		if len(h.api.find("GET", reRunChecks)) <= before {
			return false
		}
		for _, r := range h.api.find("PATCH", reCheckRunner) {
			if r.At.After(sent) {
				patch = r
				return true
			}
		}
		return false
	})
	if !ok {
		t.Fatalf("runchecks: GET runchecks=%d (antes %d) e nenhum PATCH checkrunner depois do comando",
			len(h.api.find("GET", reRunChecks)), before)
	}
	t.Logf("PATCH checkrunner: %s", patch.Body)
	b := patch.JSON()
	if b["id"] != float64(diskCheckID) || b["agent_id"] != agentID {
		t.Errorf("PATCH checkrunner com id/agent_id errados: %s", patch.Body)
	}
	if b["exists"] != true {
		t.Errorf("o disco do sistema deveria existir: %s", patch.Body)
	}
	if n, ok := b["percent_used"].(float64); !ok || n <= 0 || n > 100 {
		t.Errorf("percent_used deve ser numero 0..100: %s", patch.Body)
	}
	if s, ok := b["more_info"].(string); !ok || s == "" {
		t.Errorf("more_info deve ser str nao vazia: %s", patch.Body)
	}
	if patch.Status != 200 {
		t.Errorf("PATCH checkrunner recusado: %d", patch.Status)
	}
}

func testRunTask(t *testing.T, h *harness, agentID string) {
	h.publish("runtask", map[string]any{"taskpk": taskPK}, nil)
	var patch request
	if !waitFor(cmdTimeout, 500*time.Millisecond, func() bool {
		l := h.api.find("PATCH", reTaskRunner)
		if len(l) == 0 {
			return false
		}
		patch = l[0]
		return true
	}) {
		t.Fatalf("runtask: nenhum PATCH taskrunner (GETs: %d)", len(h.api.find("GET", reTaskRunner)))
	}
	t.Logf("PATCH %s: %s", patch.Path, patch.Body)
	if want := fmt.Sprintf("/api/v3/%d/%s/taskrunner/", taskPK, agentID); patch.Path != want {
		t.Errorf("rota do resultado %s, esperado %s", patch.Path, want)
	}
	b := patch.JSON()
	stdout, ok1 := b["stdout"].(string)
	_, ok2 := b["stderr"].(string)
	if !ok1 || !ok2 {
		t.Fatalf("stdout/stderr devem ser str (numero derruba o servidor): %s", patch.Body)
	}
	if !strings.Contains(stdout, taskMarker) {
		t.Errorf("stdout sem %s: %q", taskMarker, stdout)
	}
	if b["retcode"] != float64(0) {
		t.Errorf("retcode deve ser 0: %v", b["retcode"])
	}
	if _, ok := b["execution_time"].(float64); !ok {
		t.Errorf("execution_time deve ser numero: %v", b["execution_time"])
	}
}

func testRestLoops(t *testing.T, h *harness, agentID string, started time.Time) {
	type want struct {
		method string
		re     *regexp.Regexp
	}
	wants := []want{{"GET", reConfig}, {"POST", reCheckin}, {"GET", reLogConfig}, {"GET", reSnmp}, {"POST", reSoftware}}
	if runtime.GOOS == "windows" {
		wants = append(wants, want{"POST", reChoco})
	}
	// O inventario de software sai 2 min depois da partida.
	limit := time.Until(started.Add(5 * time.Minute))
	if limit < 30*time.Second {
		limit = 30 * time.Second
	}
	waitFor(limit, time.Second, func() bool {
		for _, w := range wants {
			if len(h.api.find(w.method, w.re)) == 0 {
				return false
			}
		}
		return true
	})
	for _, w := range wants {
		got := h.api.find(w.method, w.re)
		if len(got) == 0 {
			t.Errorf("o agente nao chamou %s %s", w.method, w.re)
			continue
		}
		if got[0].Status != 200 {
			t.Errorf("%s %s -> %d", w.method, got[0].Path, got[0].Status)
		}
		if w.method == "GET" && !strings.Contains(got[0].Path, "/"+agentID+"/") {
			t.Errorf("%s nao usa o agent_id registrado", got[0].Path)
		}
	}
	if sw := h.api.find("POST", reSoftware); len(sw) > 0 {
		var body struct {
			Software []map[string]any `json:"software"`
		}
		if err := json.Unmarshal(sw[0].Body, &body); err != nil {
			t.Errorf("POST software invalido: %v", err)
		} else {
			t.Logf("POST software: %d itens", len(body.Software))
		}
	}
}

// emitLogsUntilSeen gera um evento de nivel erro no log do sistema a cada 20 s, ate ele chegar
// num POST /api/v3/logs/ (a coleta comeca do momento atual e roda a cada 60 s).
func emitLogsUntilSeen(t *testing.T, h *harness, marker string, found *atomic.Bool, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	if !waitFor(2*time.Minute, time.Second, func() bool { return len(h.api.find("GET", reLogConfig)) > 0 }) {
		return
	}
	var last time.Time
	for time.Now().Before(deadline) {
		for _, r := range h.api.find("POST", reLogs) {
			if bytes.Contains(r.Body, []byte(marker)) {
				found.Store(true)
				var body struct {
					Entries []map[string]any `json:"entries"`
				}
				_ = json.Unmarshal(r.Body, &body)
				for _, e := range body.Entries {
					if strings.Contains(fmt.Sprint(e["message"]), marker) {
						t.Logf("evento de log recebido: %s", brief(e))
					}
				}
				return
			}
		}
		if time.Since(last) >= 20*time.Second {
			last = time.Now()
			if err := emitSystemLog(marker); err != nil {
				t.Logf("aviso: falha ao gerar evento de log: %v", err)
			}
		}
		time.Sleep(time.Second)
	}
}

func emitSystemLog(marker string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("eventcreate", "/T", "ERROR", "/ID", "999", "/L", "APPLICATION", "/SO", "EYESSmoke", "/D", marker)
	default:
		cmd = exec.Command("logger", "-p", "user.err", "-t", "eyes-smoke", marker)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, out)
	}
	return nil
}
