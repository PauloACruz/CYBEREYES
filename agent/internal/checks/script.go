package checks

import (
	"context"
	"math"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// runScript executa o script; substituivel nos testes.
var runScript = execx.Script

// scriptCheck executa o script do check e devolve retcode, stdout, stderr e runtime (segundos).
// A avaliacao dos codigos de retorno e feita no servidor.
func scriptCheck(ctx context.Context, c Check) map[string]any {
	if c.Script == nil || c.Script.Code == "" {
		return map[string]any{"retcode": 1, "stdout": "", "stderr": "Script do check nao encontrado no servidor", "runtime": 0}
	}
	// Variaveis do script primeiro e depois as do check, que sobrescrevem (a ultima vence no ambiente).
	envs := make([]string, 0, len(c.Script.EnvVars)+len(c.EnvVars))
	envs = append(envs, c.Script.EnvVars...)
	envs = append(envs, c.EnvVars...)
	res := runScript(ctx, execx.ScriptSpec{
		Shell:   c.Script.Shell,
		Body:    c.Script.Code,
		Args:    c.ScriptArgs,
		Env:     envs,
		Timeout: c.Timeout,
		AsUser:  c.Script.RunAsUser,
	})
	code := res.ExitCode
	if res.Err != nil && code == 0 {
		code = 1
	}
	stderr := res.Stderr
	if res.Err != nil && stderr == "" {
		stderr = res.Err.Error()
	}
	return map[string]any{
		"retcode": code,
		"stdout":  res.Stdout,
		"stderr":  stderr,
		"runtime": math.Round(res.Elapsed.Seconds()*1000) / 1000,
	}
}
