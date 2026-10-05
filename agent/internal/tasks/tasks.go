// Package tasks executa as tarefas automatizadas (contrato 3.6): o servidor agenda e envia
// runtask com taskpk; o agente busca as acoes em GET /api/v3/{taskpk}/{agent_id}/taskrunner/,
// executa em ordem e envia um resultado por tarefa no PATCH da mesma rota.
package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const (
	// maxParallel limita as tarefas diferentes executando ao mesmo tempo.
	maxParallel = 4
	// defaultActionTimeout vale quando a acao chega sem timeout.
	defaultActionTimeout = 15 * time.Minute
)

// Funcoes de execucao, substituiveis nos testes.
var (
	runCommand = execx.Command
	runScript  = execx.Script
)

// patchRetries sao as esperas entre tentativas de envio do resultado.
var patchRetries = []time.Duration{5 * time.Second, 20 * time.Second}

// ErrRunning indica que a mesma tarefa ja esta em execucao.
var ErrRunning = errors.New("tarefa ja em execucao")

// Register registra o comando runtask.
func Register(e *env.Env) error {
	r := NewRunner(e.API, e.Cfg.AgentID, e.Log.With("modulo", "tasks"))
	e.Reg.HandleTimeout("runtask", 30*time.Second, func(_ context.Context, req rpc.Request) any {
		pk := taskPK(req)
		if pk <= 0 {
			r.log.Warn("runtask sem taskpk valido", "taskpk", req["taskpk"])
			return "error: taskpk invalido"
		}
		// Publish sem resposta: a tarefa roda em segundo plano com o contexto do agente.
		e.Go("runtask", func(ctx context.Context) {
			if err := r.Run(ctx, pk); err != nil {
				if errors.Is(err, ErrRunning) {
					r.log.Info("runtask ignorado: tarefa ainda em execucao", "taskpk", pk)
					return
				}
				r.log.Warn("falha na tarefa", "taskpk", pk, "erro", err)
			}
		})
		return "ok"
	})
	return nil
}

// taskPK le taskpk do nivel superior (contrato 4.3) ou, por tolerancia, do payload.
func taskPK(req rpc.Request) int {
	if pk := req.Int("taskpk"); pk > 0 {
		return pk
	}
	return req.Payload().Int("taskpk")
}

// Runner executa tarefas sem repetir a mesma tarefa ao mesmo tempo.
type Runner struct {
	api     *api.Client
	agentID string
	log     *slog.Logger
	sem     chan struct{}

	mu      sync.Mutex
	running map[int]bool
}

// NewRunner cria o executor de tarefas.
func NewRunner(client *api.Client, agentID string, log *slog.Logger) *Runner {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Runner{api: client, agentID: agentID, log: log, sem: make(chan struct{}, maxParallel), running: map[int]bool{}}
}

// Task e a resposta de GET taskrunner.
type Task struct {
	ID              int
	ContinueOnError bool
	Enabled         bool
	Actions         []Action
}

// Action e uma acao da tarefa (cmd ou script).
type Action struct {
	Type       string
	Command    string // cmd
	Shell      string
	Timeout    time.Duration
	ScriptName string // script
	Code       string
	Args       []string
	Env        []string
	RunAsUser  bool
}

// Result e o corpo do PATCH (um por tarefa). stdout e stderr sempre texto (bug 4 do servidor).
type Result struct {
	Stdout        string  `json:"stdout"`
	Stderr        string  `json:"stderr"`
	Retcode       int     `json:"retcode"`
	ExecutionTime float64 `json:"execution_time"`
}

