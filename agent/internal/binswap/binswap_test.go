package binswap

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ler %s: %v", filepath.Base(path), err)
	}
	return string(b)
}

// fast deixa as novas tentativas sem espera e restaura tudo no fim do teste.
func fast(t *testing.T, fn func(from, to string) error) {
	t.Helper()
	oldRename, oldTries, oldDelay := rename, tries, delay
	rename, tries, delay = fn, 3, time.Millisecond
	t.Cleanup(func() { rename, tries, delay = oldRename, oldTries, oldDelay })
}

func TestSwapKeepsOld(t *testing.T) {
	fast(t, os.Rename)
	dir := t.TempDir()
	dest, tmp := filepath.Join(dir, "eyes.exe"), filepath.Join(dir, "eyes.exe.update")
	write(t, dest, "antigo")
	write(t, tmp, "novo")
	if err := Swap(context.Background(), tmp, dest, true); err != nil {
		t.Fatal(err)
	}
	if read(t, dest) != "novo" || read(t, dest+".old") != "antigo" {
		t.Fatal("troca errada")
	}
}

func TestSwapRestoresOldWhenNewStaysLocked(t *testing.T) {
	dir := t.TempDir()
	dest, tmp := filepath.Join(dir, "eyes.exe"), filepath.Join(dir, "eyes.exe.update")
	// O antivirus segura o executavel novo: todo rename dele falha.
	fast(t, func(from, to string) error {
		if from == tmp {
			return errors.New("arquivo em uso por outro processo")
		}
		return os.Rename(from, to)
	})
	write(t, dest, "antigo")
	write(t, tmp, "novo")
	if err := Swap(context.Background(), tmp, dest, true); err == nil {
		t.Fatal("esperava erro")
	}
	if read(t, dest) != "antigo" {
		t.Fatal("o executavel antigo devia voltar para o lugar")
	}
}

func TestSwapRetriesWhileLocked(t *testing.T) {
	dir := t.TempDir()
	dest, tmp := filepath.Join(dir, "eyes.exe"), filepath.Join(dir, "eyes.exe.update")
	failures := 2
	fast(t, func(from, to string) error {
		if from == tmp && failures > 0 {
			failures--
			return errors.New("arquivo em uso por outro processo")
		}
		return os.Rename(from, to)
	})
	write(t, dest, "antigo")
	write(t, tmp, "novo")
	if err := Swap(context.Background(), tmp, dest, true); err != nil {
		t.Fatal(err)
	}
	if read(t, dest) != "novo" {
		t.Fatal("devia trocar depois que o arquivo foi liberado")
	}
}

func TestSwapWithoutDest(t *testing.T) {
	// Maquina que ficou sem eyes.exe numa troca que falhou antes: o novo so entra no lugar.
	fast(t, os.Rename)
	dir := t.TempDir()
	dest, tmp := filepath.Join(dir, "eyes.exe"), filepath.Join(dir, "eyes.exe.update")
	write(t, dest+".old", "antigo em execucao")
	write(t, tmp, "novo")
	if err := Swap(context.Background(), tmp, dest, true); err != nil {
		t.Fatal(err)
	}
	if read(t, dest) != "novo" || read(t, dest+".old") != "antigo em execucao" {
		t.Fatal("troca errada sem eyes.exe")
	}
}

func TestEnsure(t *testing.T) {
	fast(t, os.Rename)
	dir := t.TempDir()
	dest := filepath.Join(dir, "eyes.exe")
	if restored, err := Ensure(dest); err != nil || restored {
		t.Fatalf("sem eyes.exe.old, nada a fazer: %v %v", restored, err)
	}
	write(t, dest+".old", "em execucao")

	restored, err := Ensure(dest)
	if err != nil || !restored || read(t, dest) != "em execucao" || read(t, dest+".old") != "em execucao" {
		t.Fatalf("devia recolocar eyes.exe a partir do .old: %v %v", restored, err)
	}
	if restored, err := Ensure(dest); err != nil || restored {
		t.Fatalf("com eyes.exe no lugar, nada a fazer: %v %v", restored, err)
	}
}
