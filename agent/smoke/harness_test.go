//go:build smoke

package smoke

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/vmihailenco/msgpack/v5"
)

// eyesBin e o binario do agente usado por todos os testes (compilado em TestMain ou EYES_BIN).
var eyesBin string

func TestMain(m *testing.M) {
	code := func() int {
		if p := os.Getenv("EYES_BIN"); p != "" {
			abs, err := filepath.Abs(p)
			if err != nil {
				fmt.Fprintln(os.Stderr, "EYES_BIN invalido:", err)
				return 2
			}
			eyesBin = abs
			return m.Run()
		}
		dir, err := os.MkdirTemp("", "eyes-smoke-bin")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		defer os.RemoveAll(dir)
		name := "eyes"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		eyesBin = filepath.Join(dir, name)
		start := time.Now()
		cmd := exec.Command(goTool(), "build", "-o", eyesBin, "./cmd/eyes")
		cmd.Dir = ".." // a pasta do modulo (agent/)
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "falha ao compilar o EYES: %v\n%s\n", err, out)
			return 2
		}
		fmt.Printf("EYES compilado em %s (%s)\n", eyesBin, time.Since(start).Round(time.Millisecond))
		return m.Run()
	}()
	os.Exit(code)
}

// goTool acha o go no PATH ou no GOROOT (sudo pode limpar o PATH).
func goTool() string {
	if p, err := exec.LookPath("go"); err == nil {
		return p
	}
	return filepath.Join(runtime.GOROOT(), "bin", "go")
}

// ---------------------------------------------------------------------------------------------
// NATS embutido

const serverUser = "server"

// natsAuth aceita o usuario "server" (sem restricoes) e o agente registrado no servidor falso,
// com as mesmas permissoes que o Cybereyes grava no arquivo de usuarios (contrato 1.2).
type natsAuth struct {
	api      *fakeAPI
	password string

	mu       sync.Mutex
	rejected int
}

func (a *natsAuth) Check(c server.ClientAuthentication) bool {
	o := c.GetOpts()
	if o.Username == serverUser && o.Password == a.password {
		c.RegisterUser(&server.User{Username: serverUser})
		return true
	}
	id, token := a.api.creds()
	if id != "" && o.Username == id && o.Password == token {
		c.RegisterUser(&server.User{Username: id, Permissions: &server.Permissions{
			Publish:   &server.SubjectPermission{Allow: []string{id, id + ".cmdoutput.>", id + ".terminal.>"}},
			Subscribe: &server.SubjectPermission{Allow: []string{id}},
			Response:  &server.ResponsePermission{MaxMsgs: 1, Expires: 1435 * time.Minute},
		}})
		return true
	}
	a.mu.Lock()
	a.rejected++
	a.mu.Unlock()
	return false
}

// checkin e uma mensagem do agente publicada em <agent_id> com reply "agent-<tipo>".
type checkin struct {
	Kind string
	Body map[string]any
	At   time.Time
}

// harness junta o servidor REST falso, o NATS embutido e a conexao do "servidor".
type harness struct {
	t    *testing.T
	api  *fakeAPI
	ns   *server.Server
	auth *natsAuth
	nc   *nats.Conn

	mu       sync.Mutex
	checkins []checkin
	bad      []string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{t: t, api: newFakeAPI(t)}
	h.auth = &natsAuth{api: h.api, password: randomHex(16)}
	opts := &server.Options{
		Host:                       "127.0.0.1",
		Port:                       server.RANDOM_PORT,
		NoLog:                      true,
		NoSigs:                     true,
		MaxPayload:                 64 << 20,
		CustomClientAuthentication: h.auth,
	}
	ns, err := server.NewServer(opts)
	if err != nil {
		t.Fatalf("NATS embutido: %v", err)
	}
	go ns.Start()
	if !ns.ReadyForConnections(15 * time.Second) {
		t.Fatal("NATS embutido nao ficou pronto")
	}
	h.ns = ns
	t.Cleanup(ns.Shutdown)

	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo(serverUser, h.auth.password), nats.Name("smoke-server"))
	if err != nil {
		t.Fatalf("conexao do servidor ao NATS: %v", err)
	}
	t.Cleanup(nc.Close)
	h.nc = nc
	// Como o CheckinConsumer do Cybereyes: assina "*" e so trata reply "agent-*".
	if _, err := nc.Subscribe("*", h.onCheckin); err != nil {
		t.Fatal(err)
	}
	if err := nc.Flush(); err != nil {
		t.Fatal(err)
	}
	return h
}

