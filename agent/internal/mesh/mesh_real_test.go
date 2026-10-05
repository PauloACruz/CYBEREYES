//go:build linux

package mesh

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestRealInstallAndNodeID instala um MeshAgent de verdade e le o node id. So roda como root
// com EYES_MESH_INSTALLER apontando para o binario baixado do MeshCentral (use num container descartavel).
func TestRealInstallAndNodeID(t *testing.T) {
	installer := os.Getenv("EYES_MESH_INSTALLER")
	if installer == "" || os.Geteuid() != 0 {
		t.Skip("defina EYES_MESH_INSTALLER e rode como root")
	}
	ctx := context.Background()
	if err := Install(ctx, installer); err != nil {
		t.Fatal(err)
	}
	bin := Binary()
	if bin == "" {
		t.Fatal("MeshAgent nao encontrado apos a instalacao")
	}
	// Sem systemd no container: executa o agente uma vez para gerar a identidade (o servico faz isso na maquina real).
	run := exec.Command(bin, "--no-embedded=1")
	run.Dir = filepath.Dir(bin)
	if err := run.Start(); err != nil {
		t.Fatal(err)
	}
	defer run.Process.Kill()
	var node string
	var err error
	for i := 0; i < 20; i++ {
		time.Sleep(time.Second)
		if node, err = NodeID(ctx); err == nil {
			break
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(node) != 96 {
		t.Fatalf("node id inesperado: %q", node)
	}
	t.Logf("MeshAgent em %s, node id %s", bin, node)
}

func TestParseNodeID(t *testing.T) {
	hexID := "5BE51D8E63A929275DCF3057DD27E9A12B68C78A469490E1CF7DCA2765974A46BCA721AD6F2856FC39EDBAE630701EA6"
	if got, err := parseNodeID([]byte(hexID + "\n")); err != nil || got != hexID {
		t.Fatalf("hex: %q %v", got, err)
	}
	if _, err := parseNodeID([]byte("The graphical version of this installer cannot run")); err == nil {
		t.Fatal("texto do instalador nao pode virar node id")
	}
}

func TestParseMsh(t *testing.T) {
	data := []byte("MeshName=Cybereyes\r\nMeshType=2\r\nMeshID=0xABC\r\nServerID=XYZ\r\nMeshServer=wss://rc.exemplo.com:443/agent.ashx\r\n")
	s := parseMsh(data)
	if s.Server != "wss://rc.exemplo.com:443/agent.ashx" || s.MeshID != "0xABC" {
		t.Fatalf("msh: %+v", s)
	}
	if !s.Same(Settings{Server: "WSS://RC.exemplo.com:443/agent.ashx", MeshID: "0xabc"}) {
		t.Fatal("comparacao deve ignorar maiusculas")
	}
	if s.Same(Settings{Server: "wss://mesh.tactical.com:443/agent.ashx", MeshID: "0xABC"}) {
		t.Fatal("servidor diferente nao pode ser o mesmo vinculo")
	}
}
