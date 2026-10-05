//go:build linux

package tray

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

const trayExe = "eyes-tray"

// loginGrace e a espera, numa sessao que acabou de abrir, para a area de trabalho subir
// (painel e area de notificacao) antes de iniciar o app.
const loginGrace = 20 * time.Second

// startSupervisor mantem o eyes-tray instalado e em execucao em cada sessao grafica ativa, como no
// Windows: baixa o app da API, instala as bibliotecas que faltam (estacoes), cria o atalho no menu
// de aplicativos e inicia o app como o usuario. So roda como servico e em maquinas com ambiente grafico.
func startSupervisor(e *env.Env) {
	if !e.Service {
		return
	}
	e.Go("tray-supervisor", func(ctx context.Context) {
		s := &supervisor{e: e, launches: map[uint32][]time.Time{}, firstSeen: map[string]time.Time{}}
		if !s.waitGraphical(ctx) {
			return
		}
		s.prepare(ctx)
		lastCheck := time.Now()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			s.tick(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			if time.Since(lastCheck) > 6*time.Hour {
				s.prepare(ctx)
				lastCheck = time.Now()
			}
		}
	})
}

type supervisor struct {
	e         *env.Env
	ready     bool
	ticks     int
	launches  map[uint32][]time.Time
	firstSeen map[string]time.Time
}

// waitGraphical espera a rede e o registro (20 s) e, em maquinas sem ambiente grafico, confere de
// novo a cada 6 horas. Devolve false quando o servico para.
func (s *supervisor) waitGraphical(ctx context.Context) bool {
	wait := 20 * time.Second
	for {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(wait):
		}
		if hasGraphicalEnvironment() || len(graphicalSessions(ctx)) > 0 {
			return true
		}
		if wait < time.Hour {
			s.e.Log.Info("app de bandeja: maquina sem ambiente grafico, nada a instalar")
		}
		wait = 6 * time.Hour
	}
}

// prepare baixa o app (versao nova do EYES), confere as bibliotecas e cria o atalho no menu.
func (s *supervisor) prepare(ctx context.Context) {
	ensureBinary(ctx, s.e)
	if !exists(trayPath()) {
		s.ready = false
		return
	}
	s.ready = s.ensureLibraries(ctx)
	if !s.ready {
		return
	}
	if err := installLauncher(); err != nil {
		s.e.Log.Warn("app de bandeja: falha ao criar o atalho no menu de aplicativos", "erro", err)
	}
}

// ensureLibraries confere se o app executa. Em estacoes instala a WebKitGTK 4.1 quando falta; em
// servidores so avisa no log (pacote grafico nao e instalado sem pedido do administrador).
func (s *supervisor) ensureLibraries(ctx context.Context) bool {
	err := checkLibraries(ctx)
	if err == nil {
		return true
	}
	if !errors.Is(err, errMissingLibraries) {
		s.e.Log.Warn("app de bandeja: o binario nao executa", "erro", err)
		return false
	}
	if s.e.Cfg.AgentType != "workstation" {
		s.e.Log.Warn("app de bandeja: faltam bibliotecas do sistema; instale a WebKitGTK 4.1 para usar o app neste servidor", "erro", err)
		return false
	}
	s.e.Log.Info("app de bandeja: instalando as bibliotecas do sistema (WebKitGTK 4.1)", "motivo", err)
	if err := installLibraries(ctx); err != nil {
		s.e.Log.Warn("app de bandeja: falha ao instalar as bibliotecas", "erro", err)
		return false
	}
	if err := checkLibraries(ctx); err != nil {
		s.e.Log.Warn("app de bandeja: bibliotecas instaladas, mas o app ainda nao executa", "erro", err)
		return false
	}
	s.e.Log.Info("app de bandeja: bibliotecas instaladas")
	return true
}

// tick inicia o app nas sessoes graficas ativas cujo usuario ainda nao o tem aberto.
func (s *supervisor) tick(ctx context.Context) {
	if !s.ready || !exists(trayPath()) {
		return
	}
	current, _ := trayProcesses(trayPath())
	running := map[uint32]bool{}
	for _, p := range current {
		running[p.uid] = true
	}
	now := time.Now()
	present := map[string]bool{}
	for _, ss := range graphicalSessions(ctx) {
		present[ss.ID] = true
		first, ok := s.firstSeen[ss.ID]
		if !ok {
			first = now
			if s.ticks == 0 {
				// Sessao aberta antes do servico (por exemplo, logo apos a instalacao): sem espera.
				first = now.Add(-loginGrace)
			}
			s.firstSeen[ss.ID] = first
		}
		if running[ss.UID] || now.Sub(first) < loginGrace {
			continue
		}
		sessEnv := sessionEnv(ss)
		if sessEnv == nil || !s.allow(ss.UID) {
			continue
		}
		how, err := launch(ctx, ss.UID, sessEnv)
		if err != nil {
			s.e.Log.Warn("app de bandeja: falha ao iniciar na sessao", "sessao", ss.ID, "uid", ss.UID, "erro", err)
			continue
		}
		running[ss.UID] = true
		s.e.Log.Info("app de bandeja iniciado na sessao", "sessao", ss.ID, "uid", ss.UID, "como", how)
	}
	for id := range s.firstSeen {
		if !present[id] {
			delete(s.firstSeen, id)
		}
	}
	s.ticks++
}

