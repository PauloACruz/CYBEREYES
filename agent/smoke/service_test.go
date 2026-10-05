//go:build smoke

package smoke

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Caminhos reais da instalacao (internal/config e internal/service).
type servicePaths struct {
	binary  string
	dataDir string
	unit    string // unit do systemd, plist do launchd; vazio no Windows
}

func realPaths() servicePaths {
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		if pf == "" {
			pf = `C:\Program Files`
		}
		pd := os.Getenv("ProgramData")
		if pd == "" {
			pd = `C:\ProgramData`
		}
		return servicePaths{binary: filepath.Join(pf, "Cybereyes", "EYES", "eyes.exe"), dataDir: filepath.Join(pd, "Cybereyes", "EYES")}
	case "darwin":
		return servicePaths{binary: "/usr/local/cybereyes/eyes", dataDir: "/Library/Application Support/Cybereyes/EYES",
			unit: "/Library/LaunchDaemons/br.com.cybereyes.eyes.plist"}
	default:
		return servicePaths{binary: "/opt/cybereyes/eyes", dataDir: "/etc/cybereyes", unit: "/etc/systemd/system/eyes.service"}
	}
}

// isAdmin confere root (Unix) ou administrador elevado (Windows: "net session" exige elevacao).
func isAdmin() bool {
	if runtime.GOOS == "windows" {
		return exec.Command("net", "session").Run() == nil
	}
	return os.Geteuid() == 0
}

