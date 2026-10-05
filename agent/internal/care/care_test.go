package care

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestCatalogFilterByPlatform(t *testing.T) {
	data, err := os.ReadFile("scripts/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	full, err := parseCatalog(data)
	if err != nil {
		t.Fatal(err)
	}
	if full.Version != "3.0.0" {
		t.Fatalf("versao do catalogo = %q", full.Version)
	}
	disk := os.DirFS(".")
	want := map[string][]string{
		"linux":   {"maintenance", "component_test"},
		"darwin":  {"maintenance", "component_test"},
		"windows": {"maintenance", "windows_update", "bug_fixer", "office", "registry", "app_remover", "component_test", "winget"},
	}
	for plat, mods := range want {
		c := full.Filter(plat, disk)
		var got []string
		for _, m := range c.Modules {
			got = append(got, m.Key)
			for _, tk := range m.Tasks {
				if !slices.Contains(tk.Platforms, plat) {
					t.Errorf("%s: tarefa %s.%s nao e da plataforma", plat, m.Key, tk.Key)
				}
			}
		}
		if !slices.Equal(got, mods) {
			t.Errorf("%s: modulos %v, esperado %v", plat, got, mods)
		}
		js, err := c.JSON()
		if err != nil {
			t.Fatal(err)
		}
		// O JSON tem a estrutura do contrato 7.1, com tipos estritos.
		var raw struct {
			Version string `json:"version"`
			Modules []struct {
				Key   string `json:"key"`
				Tasks []struct {
					Key         string            `json:"key"`
					Label       string            `json:"label"`
					Description string            `json:"description"`
					SelfService *bool             `json:"selfService"`
					Default     *bool             `json:"default"`
					Platforms   []string          `json:"platforms"`
					Params      []json.RawMessage `json:"params"`
				} `json:"tasks"`
			} `json:"modules"`
		}
		if err := json.Unmarshal([]byte(js), &raw); err != nil {
			t.Fatalf("%s: JSON invalido: %v", plat, err)
		}
		for _, m := range raw.Modules {
			if strings.Contains(m.Key, ".") {
				t.Errorf("chave de modulo com ponto: %s", m.Key)
			}
			for _, tk := range m.Tasks {
				if tk.SelfService == nil || tk.Default == nil || tk.Params == nil || tk.Label == "" {
					t.Errorf("%s: tarefa %s.%s incompleta", plat, m.Key, tk.Key)
				}
			}
		}
		if plat == "linux" && strings.Contains(js, `"key":"sfc"`) {
			t.Error("tarefa so do Windows no catalogo do Linux")
		}
	}
}

// Cada tarefa do catalogo existe no script da plataforma.
func TestCatalogMatchesScripts(t *testing.T) {
	data, _ := os.ReadFile("scripts/catalog.json")
	full, err := parseCatalog(data)
	if err != nil {
		t.Fatal(err)
	}
	disk := os.DirFS(".")
	for _, plat := range []string{"linux", "darwin", "windows"} {
		for _, m := range full.Filter(plat, disk).Modules {
			src, err := os.ReadFile(scriptPath(plat, m.Key))
			if err != nil {
				t.Fatal(err)
			}
			for _, tk := range m.Tasks {
				pat := `(?m)^task_` + tk.Key + `\(\)`
				if plat == "windows" {
					pat = `(?m)^\s*'` + tk.Key + `'\s*=\s*\{`
				}
				if !regexp.MustCompile(pat).Match(src) {
					t.Errorf("%s: tarefa %s.%s ausente em %s", plat, m.Key, tk.Key, scriptPath(plat, m.Key))
				}
			}
		}
	}
	if b, _ := os.ReadFile("scripts/windows/_runtime.ps1"); !strings.Contains(string(b), "Version      = '3.0.0'") {
		t.Error("versao do harness PowerShell diferente de 3.0.0")
	}
}

type nopPub struct{}

func (nopPub) Publish(string, any) error { return nil }

func TestEmbeddedCatalog(t *testing.T) {
	s, err := newService(t.Context(), nopPub{}, slog.New(slog.NewTextHandler(io.Discard, nil)), runtime.GOOS, embedded)
	if err != nil {
		t.Fatal(err)
	}
	if s.catalog.Module("maintenance") == nil || (runtime.GOOS != "windows") != (s.catalog.Module("winget") == nil) {
		t.Fatalf("catalogo embutido filtrado incorretamente: %s", s.catJSON)
	}
}
