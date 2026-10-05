//go:build !windows

package terminal

import (
	"errors"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// Shells aceitos pelo console no Linux e no macOS (CommandEndpoints.UnixShells).
var unixShells = map[string]string{
	"":          "/bin/bash",
	"/bin/bash": "/bin/bash",
	"bash":      "/bin/bash",
	"/bin/sh":   "/bin/sh",
	"sh":        "/bin/sh",
	"/bin/zsh":  "/bin/zsh",
	"zsh":       "/bin/zsh",
}

// Tempo entre o SIGHUP e o SIGKILL ao encerrar a sessao.
const killGrace = 2 * time.Second

// resolveShell devolve o caminho do shell; sem bash (Alpine, BusyBox), cai para /bin/sh.
func resolveShell(shell string) (string, error) {
	path, ok := unixShells[shell]
	if !ok {
		return "", unsupported(shell)
	}
	if isExec(path) {
		return path, nil
	}
	if p, err := exec.LookPath(filepath.Base(path)); err == nil {
		return p, nil
	}
	if isExec("/bin/sh") {
		return "/bin/sh", nil
	}
	return "", errors.New(shell + " nao encontrado nesta maquina")
}

func isExec(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir() && st.Mode()&0o111 != 0
}

// shellEnv monta um ambiente limpo (sem as variaveis do servico do agente).
func shellEnv(shell string) (env []string, home string) {
	name, home := "root", "/root"
	if runtime.GOOS == "darwin" {
		home = "/var/root"
	}
	if u, err := user.Current(); err == nil {
		if u.Username != "" {
			name = u.Username
		}
		if u.HomeDir != "" {
			home = u.HomeDir
		}
	}
	path := "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
	if runtime.GOOS == "darwin" {
		path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	}
	if p := os.Getenv("PATH"); p != "" {
		path = p
	}
	lang := "C.UTF-8"
	if runtime.GOOS == "darwin" {
		lang = "en_US.UTF-8"
	}
	if l := os.Getenv("LANG"); l != "" && strings.Contains(strings.ToUpper(l), "UTF") {
		lang = l
	}
	env = []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"HOME=" + home,
		"PATH=" + path,
		"LANG=" + lang,
		"SHELL=" + shell,
		"USER=" + name,
		"LOGNAME=" + name,
	}
	for _, k := range []string{"TZ", "LC_ALL", "LC_CTYPE"} {
		if v, ok := os.LookupEnv(k); ok {
			env = append(env, k+"="+v)
		}
	}
	return env, home
}

// unixConsole e o shell num PTY (creack/pty), em sessao e grupo de processos proprios.
type unixConsole struct {
	cmd  *exec.Cmd
	pty  *os.File
	once sync.Once
	done chan struct{}
}

func startConsole(shell string, cols, rows int) (console, error) {
	path, err := resolveShell(shell)
	if err != nil {
		return nil, err
	}
	env, home := shellEnv(path)
	cmd := exec.Command(path)
	// argv[0] com "-" na frente: shell de login (le /etc/profile), em qualquer sh.
	cmd.Args = []string{"-" + filepath.Base(path)}
	cmd.Env = env
	cmd.Dir = "/"
	if st, err := os.Stat(home); err == nil && st.IsDir() {
		cmd.Dir = home
	}
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}
	return &unixConsole{cmd: cmd, pty: f, done: make(chan struct{})}, nil
}

// Read le o lado mestre do PTY. No Linux, o fim do shell aparece como EIO.
func (c *unixConsole) Read(p []byte) (int, error) { return c.pty.Read(p) }

func (c *unixConsole) Write(p []byte) (int, error) { return c.pty.Write(p) }

func (c *unixConsole) Resize(cols, rows int) error {
	return pty.Setsize(c.pty, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

// Kill manda SIGHUP ao grupo do shell e aos processos da sessao (como ao fechar um terminal) e,
// se o shell nao sair em killGrace, SIGKILL.
func (c *unixConsole) Kill() {
	if c.cmd.Process == nil {
		return
	}
	select {
	case <-c.done:
		// Ja terminou e foi recolhido: o pid pode ter sido reaproveitado.
		return
	default:
	}
	pid := c.cmd.Process.Pid
	signalSession(pid, syscall.SIGHUP)
	go func() {
		select {
		case <-c.done:
			return
		case <-time.After(killGrace):
		}
		signalSession(pid, syscall.SIGKILL)
	}()
}

// signalSession sinaliza o grupo do shell (pid = pgid = sid, por causa do Setsid) e, no Linux,
// todos os processos da sessao, inclusive jobs que o shell moveu para outros grupos.
func signalSession(sid int, sig syscall.Signal) {
	_ = syscall.Kill(-sid, sig)
	for _, pid := range sessionMembers(sid) {
		_ = syscall.Kill(pid, sig)
	}
}

// sessionMembers le /proc/<pid>/stat (so existe no Linux; no macOS devolve vazio).
func sessionMembers(sid int) []int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	var out []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == sid {
			continue
		}
		data, err := os.ReadFile("/proc/" + e.Name() + "/stat")
		if err != nil {
			continue
		}
		// Campos depois do nome do comando (que pode ter espacos e parenteses): estado ppid pgrp sessao ...
		s := string(data)
		i := strings.LastIndexByte(s, ')')
		if i < 0 {
			continue
		}
		f := strings.Fields(s[i+1:])
		if len(f) < 4 {
			continue
		}
		if v, err := strconv.Atoi(f[3]); err == nil && v == sid {
			out = append(out, pid)
		}
	}
	return out
}

func (c *unixConsole) Wait() int {
	err := c.cmd.Wait()
	close(c.done)
	st := c.cmd.ProcessState
	if st == nil {
		if err != nil {
			return 1
		}
		return 0
	}
	if ws, ok := st.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return st.ExitCode()
}

func (c *unixConsole) CloseOutput() { c.once.Do(func() { _ = c.pty.Close() }) }

func (c *unixConsole) Close() { c.CloseOutput() }
