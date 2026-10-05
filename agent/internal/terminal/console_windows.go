//go:build windows

package terminal

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const createNoWindow = 0x08000000

var (
	kernel32                      = windows.NewLazySystemDLL("kernel32.dll")
	procCreatePseudoConsole       = kernel32.NewProc("CreatePseudoConsole")
	procUpdateProcThreadAttribute = kernel32.NewProc("UpdateProcThreadAttribute")
)

// conPTYAvailable informa se o Windows tem ConPTY (Windows 10 1809 / Server 2019 em diante).
func conPTYAvailable() bool { return procCreatePseudoConsole.Find() == nil }

func systemRoot() string {
	if r := os.Getenv("SystemRoot"); r != "" {
		return r
	}
	return `C:\Windows`
}

func powershellPath() string {
	return filepath.Join(systemRoot(), `System32\WindowsPowerShell\v1.0\powershell.exe`)
}

// resolveShell aceita os shells do console no Windows (CommandEndpoints.WindowsShells) e pwsh.
func resolveShell(shell string) (kind, path string, err error) {
	switch strings.ToLower(strings.TrimSpace(shell)) {
	case "", "cmd", "cmd.exe":
		return "cmd", filepath.Join(systemRoot(), `System32\cmd.exe`), nil
	case "powershell", "powershell.exe":
		return "powershell", powershellPath(), nil
	case "pwsh", "pwsh.exe":
		if p, err := exec.LookPath("pwsh"); err == nil {
			return "powershell", p, nil
		}
		return "powershell", powershellPath(), nil
	}
	return "", "", unsupported(shell)
}

