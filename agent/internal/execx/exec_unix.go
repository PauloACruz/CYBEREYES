//go:build !windows

package execx

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func prepare(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	// Grupo de processos proprio: no tempo limite, o grupo inteiro e encerrado.
	cmd.SysProcAttr.Setpgid = true
	// Netos que se desligam do grupo e seguram stdout nao travam a espera.
	cmd.WaitDelay = 5 * time.Second
}

func setCmdLine(*exec.Cmd, string) {}

type tree struct{}

func track(*exec.Cmd) (*tree, error) { return nil, nil }

func releaseTree(*tree) {}

func killTree(cmd *exec.Cmd, _ *tree) {
	if cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	time.AfterFunc(3*time.Second, func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) })
}

func powershellPath(string) string {
	if p, err := exec.LookPath("pwsh"); err == nil {
		return p
	}
	return "pwsh"
}

func cmdPath() string { return "cmd" }

func legacyDecode(b []byte) string { return strings.ToValidUTF8(string(b), "?") }

func prepareScriptFile(path string, asUser bool) error {
	mode := os.FileMode(0o700)
	if asUser {
		mode = 0o755
	}
	return os.Chmod(path, mode)
}

// ConsoleUser devolve o usuario com sessao grafica ou de terminal (o primeiro encontrado).
func ConsoleUser() (string, error) {
	if runtime.GOOS == "darwin" {
		out, err := exec.Command("stat", "-f", "%Su", "/dev/console").Output()
		if err == nil {
			u := strings.TrimSpace(string(out))
			if u != "" && u != "root" && u != "_mbsetupuser" {
				return u, nil
			}
		}
	}
	if out, err := exec.Command("loginctl", "list-sessions", "--no-legend").Output(); err == nil {
		// Formato: SESSION UID USER SEAT TTY ...; prefere sessoes com seat (graficas).
		var fallback string
		sc := bufio.NewScanner(strings.NewReader(string(out)))
		for sc.Scan() {
			f := strings.Fields(sc.Text())
			if len(f) < 3 || f[2] == "root" || strings.HasPrefix(f[2], "gdm") || strings.HasPrefix(f[2], "lightdm") || strings.HasPrefix(f[2], "sddm") {
				continue
			}
			if len(f) >= 4 && strings.HasPrefix(f[3], "seat") {
				return f[2], nil
			}
			if fallback == "" {
				fallback = f[2]
			}
		}
		if fallback != "" {
			return fallback, nil
		}
	}
	if out, err := exec.Command("who").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			f := strings.Fields(line)
			if len(f) > 0 && f[0] != "root" {
				return f[0], nil
			}
		}
	}
	return "", errors.New("nenhum usuario conectado")
}

func runAsUser(ctx context.Context, s Spec, stdout, stderr io.Writer) (Result, error) {
	name, err := ConsoleUser()
	if err != nil {
		return Result{ExitCode: 1}, err
	}
	u, err := user.Lookup(name)
	if err != nil {
		return Result{ExitCode: 1}, err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	cmd := exec.Command(s.Path, s.Args...)
	cmd.Dir = u.HomeDir
	if s.Dir != "" {
		cmd.Dir = s.Dir
	}
	env := []string{"HOME=" + u.HomeDir, "USER=" + u.Username, "LOGNAME=" + u.Username,
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG=" + envOr("LANG", "C.UTF-8")}
	if runtime.GOOS == "linux" {
		env = append(env, "XDG_RUNTIME_DIR=/run/user/"+u.Uid, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"+u.Uid+"/bus")
	}
	cmd.Env = append(env, s.Env...)
	cmd.Stdin = s.Stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	prepare(cmd)
	groups := supplementaryGroups(u)
	cmd.SysProcAttr.Credential = &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid), Groups: groups}
	if err := cmd.Start(); err != nil {
		return Result{ExitCode: 1}, fmt.Errorf("falha ao executar como %s: %w", name, err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		killTree(cmd, nil)
		err = <-done
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		err = nil
	}
	code := 0
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	return Result{ExitCode: code}, err
}

func supplementaryGroups(u *user.User) []uint32 {
	ids, err := u.GroupIds()
	if err != nil {
		return nil
	}
	out := make([]uint32, 0, len(ids))
	for _, id := range ids {
		if n, err := strconv.Atoi(id); err == nil {
			out = append(out, uint32(n))
		}
	}
	return out
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
