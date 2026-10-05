package execx

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
)

// ScriptSpec descreve um script do console (shell: powershell, cmd, python, shell, nushell, deno).
type ScriptSpec struct {
	Shell   string
	Body    string
	Args    []string
	Env     []string
	Timeout time.Duration
	AsUser  bool
}

// Script grava o corpo em arquivo temporario e executa com o interpretador do shell.
func Script(ctx context.Context, s ScriptSpec) Result {
	ext, ok := scriptExt[strings.ToLower(s.Shell)]
	if !ok {
		return Result{ExitCode: 1, Err: fmt.Errorf("tipo de script nao suportado: %s", s.Shell), Stderr: "tipo de script nao suportado: " + s.Shell}
	}
	dir, err := scriptDir(s.AsUser)
	if err != nil {
		return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
	}
	f, err := os.CreateTemp(dir, "eyes-*"+ext)
	if err != nil {
		return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
	}
	path := f.Name()
	defer os.Remove(path)
	body := s.Body
	if runtime.GOOS == "windows" {
		body = strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")
	} else {
		body = strings.ReplaceAll(body, "\r\n", "\n")
	}
	content := []byte(body)
	if strings.EqualFold(s.Shell, "powershell") {
		// BOM UTF-8: o Windows PowerShell 5.1 le arquivos sem BOM na pagina ANSI.
		content = append([]byte{0xEF, 0xBB, 0xBF}, content...)
	}
	if _, err := f.Write(content); err != nil {
		f.Close()
		return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
	}
	f.Close()
	if err := prepareScriptFile(path, s.AsUser); err != nil {
		return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
	}

	spec := Spec{Env: s.Env, Timeout: s.Timeout, AsUser: s.AsUser, Dir: dir}
	switch strings.ToLower(s.Shell) {
	case "powershell":
		spec.Path = powershellPath("powershell")
		spec.Args = append([]string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path}, s.Args...)
	case "cmd":
		spec.Path = cmdPath()
		spec.Args = append([]string{"/D", "/C", path}, s.Args...)
	case "python":
		py, err := pythonPath()
		if err != nil {
			return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
		}
		spec.Path = py
		spec.Args = append([]string{path}, s.Args...)
		spec.Env = append(spec.Env, "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1")
	case "shell":
		if runtime.GOOS == "windows" {
			return Result{ExitCode: 1, Err: fmt.Errorf("scripts shell nao rodam no Windows"), Stderr: "scripts shell nao rodam no Windows"}
		}
		if strings.HasPrefix(body, "#!") {
			spec.Path = path
			spec.Args = s.Args
		} else {
			spec.Path = "/bin/sh"
			spec.Args = append([]string{path}, s.Args...)
		}
	case "nushell":
		nu, err := findTool("nu")
		if err != nil {
			return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
		}
		spec.Path = nu
		spec.Args = append([]string{"--no-config-file", path}, s.Args...)
	case "deno":
		deno, err := findTool("deno")
		if err != nil {
			return Result{ExitCode: 1, Err: err, Stderr: err.Error()}
		}
		spec.Path = deno
		spec.Args = append([]string{"run", "--allow-all", path}, s.Args...)
	}
	return Run(ctx, spec)
}

var scriptExt = map[string]string{
	"powershell": ".ps1",
	"cmd":        ".bat",
	"python":     ".py",
	"shell":      ".sh",
	"nushell":    ".nu",
	"deno":       ".ts",
}

func scriptDir(asUser bool) (string, error) {
	if asUser {
		// O usuario precisa ler o arquivo: pasta temporaria publica do sistema.
		return os.TempDir(), nil
	}
	dir := filepath.Join(config.DataDir(), "scripts")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func pythonPath() (string, error) {
	candidates := []string{"python3", "python"}
	if runtime.GOOS == "windows" {
		candidates = []string{"py", "python", "python3"}
	}
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("Python nao encontrado nesta maquina")
}

// ToolsDir guarda ferramentas opcionais baixadas pelo EYES (nushell, deno).
func ToolsDir() string { return filepath.Join(config.InstallDir(), "bin") }

func findTool(name string) (string, error) {
	exe := name
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	local := filepath.Join(ToolsDir(), exe)
	if _, err := os.Stat(local); err == nil {
		return local, nil
	}
	if p, err := exec.LookPath(name); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("%s nao esta instalado nesta maquina", name)
}