// NatsURL e o endereco nats:// do servidor embutido.
func (h *harness) NatsURL() string { return h.ns.ClientURL() }

func (h *harness) onCheckin(msg *nats.Msg) {
	if !strings.HasPrefix(msg.Reply, "agent-") {
		return
	}
	var body map[string]any
	if err := msgpack.Unmarshal(msg.Data, &body); err != nil {
		h.mu.Lock()
		h.bad = append(h.bad, fmt.Sprintf("%s em %s: msgpack invalido: %v", msg.Reply, msg.Subject, err))
		h.mu.Unlock()
		return
	}
	if id, _ := body["agent_id"].(string); id != msg.Subject {
		h.mu.Lock()
		h.bad = append(h.bad, fmt.Sprintf("%s em %s: agent_id %v diferente do assunto", msg.Reply, msg.Subject, body["agent_id"]))
		h.mu.Unlock()
	}
	h.mu.Lock()
	h.checkins = append(h.checkins, checkin{Kind: msg.Reply, Body: body, At: time.Now()})
	h.mu.Unlock()
}

// lastCheckin devolve o ultimo check-in do tipo (ok falso se nenhum chegou).
func (h *harness) lastCheckin(kind string) (checkin, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.checkins) - 1; i >= 0; i-- {
		if h.checkins[i].Kind == kind {
			return h.checkins[i], true
		}
	}
	return checkin{}, false
}

func (h *harness) countCheckins(kind string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, c := range h.checkins {
		if c.Kind == kind {
			n++
		}
	}
	return n
}

func (h *harness) badCheckins() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.bad...)
}

// agentID devolve o agent_id registrado (falha se o registro nao aconteceu).
func (h *harness) agentID() string {
	h.t.Helper()
	id, _ := h.api.creds()
	if id == "" {
		h.t.Fatal("o agente ainda nao se registrou")
	}
	return id
}

// request envia um comando como o AgentRpc do servidor: mapa msgpack com func, campos de topo e
// payload (mapa de str). Devolve a resposta decodificada.
func (h *harness) request(fn string, top map[string]any, payload map[string]string, timeout time.Duration) (any, error) {
	data, err := encodeCommand(fn, top, payload)
	if err != nil {
		return nil, err
	}
	msg, err := h.nc.Request(h.agentID(), data, timeout)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", fn, err)
	}
	var v any
	if err := msgpack.Unmarshal(msg.Data, &v); err != nil {
		return nil, fmt.Errorf("%s: resposta msgpack invalida: %w", fn, err)
	}
	return v, nil
}

// publish envia um comando sem reply (terminal, runchecks, runtask...).
func (h *harness) publish(fn string, top map[string]any, payload map[string]string) {
	h.t.Helper()
	data, err := encodeCommand(fn, top, payload)
	if err != nil {
		h.t.Fatal(err)
	}
	if err := h.nc.Publish(h.agentID(), data); err != nil {
		h.t.Fatal(err)
	}
	if err := h.nc.Flush(); err != nil {
		h.t.Fatal(err)
	}
}

func encodeCommand(fn string, top map[string]any, payload map[string]string) ([]byte, error) {
	m := map[string]any{"func": fn}
	for k, v := range top {
		m[k] = v
	}
	if payload != nil {
		m["payload"] = payload
	}
	return msgpack.Marshal(m)
}

// ---------------------------------------------------------------------------------------------
// Processos

// cleanEnv devolve o ambiente atual sem as variaveis que mudam o comportamento do agente.
func cleanEnv(extra ...string) []string {
	var out []string
	for _, kv := range os.Environ() {
		k := strings.ToUpper(strings.SplitN(kv, "=", 2)[0])
		if k == "EYES_DATA_DIR" || k == "EYES_TRAY_SOCKET" {
			continue
		}
		out = append(out, kv)
	}
	return append(out, extra...)
}

// runEyes executa o binario ate terminar e devolve a saida combinada.
func runEyes(t *testing.T, env []string, timeout time.Duration, args ...string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, eyesBin, args...)
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	t.Logf("$ eyes %s\n%s", strings.Join(redact(args), " "), strings.TrimRight(string(out), "\r\n"))
	return string(out), err
}

