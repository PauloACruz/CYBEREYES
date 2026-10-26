//go:build windows

package binswap

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestHelperSleep so roda como processo auxiliar: segura a propria imagem em execucao.
func TestHelperSleep(t *testing.T) {
	if os.Getenv("BINSWAP_HELPER") != "1" {
		t.Skip("so como processo auxiliar")
	}
	time.Sleep(2 * time.Minute)
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	src, err := os.Open(from)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	out, err := os.Create(to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, src); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
}

// Troca com uma imagem em execucao de verdade: o Windows deixa renomear o executavel em uso, mas nao sobrescreve-lo, e um
// handle aberto sem FILE_SHARE_DELETE no arquivo novo (como o do antivirus) impede o rename dele.
func TestSwapRunningImageOnWindows(t *testing.T) {
	fast(t, os.Rename)
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	dest := filepath.Join(dir, "eyes.exe")
	copyFile(t, self, dest)
	cmd := exec.Command(dest, "-test.run=^TestHelperSleep$")
	cmd.Env = append(os.Environ(), "BINSWAP_HELPER=1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	// Registrado depois do TempDir, roda antes dele: o processo sai antes de a pasta ser apagada.
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	time.Sleep(time.Second)
	if err := os.WriteFile(dest, []byte("x"), 0o755); err == nil {
		t.Fatal("o Windows devia recusar sobrescrever a imagem em execucao")
	}

	tmp := filepath.Join(dir, "eyes.exe.update")
	write(t, tmp, "novo")
	lock, err := os.Open(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if err := Swap(context.Background(), tmp, dest, true); err == nil {
		t.Fatal("com o arquivo novo preso, a troca devia falhar")
	}
	if _, err := os.Stat(dest); err != nil {
		t.Fatalf("eyes.exe devia voltar para o lugar: %v", err)
	}
	lock.Close()

	if err := Swap(context.Background(), tmp, dest, true); err != nil {
		t.Fatal(err)
	}
	if read(t, dest) != "novo" {
		t.Fatal("o novo devia estar no lugar")
	}

	// A troca de uma versao antiga sem rollback: some o eyes.exe e o .old e a imagem em execucao.
	if err := os.Remove(dest); err != nil {
		t.Fatal(err)
	}
	restored, err := Ensure(dest)
	if err != nil || !restored {
		t.Fatalf("devia recolocar eyes.exe a partir da imagem em execucao: %v %v", restored, err)
	}
	a, _ := os.Stat(dest)
	b, _ := os.Stat(self)
	if a.Size() != b.Size() {
		t.Fatal("eyes.exe recolocado devia ser a copia da imagem em execucao")
	}
}
