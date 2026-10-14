//go:build windows

package uninstall

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"
)

// TestWindowsUninstallAndCleanup instala um programa de mentira (entrada de desinstalacao, pasta, dados,
// chave do fabricante, inicializacao automatica, servico e tarefa), roda a desinstalacao avancada de verdade
// e apaga as sobras. Mexe na maquina: so roda com EYES_WINDOWS_UNINSTALL=1 (CI do Windows, como administrador).
func TestWindowsUninstallAndCleanup(t *testing.T) {
	if os.Getenv("EYES_WINDOWS_UNINSTALL") != "1" {
		t.Skip("defina EYES_WINDOWS_UNINSTALL=1 (mexe no registro, em Program Files, servicos e tarefas)")
	}
	const (
		name      = "Contoso Teste Desinstalacao"
		publisher = "Contoso Teste"
		runValue  = "ContosoTesteAgenda"
		svcName   = "ContosoTesteSvc"
		taskName  = "ContosoTesteTarefa"
	)
	dir := filepath.Join(os.Getenv("ProgramFiles"), name)
	data := filepath.Join(os.Getenv("ProgramData"), name)
	exe := filepath.Join(dir, "app.exe")
	entry := `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\ContosoTesteDesinstalacao`
	vendor := `SOFTWARE\` + publisher
	run := `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`

	// Desfaz tudo mesmo se o teste falhar no meio.
	t.Cleanup(func() {
		if m, err := mgr.Connect(); err == nil {
			if s, err := m.OpenService(svcName); err == nil {
				_ = s.Delete()
				s.Close()
			}
			_ = m.Disconnect()
		}
		_ = exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F").Run()
		_ = registry.DeleteKey(registry.LOCAL_MACHINE, entry)
		_ = registry.DeleteKey(registry.LOCAL_MACHINE, vendor+`\`+name)
		_ = registry.DeleteKey(registry.LOCAL_MACHINE, vendor)
		if k, err := registry.OpenKey(registry.LOCAL_MACHINE, run, registry.SET_VALUE|registry.WOW64_64KEY); err == nil {
			_ = k.DeleteValue(runValue)
			k.Close()
		}
		_ = os.RemoveAll(dir)
		_ = os.RemoveAll(data)
	})

	for _, d := range []string{dir, data} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for p, content := range map[string]string{exe: "app", filepath.Join(dir, "config.ini"): "[app]", filepath.Join(data, "dados.txt"): "dados"} {
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	setValues(t, entry, map[string]string{
		"DisplayName": name, "DisplayVersion": "1.0", "Publisher": publisher, "InstallLocation": dir,
		"UninstallString": `"` + exe + `" /uninstall`,
		// O ping fica rodando depois que o cmd termina: o agente tem que esperar o job esvaziar.
		"QuietUninstallString": `cmd.exe /c start "" /b ping -n 4 127.0.0.1 & del /q "` + exe + `" & reg delete "HKLM\` + entry + `" /f /reg:64`,
	})
	setValues(t, vendor+`\`+name, map[string]string{"Versao": "1.0"})
	setValues(t, run, map[string]string{runValue: `"` + exe + `" --bandeja`})
	m, err := mgr.Connect()
	if err != nil {
		t.Fatal(err)
	}
	s, err := m.CreateService(svcName, exe, mgr.Config{StartType: mgr.StartManual, DisplayName: "Contoso Teste"})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	_ = m.Disconnect()
	if out, err := exec.Command("schtasks.exe", "/Create", "/TN", taskName, "/TR", `"`+exe+`" --tarefa`, "/SC", "ONLOGON", "/RU", "SYSTEM", "/F").CombinedOutput(); err != nil {
		t.Fatalf("schtasks: %v %s", err, out)
	}

	reg, rec := newTestWorker(t, &winSystem{})
	start := time.Now()
	out := dispatch(t, reg, map[string]any{"func": "softwareuninstall", "pending_action_pk": 7, "name": name, "version": "1.0",
		"publisher": publisher, "location": dir, "key": `HKLM\` + entry, "mode": "moderate", "run_uninstaller": true, "restore_point": false})
	elapsed := time.Since(start)
	if out != "ok" || len(rec.body) != 1 {
		t.Fatalf("resposta = %v, chamadas = %v", out, rec.paths)
	}
	body := rec.body[0]
	t.Logf("desinstalacao em %s:\n%s", elapsed.Round(time.Millisecond), body["results"])
	if body["ok"] != true || body["ran_uninstaller"] != true || body["scanned"] != true || body["still_installed"] != nil {
		t.Fatalf("resultado = %v", body)
	}
	if elapsed < 2*time.Second {
		t.Errorf("nao esperou o processo aberto pelo desinstalador (%s)", elapsed)
	}
	if _, err := os.Stat(exe); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("o desinstalador nao apagou %s: %v", exe, err)
	}

	raw, _ := json.Marshal(body["leftovers"])
	var left []Leftover
	if err := json.Unmarshal(raw, &left); err != nil {
		t.Fatal(err)
	}
	for _, l := range left {
		t.Logf("sobra: %-7s %-6s %s %s", l.Kind, l.Level, l.Path, l.Name)
		if !strings.Contains(strings.ToLower(l.Path+" "+l.Name+" "+l.Detail), "contoso") {
			t.Errorf("sobra que nao e do programa: %+v", l)
		}
	}
	want := []struct {
		label string
		ok    func(Leftover) bool
	}{
		{"pasta do programa", func(l Leftover) bool { return l.Kind == KindDir && strings.EqualFold(l.Path, dir) }},
		{"dados em ProgramData", func(l Leftover) bool { return l.Kind == KindDir && strings.EqualFold(l.Path, data) }},
		{"chave do fabricante", func(l Leftover) bool {
			return l.Kind == KindKey && strings.HasPrefix(strings.ToLower(l.Path), strings.ToLower(`HKLM\`+vendor))
		}},
		{"inicializacao automatica", func(l Leftover) bool { return l.Kind == KindValue && l.Name == runValue }},
		{"servico", func(l Leftover) bool { return l.Kind == KindService && strings.EqualFold(l.Path, svcName) }},
		{"tarefa", func(l Leftover) bool { return l.Kind == KindTask && strings.EqualFold(l.Path, `\`+taskName) }},
	}
	var items []map[string]any
	for _, w := range want {
		found := false
		for _, l := range left {
			if w.ok(l) {
				items = append(items, map[string]any{"kind": l.Kind, "path": l.Path, "name": l.Name})
				found = true
				break
			}
		}
		if !found {
			t.Errorf("a varredura nao achou: %s", w.label)
		}
	}
	if t.Failed() {
		return
	}

	out = dispatch(t, reg, map[string]any{"func": "softwarecleanup", "pending_action_pk": 8, "name": name, "items": items})
	if out != "ok" || len(rec.body) != 2 {
		t.Fatalf("resposta = %v, chamadas = %v", out, rec.paths)
	}
	body = rec.body[1]
	t.Logf("limpeza:\n%s", body["results"])
	backup, _ := body["backup"].(string)
	if backup != "" {
		t.Cleanup(func() { _ = os.RemoveAll(backup) })
	}
	if body["ok"] != true || body["removed"] != float64(len(items)) || body["failed"] != nil {
		t.Fatalf("resultado = %v", body)
	}
	files, err := os.ReadDir(backup)
	if err != nil {
		t.Fatalf("copia de seguranca %q: %v", backup, err)
	}
	var names []string
	for _, f := range files {
		names = append(names, f.Name())
	}
	t.Logf("copia de seguranca em %s: %v", backup, names)
	// Chave do fabricante, chave Run e chave do servico em .reg; a tarefa em .xml.
	if len(files) < 4 {
		t.Errorf("copia de seguranca incompleta: %v", names)
	}

	for _, p := range []string{dir, data} {
		if _, err := os.Stat(p); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s continua no disco: %v", p, err)
		}
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, vendor, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		k.Close()
		t.Errorf("a chave HKLM\\%s continua", vendor)
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, run, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		if _, _, err := k.GetStringValue(runValue); err == nil {
			t.Errorf("o valor %s continua em Run", runValue)
		}
		k.Close()
	}
	if m, err := mgr.Connect(); err == nil {
		if s, err := m.OpenService(svcName); err == nil {
			s.Close()
			t.Errorf("o servico %s continua", svcName)
		}
		_ = m.Disconnect()
	}
	if err := exec.Command("schtasks.exe", "/Query", "/TN", taskName).Run(); err == nil {
		t.Errorf("a tarefa %s continua", taskName)
	}
}

func setValues(t *testing.T, key string, values map[string]string) {
	t.Helper()
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, key, registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		t.Fatalf("criar HKLM\\%s: %v", key, err)
	}
	defer k.Close()
	for n, v := range values {
		if err := k.SetStringValue(n, v); err != nil {
			t.Fatal(err)
		}
	}
}