func workDir() string {
	if d := os.Getenv("SystemDrive"); d != "" {
		return d + `\`
	}
	return `C:\`
}

// startConsole abre o shell num ConPTY; sem ConPTY (Windows Server 2016, Windows 10 antes do 1809),
// cai para o modo de linha por pipes.
func startConsole(shell string, cols, rows int) (console, error) {
	kind, path, err := resolveShell(shell)
	if err != nil {
		return nil, err
	}
	if conPTYAvailable() {
		args := []string{path}
		if kind == "powershell" {
			args = append(args, "-NoLogo")
		}
		c, err := startConPTY(windows.ComposeCommandLine(args), cols, rows)
		if err == nil {
			return c, nil
		}
		if errors.Is(err, errProcess) {
			return nil, err
		}
		// Falha do proprio ConPTY: tenta o modo de linha.
	}
	return startPipe(kind, path)
}

// newKillJob cria um Job Object que encerra todos os processos quando e fechado ou terminado.
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

// errProcess marca falhas ao criar o processo do shell (nao adianta tentar o modo de linha).
var errProcess = errors.New("falha ao criar o processo do shell")

// conPTY e o shell num pseudoconsole do Windows, num Job Object proprio.
type conPTY struct {
	mu      sync.Mutex
	hpc     windows.Handle
	hpcDone bool
	in      *os.File // escrita: entrada do pseudoconsole
	out     *os.File // leitura: saida VT do pseudoconsole
	proc    windows.Handle
	job     windows.Handle
	close   sync.Once
}

func startConPTY(cmdline string, cols, rows int) (_ *conPTY, err error) {
	var inR, inW, outR, outW windows.Handle
	if err := windows.CreatePipe(&inR, &inW, nil, 0); err != nil {
		return nil, fmt.Errorf("CreatePipe: %w", err)
	}
	if err := windows.CreatePipe(&outR, &outW, nil, 0); err != nil {
		windows.CloseHandle(inR)
		windows.CloseHandle(inW)
		return nil, fmt.Errorf("CreatePipe: %w", err)
	}
	// O lado do pseudoconsole (inR, outW) e liberado depois do CreateProcess: o conhost tem copias,
	// e so assim a leitura percebe o fim quando o pseudoconsole fecha.
	defer windows.CloseHandle(inR)
	defer windows.CloseHandle(outW)
	defer func() {
		if err != nil {
			windows.CloseHandle(inW)
			windows.CloseHandle(outR)
		}
	}()

	var hpc windows.Handle
	if err := windows.CreatePseudoConsole(windows.Coord{X: int16(cols), Y: int16(rows)}, inR, outW, 0, &hpc); err != nil {
		return nil, fmt.Errorf("CreatePseudoConsole: %w", err)
	}
	defer func() {
		if err != nil {
			windows.ClosePseudoConsole(hpc)
		}
	}()

	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, fmt.Errorf("InitializeProcThreadAttributeList: %w", err)
	}
	defer attrs.Delete()
	// O valor do atributo e o proprio HPCON (nao um ponteiro para ele).
	if r1, _, e := procUpdateProcThreadAttribute.Call(uintptr(unsafe.Pointer(attrs.List())), 0,
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(hpc), unsafe.Sizeof(hpc), 0, 0); r1 == 0 {
		return nil, fmt.Errorf("UpdateProcThreadAttribute: %w", e)
	}

	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	// Handles padrao nulos: sem isso o shell herda stdin/stdout do agente (redirecionados no servico)
	// e escreve fora do pseudoconsole.
	si.Flags = windows.STARTF_USESTDHANDLES
	cmd16, err := windows.UTF16PtrFromString(cmdline)
	if err != nil {
		return nil, err
	}
	dir16, err := windows.UTF16PtrFromString(workDir())
	if err != nil {
		return nil, err
	}
	job, err := newKillJob()
	if err != nil {
		return nil, fmt.Errorf("CreateJobObject: %w", err)
	}
	var pi windows.ProcessInformation
	// Suspenso ate entrar no Job Object, para nenhum filho escapar.
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_SUSPENDED)
	if err := windows.CreateProcess(nil, cmd16, nil, nil, false, flags, nil, dir16, &si.StartupInfo, &pi); err != nil {
		windows.CloseHandle(job)
		return nil, fmt.Errorf("%w: %w", errProcess, err)
	}
	if err := windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		// Sem job, o Kill encerra so o shell (o fechamento do pseudoconsole derruba os anexados).
		windows.CloseHandle(job)
		job = 0
	}
	_, _ = windows.ResumeThread(pi.Thread)
	windows.CloseHandle(pi.Thread)

	return &conPTY{
		hpc:  hpc,
		in:   os.NewFile(uintptr(inW), "conpty-in"),
		out:  os.NewFile(uintptr(outR), "conpty-out"),
		proc: pi.Process,
		job:  job,
	}, nil
}

func (c *conPTY) Read(p []byte) (int, error) { return c.out.Read(p) }

// Write repassa a entrada como veio do xterm (UTF-8 com sequencias VT): o ConPTY interpreta.
func (c *conPTY) Write(p []byte) (int, error) { return c.in.Write(p) }

func (c *conPTY) Resize(cols, rows int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hpcDone {
		return nil
	}
	return windows.ResizePseudoConsole(c.hpc, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (c *conPTY) Kill() {
	if c.job != 0 {
		_ = windows.TerminateJobObject(c.job, 1)
		return
	}
	_ = windows.TerminateProcess(c.proc, 1)
}

func (c *conPTY) Wait() int {
	_, _ = windows.WaitForSingleObject(c.proc, windows.INFINITE)
	var code uint32
	if err := windows.GetExitCodeProcess(c.proc, &code); err != nil {
		return 1
	}
	return int(int32(code))
}

// CloseOutput fecha o pseudoconsole. Ele pode emitir um ultimo quadro e bloquear ate a saida ser
// drenada, por isso a leitura continua em outra rotina; depois disso a leitura recebe fim de pipe.
func (c *conPTY) CloseOutput() {
	c.mu.Lock()
	if c.hpcDone {
		c.mu.Unlock()
		return
	}
	c.hpcDone = true
	c.mu.Unlock()
	windows.ClosePseudoConsole(c.hpc)
}

// Close libera os handles em segundo plano (fechar um pipe com leitura pendente pode esperar).
func (c *conPTY) Close() {
	c.close.Do(func() {
		go func() {
			c.CloseOutput()
			_ = c.in.Close()
			_ = c.out.Close()
			if c.job != 0 {
				// KILL_ON_JOB_CLOSE: processos que sobraram da sessao terminam aqui.
				windows.CloseHandle(c.job)
			}
			windows.CloseHandle(c.proc)
		}()
	})
}

// pipeConsole e o modo sem PTY: cmd ou PowerShell lendo stdin por pipe, com eco e edicao de linha
// feitos pelo agente (lineMode). Programas de tela cheia, prompts interativos e Ctrl+C nao funcionam;
// o cmd roda com eco desligado (/Q), entao nao mostra o prompt.
type pipeConsole struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	r      *os.File // saida combinada (stdout, stderr e eco)
	w      *os.File
	wmu    sync.Mutex
	wDone  bool
	lm     *lineMode
	job    windows.Handle
	rbuf   []byte
	lastCR bool
	close  sync.Once
}

const pipeBanner = "[EYES] ConPTY indisponivel nesta versao do Windows: terminal em modo de linha " +
	"(sem prompt, sem programas de tela cheia e sem Ctrl+C).\r\n"

func startPipe(kind, path string) (*pipeConsole, error) {
	cmd := exec.Command(path)
	var first string
	if kind == "cmd" {
		// Eco desligado (o agente ecoa o que e digitado) e saida em UTF-8.
		cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `"` + path + `" /Q /K chcp 65001>NUL`}
	} else {
		cmd.Args = []string{path, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"}
		cmd.SysProcAttr = &syscall.SysProcAttr{}
		first = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\r\n"
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags = createNoWindow
	cmd.Dir = workDir()
	r, w, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	cmd.Stdout, cmd.Stderr = w, w
	stdin, err := cmd.StdinPipe()
	if err != nil {
		r.Close()
		w.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		r.Close()
		w.Close()
		return nil, err
	}
	c := &pipeConsole{cmd: cmd, stdin: stdin, r: r, w: w, lm: newLineMode("\r\n")}
	if job, err := newKillJob(); err == nil {
		if h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid)); err == nil {
			if windows.AssignProcessToJobObject(job, h) == nil {
				c.job = job
			}
			windows.CloseHandle(h)
		}
		if c.job == 0 {
			windows.CloseHandle(job)
		}
	}
	c.echo([]byte(pipeBanner))
	if first != "" {
		_, _ = stdin.Write([]byte(first))
	}
	return c, nil
}

func (c *pipeConsole) echo(b []byte) {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if !c.wDone {
		_, _ = c.w.Write(b)
	}
}

// Read le a saida e troca \n isolado por \r\n (o xterm nao volta ao inicio da linha sozinho).
func (c *pipeConsole) Read(p []byte) (int, error) {
	half := max(len(p)/2, 1)
	if cap(c.rbuf) < half {
		c.rbuf = make([]byte, half)
	}
	buf := c.rbuf[:half]
	n, err := c.r.Read(buf)
	out := p[:0]
	for _, b := range buf[:n] {
		if b == '\n' && !c.lastCR {
			out = append(out, '\r')
		}
		c.lastCR = b == '\r'
		out = append(out, b)
	}
	return len(out), err
}

func (c *pipeConsole) Write(p []byte) (int, error) {
	echo, lines := c.lm.feed(p)
	if len(echo) > 0 {
		c.echo(echo)
	}
	if len(lines) > 0 {
		if _, err := c.stdin.Write(lines); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

// Resize nao tem efeito sem PTY.
func (c *pipeConsole) Resize(int, int) error { return nil }

func (c *pipeConsole) Kill() {
	if c.job != 0 {
		_ = windows.TerminateJobObject(c.job, 1)
		return
	}
	if c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
}

func (c *pipeConsole) Wait() int {
	err := c.cmd.Wait()
	if c.cmd.ProcessState != nil {
		return c.cmd.ProcessState.ExitCode()
	}
	if err != nil {
		return 1
	}
	return 0
}

// CloseOutput fecha a copia do agente do lado de escrita; a leitura acaba quando os processos
// da sessao fecharem as deles.
func (c *pipeConsole) CloseOutput() {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if !c.wDone {
		c.wDone = true
		_ = c.w.Close()
	}
}

func (c *pipeConsole) Close() {
	c.close.Do(func() {
		go func() {
			c.CloseOutput()
			_ = c.stdin.Close()
			_ = c.r.Close()
			if c.job != 0 {
				windows.CloseHandle(c.job)
			}
		}()
	})
}
