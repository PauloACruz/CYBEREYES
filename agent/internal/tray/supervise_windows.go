//go:build windows

package tray

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

const trayExe = "eyes-tray.exe"

// startSupervisor mantem o eyes-tray atualizado e em execucao em cada sessao de usuario ativa.
// So roda quando o EYES e servico (eyes run em primeiro plano nao abre janelas nas sessoes).
func startSupervisor(e *env.Env) {
	if !e.Service {
		return
	}
	e.Go("tray-supervisor", func(ctx context.Context) {
		s := &supervisor{e: e, launches: map[uint32][]time.Time{}}
		// Espera a rede e o registro estarem prontos.
		select {
		case <-ctx.Done():
			return
		case <-time.After(20 * time.Second):
		}
		s.ensureBinary(ctx)
		lastCheck := time.Now()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			s.tick()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			if time.Since(lastCheck) > 6*time.Hour {
				s.ensureBinary(ctx)
				lastCheck = time.Now()
			}
		}
	})
}

type supervisor struct {
	e        *env.Env
	launches map[uint32][]time.Time
}

func trayPath() string { return filepath.Join(config.InstallDir(), trayExe) }

func versionFile() string { return filepath.Join(config.InstallDir(), "eyes-tray.version") }

// ensureBinary baixa o eyes-tray da API quando falta ou e de outra versao do EYES.
func (s *supervisor) ensureBinary(ctx context.Context) {
	if data, err := os.ReadFile(versionFile()); err == nil && strings.TrimSpace(string(data)) == version.Version {
		if _, err := os.Stat(trayPath()); err == nil {
			return
		}
	}
	tmp := trayPath() + ".download"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		s.e.Log.Warn("app de bandeja: falha ao criar o arquivo", "erro", err)
		return
	}
	dctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	n, err := s.e.API.Download(dctx, "GET", "/api/agent/download/windows/"+runtime.GOARCH+"?component=tray", nil, f)
	f.Close()
	if err != nil || n < 1<<20 {
		os.Remove(tmp)
		s.e.Log.Info("app de bandeja indisponivel no servidor", "erro", err)
		return
	}
	// O executavel antigo pode estar em uso: renomeia antes de trocar e encerra as instancias antigas.
	old := trayPath() + ".old"
	_ = os.Remove(old)
	if _, err := os.Stat(trayPath()); err == nil {
		if err := os.Rename(trayPath(), old); err != nil {
			os.Remove(tmp)
			s.e.Log.Warn("app de bandeja: falha ao substituir", "erro", err)
			return
		}
	}
	if err := os.Rename(tmp, trayPath()); err != nil {
		s.e.Log.Warn("app de bandeja: falha ao instalar", "erro", err)
		return
	}
	_ = os.WriteFile(versionFile(), []byte(version.Version), 0o644)
	killAll(old)
	s.e.Log.Info("app de bandeja atualizado", "versao", version.Version)
}

// tick inicia o app nas sessoes ativas que ainda nao o tem.
func (s *supervisor) tick() {
	if _, err := os.Stat(trayPath()); err != nil {
		return
	}
	running := sessionsRunning(trayExe)
	for _, sid := range activeSessions() {
		if running[sid] || !s.allow(sid) {
			continue
		}
		if err := launchInSession(sid, trayPath(), "--hidden"); err != nil {
			s.e.Log.Warn("app de bandeja: falha ao iniciar na sessao", "sessao", sid, "erro", err)
		}
	}
}

// allow limita a 5 inicios por hora por sessao (um app que fecha sozinho nao entra em laco).
func (s *supervisor) allow(sid uint32) bool {
	now := time.Now()
	recent := s.launches[sid][:0]
	for _, t := range s.launches[sid] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 5 {
		s.launches[sid] = recent
		return false
	}
	s.launches[sid] = append(recent, now)
	return true
}

func activeSessions() []uint32 {
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		return nil
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	var out []uint32
	for _, s := range unsafe.Slice(sessions, count) {
		if s.State == windows.WTSActive && s.SessionID != 0 {
			out = append(out, s.SessionID)
		}
	}
	return out
}

// sessionsRunning devolve as sessoes que ja tem um processo com o nome informado.
func sessionsRunning(name string) map[uint32]bool {
	out := map[uint32]bool{}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return out
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), name) {
			var sid uint32
			if windows.ProcessIdToSessionId(pe.ProcessID, &sid) == nil {
				out[sid] = true
			}
		}
	}
	return out
}

// killAll encerra os processos cujo executavel e path (versao antiga do app).
func killAll(path string) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if !strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), trayExe) {
			continue
		}
		h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pe.ProcessID)
		if err != nil {
			continue
		}
		buf := make([]uint16, windows.MAX_LONG_PATH)
		size := uint32(len(buf))
		if windows.QueryFullProcessImageName(h, 0, &buf[0], &size) == nil && strings.EqualFold(windows.UTF16ToString(buf[:size]), path) {
			_ = windows.TerminateProcess(h, 0)
		}
		windows.CloseHandle(h)
	}
}

var (
	userenv                     = windows.NewLazySystemDLL("userenv.dll")
	procCreateEnvironmentBlock  = userenv.NewProc("CreateEnvironmentBlock")
	procDestroyEnvironmentBlock = userenv.NewProc("DestroyEnvironmentBlock")
)

// launchInSession cria o processo na sessao do usuario, com o token dele e na area de trabalho interativa.
func launchInSession(sid uint32, exe string, args ...string) error {
	var tok windows.Token
	if err := windows.WTSQueryUserToken(sid, &tok); err != nil {
		return err
	}
	defer tok.Close()
	var envBlock *uint16
	if r, _, err := procCreateEnvironmentBlock.Call(uintptr(unsafe.Pointer(&envBlock)), uintptr(tok), 0); r == 0 {
		return err
	}
	defer procDestroyEnvironmentBlock.Call(uintptr(unsafe.Pointer(envBlock)))

	cmdline := syscall.EscapeArg(exe)
	for _, a := range args {
		cmdline += " " + syscall.EscapeArg(a)
	}
	cmd, err := windows.UTF16PtrFromString(cmdline)
	if err != nil {
		return err
	}
	desktop, _ := windows.UTF16PtrFromString(`winsta0\default`)
	dir, _ := windows.UTF16PtrFromString(filepath.Dir(exe))
	si := windows.StartupInfo{Desktop: desktop}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	const createUnicodeEnvironment = 0x00000400
	if err := windows.CreateProcessAsUser(tok, nil, cmd, nil, nil, false,
		createUnicodeEnvironment|windows.CREATE_NEW_PROCESS_GROUP, envBlock, dir, &si, &pi); err != nil {
		return err
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}
