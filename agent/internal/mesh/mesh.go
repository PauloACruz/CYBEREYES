// Package mesh so remove o MeshAgent de instalacoes antigas no "eyes uninstall". O EYES nao instala nem
// sincroniza mais o MeshAgent: o acesso remoto e do proprio EYES (RFC-001, ADR-022, fase 12.8).
package mesh

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Uninstall remove o MeshAgent instalado, se houver.
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
		candidates = []string{"/opt/cybereyes-mesh/meshagent", "/opt/tacticalmesh/meshagent", "/usr/local/mesh_services/meshagent/meshagent"}
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