// Run busca a tarefa, executa as acoes e envia o resultado.
func (r *Runner) Run(ctx context.Context, pk int) error {
	r.mu.Lock()
	if r.running[pk] {
		r.mu.Unlock()
		return ErrRunning
	}
	r.running[pk] = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.running, pk)
		r.mu.Unlock()
	}()

	select {
	case r.sem <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-r.sem }()

	route := fmt.Sprintf("/api/v3/%d/%s/taskrunner/", pk, r.agentID)
	task, err := r.fetch(ctx, route)
	if err != nil {
		if api.IsStatus(err, http.StatusBadRequest) {
			return fmt.Errorf("tarefa %d nao pertence ao agente: %w", pk, err)
		}
		return fmt.Errorf("busca da tarefa %d: %w", pk, err)
	}
	if !task.Enabled {
		// PROPOSTA do contrato (8, item 23): runtask manual de tarefa desativada e executado.
		r.log.Info("executando tarefa desativada por pedido explicito", "taskpk", pk)
	}
	r.log.Info("executando tarefa", "taskpk", pk, "acoes", len(task.Actions))
	res := r.execute(ctx, task)
	return r.send(ctx, route, res)
}

func (r *Runner) fetch(ctx context.Context, route string) (Task, error) {
	var raw map[string]any
	if err := r.api.Get(ctx, route, &raw); err != nil {
		return Task{}, err
	}
	return parseTask(raw)
}

// parseTask le a tarefa de forma tolerante; acoes malformadas viram acoes com erro na execucao.
func parseTask(raw map[string]any) (t Task, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("tarefa malformada: %v", p)
		}
	}()
	if raw == nil {
		return t, errors.New("resposta vazia do taskrunner")
	}
	r := rpc.Request(raw)
	t.ID = r.Int("id")
	t.ContinueOnError = r.Bool("continue_on_error")
	t.Enabled = true
	if _, ok := raw["enabled"]; ok {
		t.Enabled = r.Bool("enabled")
	}
	list, _ := raw["task_actions"].([]any)
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			t.Actions = append(t.Actions, Action{Type: "invalida"})
			continue
		}
		a := rpc.Request(m)
		act := Action{
			Type:       strings.ToLower(strings.TrimSpace(text(a, "type"))),
			Command:    text(a, "command"),
			Shell:      strings.TrimSpace(text(a, "shell")),
			Timeout:    time.Duration(a.Int("timeout")) * time.Second,
			ScriptName: text(a, "script_name"),
			Code:       text(a, "code"),
			Args:       list2(a, "script_args"),
			Env:        list2(a, "env_vars"),
			RunAsUser:  a.Bool("run_as_user"),
		}
		if act.Timeout <= 0 {
			act.Timeout = defaultActionTimeout
		}
		t.Actions = append(t.Actions, act)
	}
	return t, nil
}

func text(r rpc.Request, key string) string {
	switch v := r[key].(type) {
	case string:
		return v
	case nil, map[string]any, []any:
		return ""
	}
	return r.Str(key)
}