// redact esconde o valor de --auth no log.
func redact(args []string) []string {
	out := append([]string(nil), args...)
	for i := range out {
		if out[i] == "--auth" && i+1 < len(out) {
			out[i+1] = "***"
		}
	}
	return out
}

// agentProc e o "eyes run" em execucao, com stdout e stderr num arquivo.
type agentProc struct {
	cmd     *exec.Cmd
	logPath string
	logFile *os.File
	done    chan struct{}
	err     error
}

func startAgent(t *testing.T, env []string, logPath string) *agentProc {
	t.Helper()
	f, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(eyesBin, "run")
	cmd.Env = env
	cmd.Stdout = f
	cmd.Stderr = f
	if err := cmd.Start(); err != nil {
		f.Close()
		t.Fatalf("falha ao iniciar eyes run: %v", err)
	}
	p := &agentProc{cmd: cmd, logPath: logPath, logFile: f, done: make(chan struct{})}
	go func() {
		p.err = cmd.Wait()
		close(p.done)
	}()
	t.Logf("eyes run iniciado (pid %d), log em %s", cmd.Process.Pid, logPath)
	return p
}

// exited informa se o processo ja terminou.
func (p *agentProc) exited() bool {
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

// stop encerra o agente (SIGTERM no Unix; no Windows nao ha sinal, entao mata o processo).
func (p *agentProc) stop(t *testing.T) {
	if !p.exited() {
		if runtime.GOOS == "windows" {
			_ = p.cmd.Process.Kill()
		} else {
			_ = p.cmd.Process.Signal(syscall.SIGTERM)
		}
		select {
		case <-p.done:
		case <-time.After(20 * time.Second):
			t.Log("eyes run nao parou em 20 s; matando o processo")
			_ = p.cmd.Process.Kill()
			<-p.done
		}
	}
	_ = p.logFile.Close()
}

// tail devolve o fim do log do agente.
func (p *agentProc) tail(max int) string {
	return tailFile(p.logPath, max)
}

func tailFile(path string, max int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("(sem log em %s: %v)", path, err)
	}
	if len(data) > max {
		data = append([]byte("...\n"), data[len(data)-max:]...)
	}
	return string(data)
}

// ---------------------------------------------------------------------------------------------
// Utilitarios

// waitFor repete cond ate ela ser verdadeira ou o prazo acabar.
func waitFor(timeout, every time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(every)
	}
}

// brief resume um valor para o log (as respostas reais documentam o comportamento no CI).
func brief(v any) string {
	if l, ok := v.([]any); ok && len(l) > 1 {
		return fmt.Sprintf("lista com %d itens, primeiro: %s", len(l), brief(l[0]))
	}
	s := fmt.Sprintf("%#v", v)
	if b, ok := v.([]byte); ok {
		s = fmt.Sprintf("bin %q", b)
	}
	if str, ok := v.(string); ok {
		s = fmt.Sprintf("%q", str)
	}
	if len(s) > 400 {
		s = s[:400] + fmt.Sprintf("... (%d caracteres)", len(s))
	}
	return s
}

// asNumber aceita qualquer inteiro ou float do msgpack.
func asNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case int8:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case int:
		return float64(x), true
	case uint8:
		return float64(x), true
	case uint16:
		return float64(x), true
	case uint32:
		return float64(x), true
	case uint64:
		return float64(x), true
	case uint:
		return float64(x), true
	case float32:
		return float64(x), true
	case float64:
		return x, true
	}
	return 0, false
}

// isInteger informa se o valor msgpack e um inteiro (nao float).
func isInteger(v any) bool {
	switch v.(type) {
	case int8, int16, int32, int64, int, uint8, uint16, uint32, uint64, uint:
		return true
	}
	return false
}

func asList(v any) ([]any, bool) {
	l, ok := v.([]any)
	return l, ok
}

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

// isErrorText informa se a resposta e um texto de erro ("error: ...").
func isErrorText(v any) bool {
	s, ok := v.(string)
	return ok && strings.HasPrefix(strings.ToLower(s), "error")
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMNOc]`)

// stripANSI remove as sequencias de escape do terminal (ConPTY redesenha a tela).
func stripANSI(b []byte) string {
	return ansiPattern.ReplaceAllString(string(bytes.ReplaceAll(b, []byte("\r"), nil)), "")
}
