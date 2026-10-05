//go:build windows

package care

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const createNoWindow = 0x08000000

// procTree e um Job Object: encerrar o job encerra todos os processos do modulo.
type procTree struct{ job windows.Handle }

func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	cmd.WaitDelay = 5 * time.Second
}

func trackTree(cmd *exec.Cmd) *procTree {
	if cmd.Process == nil {
		return nil
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return nil
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return nil
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		windows.CloseHandle(job)
		return nil
	}
	return &procTree{job: job}
}

// kill encerra o job inteiro (ou a arvore pelo taskkill quando o job nao foi criado).
func (t *procTree) kill(cmd *exec.Cmd) {
	if t != nil {
		_ = windows.TerminateJobObject(t.job, 98)
		return
	}
	if cmd.Process != nil {
		_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(cmd.Process.Pid)).Run()
	}
}

// release fecha o job sem derrubar processos que o modulo deixou de proposito em segundo plano.
func (t *procTree) release() {
	if t == nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	_, _ = windows.SetInformationJobObject(t.job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	windows.CloseHandle(t.job)
}

// interpreter devolve o Windows PowerShell 5.1 e os argumentos para executar o modulo.
func interpreter(script string) (string, []string) {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	ps := filepath.Join(root, `System32\WindowsPowerShell\v1.0\powershell.exe`)
	return ps, []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script}
}

// Somente SYSTEM e Administradores, sem heranca.
const privateSDDL = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"

func restrictPath(path string, _ bool) error {
	sd, err := windows.SecurityDescriptorFromString(privateSDDL)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

// scriptBytes grava os .ps1 com BOM UTF-8: sem ele o Windows PowerShell 5.1 le o arquivo na
// pagina ANSI, e letras como "O agudo" (bytes C3 93) viram aspas tipograficas que quebram o script.
func scriptBytes(name string, b []byte) []byte {
	if !strings.EqualFold(filepath.Ext(name), ".ps1") || bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}) {
		return b
	}
	return append([]byte{0xEF, 0xBB, 0xBF}, b...)
}

// prepareProbe: comandos das sondas de saude sem janela.
func prepareProbe(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