func list2(r rpc.Request, key string) []string {
	if _, ok := r[key].([]any); !ok {
		return nil
	}
	var out []string
	for _, s := range r.Strings(key) {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// actionResult e o resultado de uma acao.
type actionResult struct {
	Stdout  string
	Stderr  string
	Code    int
	Elapsed time.Duration
}

// execute roda as acoes em ordem e agrega (contrato 3.6, PROPOSTA):
//   - para na primeira falha, a menos que continue_on_error;
//   - stdout/stderr concatenados, com cabecalho por acao quando ha mais de uma;
//   - retcode = codigo da ultima acao que falhou, ou 0;
//   - execution_time = soma das duracoes.
func (r *Runner) execute(ctx context.Context, t Task) Result {
	if len(t.Actions) == 0 {
		return Result{Stderr: "Tarefa sem acoes para executar"}
	}
	var out, errs []string
	var total time.Duration
	retcode := 0
	n := len(t.Actions)
	for i, a := range t.Actions {
		if ctx.Err() != nil {
			errs = append(errs, "Execucao interrompida: o agente esta parando")
			if retcode == 0 {
				retcode = 1
			}
			break
		}
		res := runAction(ctx, a)
		total += res.Elapsed
		head := ""
		if n > 1 {
			head = fmt.Sprintf("=== Acao %d/%d: %s ===", i+1, n, a.label())
		}
		out = appendSection(out, head, res.Stdout, true)
		errs = appendSection(errs, head, res.Stderr, false)
		if res.Code != 0 {
			retcode = res.Code
			r.log.Info("acao da tarefa falhou", "taskpk", t.ID, "acao", i+1, "retcode", res.Code)
			if !t.ContinueOnError && i < n-1 {
				errs = append(errs, fmt.Sprintf("Execucao interrompida: a acao %d falhou com codigo %d e continue_on_error esta desligado; %d acao(oes) nao executada(s)",
					i+1, res.Code, n-i-1))
				break
			}
		}
	}
	return Result{
		Stdout:        strings.Join(out, "\n"),
		Stderr:        strings.Join(errs, "\n"),
		Retcode:       retcode,
		ExecutionTime: math.Round(total.Seconds()*1000) / 1000,
	}
}

// appendSection acrescenta a saida de uma acao; no stdout o cabecalho sai mesmo sem saida.
func appendSection(dst []string, head, body string, always bool) []string {
	if body == "" && (!always || head == "") {
		return dst
	}
	if head == "" {
		return append(dst, body)
	}
	if body == "" {
		return append(dst, head)
	}
	return append(dst, head+"\n"+body)
}

func (a Action) label() string {
	switch a.Type {
	case "cmd":
		if a.Shell != "" {
			return "comando (" + a.Shell + ")"
		}
		return "comando"
	case "script":
		name := a.ScriptName
		if name == "" {
			name = "sem nome"
		}
		return "script " + name + " (" + a.Shell + ")"
	}
	return "acao " + strconv.Quote(a.Type)
}

// runAction executa uma acao; panico vira falha da acao.
func runAction(ctx context.Context, a Action) (ar actionResult) {
	start := time.Now()
	defer func() {
		if p := recover(); p != nil {
			ar = actionResult{Stderr: fmt.Sprintf("falha interna na acao: %v", p), Code: 1, Elapsed: time.Since(start)}
		}
	}()
	var res execx.Result
	switch a.Type {
	case "cmd":
		if strings.TrimSpace(a.Command) == "" {
			return actionResult{Stderr: "acao cmd sem comando", Code: 1}
		}
		res = runCommand(ctx, a.Shell, a.Command, a.Timeout, false)
	case "script":
		if a.Code == "" {
			return actionResult{Stderr: "acao script sem codigo", Code: 1}
		}
		res = runScript(ctx, execx.ScriptSpec{
			Shell:   strings.ToLower(a.Shell),
			Body:    a.Code,
			Args:    a.Args,
			Env:     a.Env,
			Timeout: a.Timeout,
			AsUser:  a.RunAsUser,
		})
	default:
		return actionResult{Stderr: "tipo de acao desconhecido: " + strconv.Quote(a.Type), Code: 1}
	}
	code := res.ExitCode
	stderr := res.Stderr
	if res.Err != nil {
		if code == 0 {
			code = 1
		}
		if stderr == "" {
			stderr = res.Err.Error()
		}
	}
	return actionResult{Stdout: res.Stdout, Stderr: stderr, Code: code, Elapsed: res.Elapsed}
}

// send envia o resultado, com novas tentativas em falhas de rede ou do servidor.
func (r *Runner) send(ctx context.Context, route string, res Result) error {
	// Confere que o corpo e serializavel antes de enviar (stdout/stderr sempre texto).
	if _, err := json.Marshal(res); err != nil {
		return err
	}
	var err error
	for attempt := 0; ; attempt++ {
		if err = r.api.Patch(ctx, route, res, nil); err == nil {
			return nil
		}
		var apiErr *api.Error
		if errors.As(err, &apiErr) && apiErr.Status < 500 {
			return fmt.Errorf("envio do resultado: %w", err)
		}
		if attempt >= len(patchRetries) {
			return fmt.Errorf("envio do resultado: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(patchRetries[attempt]):
		}
	}
}
