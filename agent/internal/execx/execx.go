// Package execx executa comandos e scripts com tempo limite, encerrando a arvore de processos
// inteira quando o tempo acaba, e opcionalmente na sessao do usuario conectado.
package execx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// MaxOutput limita stdout e stderr guardados (o excedente e descartado com aviso).
const MaxOutput = 4 << 20

// Result e o resultado de uma execucao.
type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Elapsed  time.Duration
	TimedOut bool
	// Err descreve falhas para iniciar o processo (interpretador ausente, usuario sem sessao...).
	Err error
}

// Combined devolve stdout e stderr juntos, como o console mostra em comandos avulsos.
func (r Result) Combined() string {
	switch {
	case r.Stdout != "" && r.Stderr != "":
		return r.Stdout + "\n" + r.Stderr
	case r.Stderr != "":
		return r.Stderr
	}
	return r.Stdout
}

// Spec descreve o processo a executar.
type Spec struct {
	Path    string
	Args    []string
	Env     []string // acrescentado ao ambiente atual
	Dir     string
	Stdin   io.Reader
	Timeout time.Duration
	// AsUser executa na sessao do usuario conectado (Windows: sessao ativa; Unix: usuario do console).
	AsUser bool
	// WinCmdLine, no Windows, e a linha de comando crua passada ao processo (sem o escape automatico
	// do Go, que quebra o cmd.exe). Quando preenchida, Args e ignorado no Windows.
	WinCmdLine string
}

// Run executa o processo e espera o fim ou o tempo limite.
func Run(ctx context.Context, s Spec) Result {
	if s.Timeout <= 0 {
		s.Timeout = time.Hour
	}
	ctx, cancel := context.WithTimeout(ctx, s.Timeout)
	defer cancel()
	start := time.Now()
	var stdout, stderr limitedBuffer
	stdout.max, stderr.max = MaxOutput, MaxOutput

	var res Result
	var err error
	if s.AsUser {
		res, err = runAsUser(ctx, s, &stdout, &stderr)
	} else {
		res, err = runProcess(ctx, s, &stdout, &stderr)
	}
	res.Elapsed = time.Since(start)
	res.Stdout = decode(stdout.Bytes())
	res.Stderr = decode(stderr.Bytes())
	if stdout.truncated {
		res.Stdout += "\n[saida truncada pelo EYES]"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		res.TimedOut = true
		res.ExitCode = 98
		if res.Stderr != "" {
			res.Stderr += "\n"
		}
		res.Stderr += fmt.Sprintf("Tempo limite de %s excedido", s.Timeout)
	}
	if err != nil && res.Err == nil && !res.TimedOut {
		res.Err = err
		if res.ExitCode == 0 {
			res.ExitCode = 1
		}
		if res.Stderr == "" {
			res.Stderr = err.Error()
		}
	}
	return res
}

func runProcess(ctx context.Context, s Spec, stdout, stderr io.Writer) (Result, error) {
	cmd := exec.Command(s.Path, s.Args...)
	cmd.Dir = s.Dir
	cmd.Env = append(os.Environ(), s.Env...)
	cmd.Stdin = s.Stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	prepare(cmd)
	setCmdLine(cmd, s.WinCmdLine)
	if err := cmd.Start(); err != nil {
		return Result{ExitCode: 1}, err
	}
	tree, err := track(cmd)
	if err != nil {
		tree = nil
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		killTree(cmd, tree)
		select {
		case err = <-done:
		case <-time.After(10 * time.Second):
			err = ctx.Err()
		}
	}
	releaseTree(tree)
	code := 0
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		err = nil
	}
	return Result{ExitCode: code}, err
}

// Shells de comando avulso aceitos pelo console.
var unixShells = map[string]bool{"/bin/bash": true, "/bin/sh": true, "/bin/zsh": true, "bash": true, "sh": true, "zsh": true}

// Command executa um comando avulso no shell indicado.
// Windows: cmd ou powershell. Linux e macOS: /bin/bash, /bin/sh ou /bin/zsh.
func Command(ctx context.Context, shell, command string, timeout time.Duration, asUser bool) Result {
	spec := Spec{Timeout: timeout, AsUser: asUser}
	if runtime.GOOS == "windows" {
		switch strings.ToLower(shell) {
		case "powershell", "pwsh", "":
			spec.Path = powershellPath(shell)
			spec.Args = []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psUTF8Prefix + command}
		case "cmd":
			spec.Path = cmdPath()
			// /S: o cmd tira so as aspas externas e executa o resto como foi digitado.
			spec.WinCmdLine = `"` + spec.Path + `" /D /S /C "chcp 65001 >NUL & ` + command + `"`
		default:
			return Result{ExitCode: 1, Err: fmt.Errorf("shell nao suportado: %s", shell), Stderr: "shell nao suportado: " + shell}
		}
	} else {
		if shell == "" {
			shell = "/bin/bash"
		}
		if !unixShells[shell] {
			return Result{ExitCode: 1, Err: fmt.Errorf("shell nao suportado: %s", shell), Stderr: "shell nao suportado: " + shell}
		}
		path := shell
		if !strings.HasPrefix(path, "/") {
			path = "/bin/" + path
		}
		if _, err := os.Stat(path); err != nil {
			if p, lerr := exec.LookPath(filepath.Base(path)); lerr == nil {
				path = p
			} else {
				return Result{ExitCode: 1, Err: fmt.Errorf("%s nao encontrado", shell), Stderr: shell + " nao encontrado nesta maquina"}
			}
		}
		spec.Path = path
		spec.Args = []string{"-c", command}
	}
	return Run(ctx, spec)
}

// Prefixo que forca saida UTF-8 no PowerShell (o console do servico usa a pagina OEM).
const psUTF8Prefix = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;"

// limitedBuffer guarda ate max bytes e descarta o resto.
type limitedBuffer struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	max       int
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	room := b.max - b.buf.Len()
	if room <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > room {
		b.buf.Write(p[:room])
		b.truncated = true
		return len(p), nil
	}
	return b.buf.Write(p)
}

func (b *limitedBuffer) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Bytes()
}

// decode converte a saida para UTF-8 valido (no Windows tenta a pagina OEM do sistema).
func decode(b []byte) string {
	b = bytes.TrimRight(b, "\r\n\x00")
	if len(b) == 0 {
		return ""
	}
	if isUTF16LE(b) {
		return strings.ReplaceAll(utf16le(b), "\r\n", "\n")
	}
	s := string(b)
	if !utf8.ValidString(s) {
		s = legacyDecode(b)
	}
	return strings.ReplaceAll(s, "\r\n", "\n")
}

func isUTF16LE(b []byte) bool {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		return true
	}
	if len(b) < 8 || len(b)%2 != 0 {
		return false
	}
	zeros := 0
	for i := 1; i < len(b); i += 2 {
		if b[i] == 0 {
			zeros++
		}
	}
	return zeros*10 >= len(b)/2*9
}

func utf16le(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		b = b[2:]
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return string(utf16Decode(u))
}

func utf16Decode(u []uint16) []rune {
	out := make([]rune, 0, len(u))
	for i := 0; i < len(u); i++ {
		c := rune(u[i])
		if c >= 0xD800 && c < 0xDC00 && i+1 < len(u) {
			d := rune(u[i+1])
			if d >= 0xDC00 && d < 0xE000 {
				out = append(out, (c-0xD800)<<10+(d-0xDC00)+0x10000)
				i++
				continue
			}
		}
		out = append(out, c)
	}
	return out
}