// allow limita a 5 inicios por hora por usuario (um app que fecha sozinho nao entra em laco).
func (s *supervisor) allow(uid uint32) bool {
	now := time.Now()
	recent := s.launches[uid][:0]
	for _, t := range s.launches[uid] {
		if now.Sub(t) < time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 5 {
		s.launches[uid] = recent
		return false
	}
	s.launches[uid] = append(recent, now)
	return true
}

// launch inicia o app como o usuario, com o ambiente da sessao grafica. Prefere o systemd do proprio
// usuario (systemd-run --user): o app fica na sessao dele, fora do grupo de processos do servico do
// EYES, e termina com o logout. Sem o systemd do usuario, inicia o processo direto.
func launch(ctx context.Context, uid uint32, sessEnv map[string]string) (string, error) {
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return "", err
	}
	gid, err := strconv.ParseUint(u.Gid, 10, 32)
	if err != nil {
		return "", err
	}
	cred := &syscall.Credential{Uid: uid, Gid: uint32(gid), Groups: groupIDs(u)}
	base := []string{"HOME=" + u.HomeDir, "USER=" + u.Username, "LOGNAME=" + u.Username,
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	keys := make([]string, 0, len(sessEnv))
	for k := range sessEnv {
		keys = append(keys, k)
	}
	slices.Sort(keys)

	var userManagerErr error
	if run, err := exec.LookPath("systemd-run"); err == nil && exists(filepath.Join(sessEnv["XDG_RUNTIME_DIR"], "systemd", "private")) {
		args := []string{"--user", "--collect", "--quiet", "--description=EYES (app de bandeja)"}
		for _, k := range keys {
			args = append(args, "--setenv="+k+"="+sessEnv[k])
		}
		args = append(args, trayPath(), "--hidden")
		rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(rctx, run, args...)
		cmd.Env = append(base, "XDG_RUNTIME_DIR="+sessEnv["XDG_RUNTIME_DIR"])
		if bus := sessEnv["DBUS_SESSION_BUS_ADDRESS"]; bus != "" {
			cmd.Env = append(cmd.Env, "DBUS_SESSION_BUS_ADDRESS="+bus)
		}
		cmd.Dir = u.HomeDir
		cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred}
		out, err := cmd.CombinedOutput()
		if err == nil {
			return "systemd-run --user", nil
		}
		userManagerErr = fmt.Errorf("systemd-run: %v: %s", err, strings.TrimSpace(string(out)))
	}

	cmd := exec.Command(trayPath(), "--hidden")
	cmd.Env = base
	for _, k := range keys {
		cmd.Env = append(cmd.Env, k+"="+sessEnv[k])
	}
	cmd.Dir = u.HomeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Credential: cred}
	if err := cmd.Start(); err != nil {
		if userManagerErr != nil {
			return "", fmt.Errorf("%v; direto: %w", userManagerErr, err)
		}
		return "", err
	}
	go func() { _ = cmd.Wait() }()
	if userManagerErr != nil {
		return "processo direto (" + userManagerErr.Error() + ")", nil
	}
	return "processo direto", nil
}

func groupIDs(u *user.User) []uint32 {
	ids, err := u.GroupIds()
	if err != nil {
		return nil
	}
	out := make([]uint32, 0, len(ids))
	for _, id := range ids {
		if n, err := strconv.ParseUint(id, 10, 32); err == nil {
			out = append(out, uint32(n))
		}
	}
	return out
}

// swapBinary troca o executavel (rename atomico) e encerra as instancias da versao antiga; o
// supervisor inicia a nova na proxima volta.
func swapBinary(tmp string) error {
	if err := os.Chmod(tmp, 0o755); err != nil {
		return err
	}
	if err := os.Rename(tmp, trayPath()); err != nil {
		return err
	}
	// A instancia nova so assume a bandeja (instancia unica pelo D-Bus) depois que a antiga sai.
	_, stale := trayProcesses(trayPath())
	stopAll(stale)
	return nil
}

// stopAll pede o encerramento (SIGTERM), espera ate 5 s e forca (SIGKILL) quem nao saiu.
func stopAll(list []proc) {
	signalAll(list, syscall.SIGTERM)
	if alive := waitExit(list, 5*time.Second); len(alive) > 0 {
		signalAll(alive, syscall.SIGKILL)
		waitExit(alive, 2*time.Second)
	}
}

// waitExit espera os processos terminarem, ate o limite, e devolve os que continuam vivos.
func waitExit(list []proc, limit time.Duration) []proc {
	deadline := time.Now().Add(limit)
	var alive []proc
	for _, p := range list {
		for running(p) && time.Now().Before(deadline) {
			time.Sleep(100 * time.Millisecond)
		}
		if running(p) {
			alive = append(alive, p)
		}
	}
	return alive
}

func running(p proc) bool { return exists(filepath.Join(procRoot, strconv.Itoa(p.pid))) }

// Remove encerra o app em todas as sessoes e apaga o atalho do menu (desinstalacao do EYES; o binario
// e o icone saem com a pasta de instalacao).
func Remove() {
	current, stale := trayProcesses(trayPath())
	stopAll(append(current, stale...))
	_ = os.Remove(desktopEntryPath)
}
