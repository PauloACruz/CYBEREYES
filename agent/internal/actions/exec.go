package actions

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Shells aceitos pelo rawcmd (CommandEndpoints.cs:32-33).
var (
	rawShellsWindows = []string{"cmd", "powershell"}
	rawShellsUnix    = []string{"/bin/bash", "/bin/sh", "/bin/zsh"}
)

// Shells de script (runscriptfull, checks e tarefas).
var scriptShells = []string{"powershell", "cmd", "python", "shell", "nushell", "deno"}

// rawShell valida o shell do rawcmd para o sistema; vazio vira o padrao (cmd ou /bin/bash).
func rawShell(goos, shell string) (string, error) {
	shell = strings.TrimSpace(shell)
	allowed := rawShellsUnix
	if goos == "windows" {
		allowed = rawShellsWindows
		shell = strings.ToLower(shell)
	}
	if shell == "" {
		return allowed[0], nil
	}
	for _, s := range allowed {
		if s == shell {
			return s, nil
		}
	}
	return "", fmt.Errorf("shell nao suportado neste sistema: %s (use %s)", shell, strings.Join(allowed, ", "))
}

// scriptShell valida o shell do runscriptfull.
func scriptShell(goos, shell string) (string, error) {
	shell = strings.ToLower(strings.TrimSpace(shell))
	for _, s := range scriptShells {
		if s == shell {
			if goos == "windows" && s == "shell" {
				return "", fmt.Errorf("scripts shell nao rodam no Windows")
			}
			return s, nil
		}
	}
	return "", fmt.Errorf("tipo de script nao suportado: %s", shell)
}

// timeoutSeconds le o timeout do pedido; ausente ou invalido vira def e o maximo e max.
func timeoutSeconds(req rpc.Request, def, max int) int {
	t := req.Int("timeout")
	if t <= 0 {
		t = def
	}
	if t > max {
		t = max
	}
	return t
}

// killAt devolve o prazo efetivo do processo: um pouco antes do timeout pedido, para que
// encerrar a arvore e montar a resposta caibam na folga do servidor (timeout + 2 s no rawcmd).
func killAt(seconds int, margin time.Duration) time.Duration {
	d := time.Duration(seconds) * time.Second
	if d-margin >= time.Second {
		return d - margin
	}
	return d
}

// envVars descarta entradas sem "NOME=" (o servidor manda "NOME=valor").
func envVars(in []string) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if i := strings.IndexByte(v, '='); i > 0 && strings.TrimSpace(v[:i]) != "" {
			out = append(out, v)
		}
	}
	return out
}

// rawcmd: { timeout, payload: { command, shell }, run_as_user, id } -> str com a saida combinada.
func (h *handlers) rawcmd(ctx context.Context, req rpc.Request) any {
	p := req.Payload()
	command := p.Str("command")
	if strings.TrimSpace(command) == "" {
		return "error: comando vazio"
	}
	shell, err := rawShell(runtime.GOOS, p.Str("shell"))
	if err != nil {
		return errText(err)
	}
	timeout := timeoutSeconds(req, 30, 86400)
	asUser := req.Bool("run_as_user")
	limit := time.Duration(timeout)*time.Second + 1500*time.Millisecond
	kill := killAt(timeout, time.Second)
	res, err := guard(ctx, limit, func() execx.Result {
		return execx.Command(ctx, shell, command, kill, asUser)
	})
	if err != nil {
		return rawTimeoutText(timeout, err)
	}
	return rawOutput(res, kill, timeout)
}

func rawTimeoutText(timeout int, err error) string {
	if err == errGuardTimeout {
		return fmt.Sprintf("[timeout apos %d s]", timeout)
	}
	return errText(err)
}

// rawOutput junta stdout e stderr como o console mostra; no tempo limite, termina com
// "[timeout apos N s]" (N = timeout pedido).
func rawOutput(res execx.Result, kill time.Duration, timeout int) string {
	if !res.TimedOut {
		return res.Combined()
	}
	res.Stderr = stripTimeoutNote(res.Stderr, kill)
	out := res.Combined()
	if out != "" {
		out += "\n"
	}
	return out + fmt.Sprintf("[timeout apos %d s]", timeout)
}

// stripTimeoutNote remove a linha que o execx acrescenta no tempo limite (com o prazo efetivo,
// um pouco menor que o pedido) para a mensagem mostrar o timeout pedido.
func stripTimeoutNote(stderr string, kill time.Duration) string {
	note := fmt.Sprintf("Tempo limite de %s excedido", kill)
	stderr = strings.TrimSuffix(stderr, note)
	return strings.TrimSuffix(stderr, "\n")
}

// ScriptResult e a resposta do runscriptfull (e o formato de script_results do histresult).
type ScriptResult struct {
	Stdout        string  `json:"stdout"`
	Stderr        string  `json:"stderr"`
	Retcode       int     `json:"retcode"`
	ExecutionTime float64 `json:"execution_time"`
}

// NewScriptResult converte o resultado da execucao; execution_time em segundos com 3 casas.
func NewScriptResult(res execx.Result) ScriptResult {
	return ScriptResult{
		Stdout:        res.Stdout,
		Stderr:        res.Stderr,
		Retcode:       res.ExitCode,
		ExecutionTime: seconds(res.Elapsed),
	}
}

// seconds converte a duracao em segundos com 3 casas (nunca NaN nem negativo).
func seconds(d time.Duration) float64 {
	s := math.Round(d.Seconds()*1000) / 1000
	if math.IsNaN(s) || math.IsInf(s, 0) || s < 0 {
		return 0
	}
	return s
}

// runscript: { timeout, script_args, payload: { code, shell }, run_as_user, env_vars, ... } ->
// { stdout, stderr, retcode, execution_time }.
func (h *handlers) runscript(ctx context.Context, req rpc.Request) any {
	start := time.Now()
	p := req.Payload()
	shell, err := scriptShell(runtime.GOOS, p.Str("shell"))
	if err != nil {
		return ScriptResult{Stderr: err.Error(), Retcode: 1}
	}
	timeout := timeoutSeconds(req, 60, 86400)
	spec := execx.ScriptSpec{
		Shell:   shell,
		Body:    p.Str("code"),
		Args:    req.Strings("script_args"),
		Env:     envVars(req.Strings("env_vars")),
		Timeout: killAt(timeout, time.Second),
		AsUser:  req.Bool("run_as_user"),
	}
	// Folga do servidor: timeout + 5 s.
	limit := time.Duration(timeout)*time.Second + 4*time.Second
	res, err := guard(ctx, limit, func() execx.Result { return execx.Script(ctx, spec) })
	note := fmt.Sprintf("Tempo limite de %d s excedido", timeout)
	if err != nil {
		msg := err.Error()
		if err == errGuardTimeout {
			msg = note
		}
		return ScriptResult{Stderr: msg, Retcode: 98, ExecutionTime: seconds(time.Since(start))}
	}
	if res.TimedOut {
		res.Stderr = stripTimeoutNote(res.Stderr, spec.Timeout)
		if res.Stderr != "" {
			res.Stderr += "\n"
		}
		res.Stderr += note
	}
	return NewScriptResult(res)
}