// cmdOutput executa e devolve a saida combinada e o erro.
func cmdOutput(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// serviceState devolve se o servico existe e a saida da consulta (para o log).
func serviceState() (exists bool, info string) {
	switch runtime.GOOS {
	case "windows":
		out, err := cmdOutput("sc", "query", "eyes")
		return err == nil, out
	case "darwin":
		out, err := cmdOutput("launchctl", "print", "system/br.com.cybereyes.eyes")
		return err == nil, truncate(out, 1500)
	default:
		status, _ := cmdOutput("systemctl", "status", "--no-pager", "eyes.service")
		_, err := cmdOutput("systemctl", "cat", "eyes.service")
		return err == nil, status
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// TestService instala o servico de verdade (sem MeshAgent) apontando para os servidores falsos,
// espera o agent-hello do processo do servico, confere que ele roda como SYSTEM/root e depois
// desinstala, conferindo que servico e arquivos sumiram. Exige EYES_SMOKE_SERVICE=1 e admin/root.
func TestService(t *testing.T) {
	if os.Getenv("EYES_SMOKE_SERVICE") != "1" {
		t.Skip("defina EYES_SMOKE_SERVICE=1 para instalar o servico de verdade (exige admin/root)")
	}
	if !isAdmin() {
		t.Fatal("EYES_SMOKE_SERVICE=1 exige administrador (Windows) ou root (sudo -E no Linux e macOS)")
	}
	paths := realPaths()
	env := cleanEnv()

	// Restos de uma execucao anterior.
	if ok, _ := serviceState(); ok || exists(paths.binary) || exists(paths.dataDir) {
		t.Log("instalacao anterior encontrada: desinstalando antes do teste")
		_, _ = runEyes(t, env, 3*time.Minute, "uninstall", "--keep-mesh")
	}

	h := newHarness(t)
	uninstalled := false
	t.Cleanup(func() {
		if t.Failed() {
			dumpServiceDiagnostics(t, paths)
			t.Logf("chamadas REST recebidas:\n%s", h.api.describe())
		}
		if !uninstalled {
			_, _ = runEyes(t, env, 3*time.Minute, "uninstall", "--keep-mesh")
		}
	})

	start := time.Now()
	if _, err := runEyes(t, env, 5*time.Minute, "install",
		"--api", h.api.URL(), "--nats-url", h.NatsURL(),
		"--client-id", "1", "--site-id", "1", "--agent-type", "server", "--auth", h.api.installToken, "--nomesh"); err != nil {
		t.Fatalf("eyes install falhou: %v", err)
	}
	agentID := h.agentID()
	if !exists(paths.binary) {
		t.Errorf("binario nao instalado em %s", paths.binary)
	}
	cfgFile := filepath.Join(paths.dataDir, "eyes.json")
	if st, err := os.Stat(cfgFile); err != nil {
		t.Errorf("configuracao nao gravada em %s: %v", cfgFile, err)
	} else if runtime.GOOS != "windows" && st.Mode().Perm() != 0o600 {
		t.Errorf("%s com permissao %o (esperado 600)", cfgFile, st.Mode().Perm())
	}
	if paths.unit != "" && !exists(paths.unit) {
		t.Errorf("definicao do servico ausente: %s", paths.unit)
	}
	if ok, info := serviceState(); !ok {
		t.Fatalf("o servico nao existe depois do install:\n%s", info)
	} else {
		t.Logf("servico instalado:\n%s", info)
	}

	// O processo do servico conecta no NATS e manda o hello.
	if !waitFor(checkinWait, time.Second, func() bool {
		c, ok := h.lastCheckin("agent-hello")
		return ok && c.Body["agent_id"] == agentID
	}) {
		t.Fatalf("o servico nao mandou agent-hello em %s", checkinWait)
	}
	t.Logf("agent-hello do servico em %s", time.Since(start).Round(time.Millisecond))

	if v := h.call(t, "ping", nil, nil, 30*time.Second); v != "pong" {
		t.Errorf("ping ao servico: %s", brief(v))
	}
	// O servico roda como SYSTEM (Windows) ou root (Unix).
	shell, command := "/bin/sh", "id -u"
	if runtime.GOOS == "windows" {
		shell, command = "cmd", "whoami"
	}
	v := h.call(t, "rawcmd", map[string]any{"timeout": 60, "run_as_user": false, "id": 3000},
		map[string]string{"command": command, "shell": shell}, 70*time.Second)
	who, _ := v.(string)
	who = strings.ToLower(strings.TrimSpace(who))
	if runtime.GOOS == "windows" && !strings.Contains(who, "system") {
		t.Errorf("o servico deveria rodar como SYSTEM, whoami = %q", who)
	}
	if runtime.GOOS != "windows" && who != "0" {
		t.Errorf("o servico deveria rodar como root, id -u = %q", who)
	}
	if t.Failed() {
		return
	}

	// Desinstalacao.
	if _, err := runEyes(t, env, 3*time.Minute, "uninstall", "--keep-mesh"); err != nil {
		t.Fatalf("eyes uninstall falhou: %v", err)
	}
	uninstalled = true
	if !waitFor(time.Minute, time.Second, func() bool { ok, _ := serviceState(); return !ok }) {
		_, info := serviceState()
		t.Errorf("o servico continua registrado depois do uninstall:\n%s", info)
	}
	// No Windows a pasta do binario pode ser apagada alguns segundos depois (processo separado).
	if !waitFor(time.Minute, time.Second, func() bool { return !exists(paths.binary) && !exists(paths.dataDir) }) {
		t.Errorf("arquivos restantes depois do uninstall: binario=%v dados=%v", exists(paths.binary), exists(paths.dataDir))
	}
	if paths.unit != "" && exists(paths.unit) {
		t.Errorf("definicao do servico restante: %s", paths.unit)
	}
	// Sem o servico, ninguem responde no assunto do agente.
	if !waitFor(time.Minute, 2*time.Second, func() bool {
		_, err := h.request("ping", nil, nil, 3*time.Second)
		return err != nil
	}) {
		t.Error("o agente ainda responde ping depois do uninstall")
	}
}

// dumpServiceDiagnostics imprime o log do servico e o estado do gerenciador de servicos.
func dumpServiceDiagnostics(t *testing.T, paths servicePaths) {
	t.Logf("log do servico (%s):\n%s", filepath.Join(paths.dataDir, "logs", "eyes.log"),
		tailFile(filepath.Join(paths.dataDir, "logs", "eyes.log"), 64<<10))
	_, info := serviceState()
	t.Logf("estado do servico:\n%s", info)
	switch runtime.GOOS {
	case "linux":
		out, _ := cmdOutput("journalctl", "-u", "eyes.service", "--no-pager", "-n", "200")
		t.Logf("journalctl -u eyes:\n%s", out)
	case "darwin":
		t.Logf("/var/log/eyes.log:\n%s", tailFile("/var/log/eyes.log", 32<<10))
	case "windows":
		out, _ := cmdOutput("sc", "qc", "eyes")
		t.Logf("sc qc eyes:\n%s", out)
	}
}
