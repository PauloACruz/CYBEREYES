// Package mesh instala o MeshAgent (acesso remoto pelo MeshCentral) e informa o node id ao servidor.
package mesh

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
)

// Download baixa o MeshAgent ja vinculado ao grupo do Cybereyes.
// Na instalacao usa POST /api/v3/meshexe/ (token de instalacao); depois, GET /api/v3/<id>/meshreinstall/ (Windows).
func Download(ctx context.Context, client *api.Client, method, path string, body any) (string, error) {
	dir := filepath.Join(config.DataDir(), "mesh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	name := "meshagent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(dir, name)
	f, err := os.OpenFile(dest+".download", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return "", err
	}
	n, err := client.Download(ctx, method, path, body, f)
	f.Close()
	if err != nil {
		os.Remove(dest + ".download")
		return "", fmt.Errorf("download do MeshAgent: %w", err)
	}
	if n < 100_000 {
		os.Remove(dest + ".download")
		return "", fmt.Errorf("download do MeshAgent incompleto (%d bytes)", n)
	}
	_ = os.Remove(dest)
	if err := os.Rename(dest+".download", dest); err != nil {
		return "", err
	}
	return dest, nil
}

// Install executa o instalador do MeshAgent baixado.
func Install(ctx context.Context, installer string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.CommandContext(ctx, installer, "-fullinstall")
	case "linux":
		_ = os.MkdirAll(linuxDir, 0o755)
		cmd = exec.CommandContext(ctx, installer, "-install", "--installPath="+linuxDir)
	default:
		cmd = exec.CommandContext(ctx, installer, "-install")
	}
	// Sem DISPLAY real: o MeshAgent nao tenta abrir janelas durante a instalacao.
	cmd.Env = append(os.Environ(), "XAUTHORITY=/nonexistent", "DISPLAY=")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("instalacao do MeshAgent: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Uninstall remove o MeshAgent instalado.
func Uninstall(ctx context.Context) error {
	bin := Binary()
	if bin == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	arg := "-uninstall"
	if runtime.GOOS == "windows" {
		arg = "-fulluninstall"
	}
	out, err := exec.CommandContext(ctx, bin, arg).CombinedOutput()
	if err != nil {
		return fmt.Errorf("remocao do MeshAgent: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

const linuxDir = "/opt/cybereyes-mesh"

// Binary devolve o caminho do MeshAgent instalado ou "" quando nao ha.
func Binary() string {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		if pf == "" {
			pf = `C:\Program Files`
		}
		candidates = []string{filepath.Join(pf, "Mesh Agent", "MeshAgent.exe"), filepath.Join(pf, "Mesh Agent", "meshagent.exe")}
	case "linux":
		candidates = []string{filepath.Join(linuxDir, "meshagent"), "/opt/tacticalmesh/meshagent", "/usr/local/mesh_services/meshagent/meshagent"}
	default:
		candidates = []string{"/usr/local/mesh_services/meshagent/meshagent", "/opt/cybereyes-mesh/meshagent"}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

var hexRe = regexp.MustCompile(`(?i)\b[0-9a-f]{96}\b`)
var b64Re = regexp.MustCompile(`[A-Za-z0-9+/@$]{64}`)

// NodeID pergunta ao MeshAgent o identificador do no, em hexadecimal (formato que o servidor espera).
func NodeID(ctx context.Context) (string, error) {
	bin := Binary()
	if bin == "" {
		return "", errors.New("MeshAgent nao instalado")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// --no-embedded=1: sem ele, o binario com .msh embutido responde como instalador.
	// O node id so existe depois da primeira execucao do servico (meshagent.db).
	cmd := exec.CommandContext(ctx, bin, "-nodeid", "--no-embedded=1")
	cmd.Dir = filepath.Dir(bin)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("MeshAgent -nodeid: %w", err)
	}
	return parseNodeID(out)
}

func parseNodeID(out []byte) (string, error) {
	out = bytes.TrimSpace(out)
	if m := hexRe.Find(out); m != nil {
		return strings.ToUpper(string(m)), nil
	}
	if m := b64Re.Find(out); m != nil {
		s := strings.NewReplacer("@", "+", "$", "/").Replace(string(m))
		raw, err := base64.StdEncoding.DecodeString(s)
		if err == nil && len(raw) == 48 {
			return strings.ToUpper(hex.EncodeToString(raw)), nil
		}
	}
	return "", fmt.Errorf("node id nao reconhecido na saida do MeshAgent: %q", truncate(string(out), 120))
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
