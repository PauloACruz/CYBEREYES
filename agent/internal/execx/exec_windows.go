//go:build windows

package execx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/text/encoding/charmap"
)

const createNoWindow = 0x08000000

func prepare(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	cmd.WaitDelay = 5 * time.Second
}

// tree e um Job Object: encerrar o job encerra todos os processos filhos.
type tree struct{ job windows.Handle }

func track(cmd *exec.Cmd) (*tree, error) {
	job, err := newKillJob()
	if err != nil {
		return nil, err
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		windows.CloseHandle(job)
		return nil, err
	}
	return &tree{job: job}, nil
}

func newKillJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

func releaseTree(t *tree) {
	if t != nil {
		// Processos que ficaram vivos depois do fim (inclusive em segundo plano) nao sao encerrados:
		// o job so derruba a arvore no tempo limite.
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		_, _ = windows.SetInformationJobObject(t.job, windows.JobObjectExtendedLimitInformation,
			uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
		windows.CloseHandle(t.job)
	}
}

func killTree(cmd *exec.Cmd, t *tree) {
	if t != nil {
		_ = windows.TerminateJobObject(t.job, 98)
		return
	}
	if cmd.Process != nil {
		_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(cmd.Process.Pid)).Run()
	}
}

func powershellPath(shell string) string {
	if strings.EqualFold(shell, "pwsh") {
		if p, err := exec.LookPath("pwsh"); err == nil {
			return p
		}
	}
	return filepath.Join(systemRoot(), `System32\WindowsPowerShell\v1.0\powershell.exe`)
}

func cmdPath() string { return filepath.Join(systemRoot(), `System32\cmd.exe`) }

func systemRoot() string {
	if r := os.Getenv("SystemRoot"); r != "" {
		return r
	}
	return `C:\Windows`
}

// legacyDecode converte a saida na pagina OEM do console (850 no Brasil, 437 nos EUA).
func legacyDecode(b []byte) string {
	var cm *charmap.Charmap
	cp, _ := windows.GetConsoleOutputCP()
	switch cp {
	case 850:
		cm = charmap.CodePage850
	case 852:
		cm = charmap.CodePage852
	case 860:
		cm = charmap.CodePage860
	case 1252:
		cm = charmap.Windows1252
	default:
		switch getOEMCP() {
		case 850:
			cm = charmap.CodePage850
		case 860:
			cm = charmap.CodePage860
		case 852:
			cm = charmap.CodePage852
		default:
			cm = charmap.CodePage437
		}
	}
	out, err := cm.NewDecoder().Bytes(b)
	if err != nil {
		return strings.ToValidUTF8(string(b), "?")
	}
	return string(out)
}

var procGetOEMCP = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetOEMCP")

func getOEMCP() uint32 {
	r, _, _ := procGetOEMCP.Call()
	return uint32(r)
}

func prepareScriptFile(string, bool) error { return nil }

// ConsoleUser devolve o usuario da sessao ativa do console (DOMINIO\usuario).
func ConsoleUser() (string, error) {
	sid := windows.WTSGetActiveConsoleSessionId()
	if sid == 0xFFFFFFFF {
		return "", errors.New("nenhum usuario conectado")
	}
	tok, err := userToken(sid)
	if err != nil {
		return "", err
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return "", err
	}
	acc, dom, _, err := u.User.Sid.LookupAccount("")
	if err != nil {
		return "", err
	}
	return dom + `\` + acc, nil
}

// userToken obtem o token da sessao ativa, procurando outra sessao ativa (RDP) se o console estiver vazio.
func userToken(console uint32) (windows.Token, error) {
	var tok windows.Token
	if err := windows.WTSQueryUserToken(console, &tok); err == nil {
		return tok, nil
	}
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		return 0, errors.New("nenhum usuario conectado")
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	list := unsafe.Slice(sessions, count)
	for _, s := range list {
		if s.State == windows.WTSActive {
			if err := windows.WTSQueryUserToken(s.SessionID, &tok); err == nil {
				return tok, nil
			}
		}
	}
	return 0, errors.New("nenhum usuario conectado")
}

// runAsUser cria o processo na sessao do usuario conectado com o token dele (CreateProcessAsUser).
func runAsUser(ctx context.Context, s Spec, stdout, stderr io.Writer) (Result, error) {
	tok, err := userToken(windows.WTSGetActiveConsoleSessionId())
	if err != nil {
		return Result{ExitCode: 1}, err
	}
	defer tok.Close()
	// Token vinculado (elevado) quando existir, para scripts administrativos do usuario administrador.
	if linked, lerr := tok.GetLinkedToken(); lerr == nil {
		tok.Close()
		tok = linked
	}
	envBlock, err := tok.Environ(false)
	if err != nil {
		return Result{ExitCode: 1}, err
	}
	cmd := exec.Command(s.Path, s.Args...)
	cmd.Dir = s.Dir
	cmd.Env = append(envBlock, s.Env...)
	cmd.Stdin = s.Stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	prepare(cmd)
	cmd.SysProcAttr.Token = syscall.Token(tok)
	if err := cmd.Start(); err != nil {
		return Result{ExitCode: 1}, fmt.Errorf("falha ao executar na sessao do usuario: %w", err)
	}
	t, _ := track(cmd)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		killTree(cmd, t)
		err = <-done
	}
	releaseTree(t)
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
