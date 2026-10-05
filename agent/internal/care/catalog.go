package care

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"slices"
	"strings"
)

// Catalog e o catalogo de modulos do Cybereyes Care (scripts/catalog.json).
type Catalog struct {
	Version string    `json:"version"`
	Modules []*Module `json:"modules"`
}

// Module e um modulo (um script por sistema) com as tarefas que ele sabe executar.
type Module struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Platforms   []string `json:"platforms"`
	Tasks       []*Task  `json:"tasks"`
}

// Task e uma tarefa do modulo. O JSON original e devolvido sem alteracao ao console.
type Task struct {
	Key         string
	Platforms   []string
	Reboot      bool
	SelfService bool
	Params      []Param
	raw         json.RawMessage
}

// Param e um parametro de tarefa (so os campos usados na validacao).
type Param struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type taskView struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Group       string   `json:"group"`
	Description string   `json:"description"`
	Default     bool     `json:"default"`
	Platforms   []string `json:"platforms"`
	SelfService bool     `json:"selfService"`
	Reboot      bool     `json:"reboot"`
	Dangerous   bool     `json:"dangerous"`
	Params      []Param  `json:"params"`
}

// UnmarshalJSON guarda o JSON cru e confere os tipos que o servidor le com cast estrito.
func (t *Task) UnmarshalJSON(b []byte) error {
	var v taskView
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	t.Key, t.Platforms, t.Reboot, t.SelfService, t.Params = v.Key, v.Platforms, v.Reboot, v.SelfService, v.Params
	t.raw = append(json.RawMessage(nil), b...)
	return nil
}

// MarshalJSON devolve o JSON original da tarefa.
func (t *Task) MarshalJSON() ([]byte, error) {
	if len(t.raw) == 0 {
		return nil, fmt.Errorf("tarefa %s sem JSON", t.Key)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, t.raw); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// parseCatalog le e valida o catalogo.
func parseCatalog(data []byte) (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("catalogo invalido: %w", err)
	}
	seen := map[string]bool{}
	for _, m := range c.Modules {
		if m.Key == "" || strings.ContainsAny(m.Key, ".,/\\ ") || seen[m.Key] {
			return nil, fmt.Errorf("catalogo invalido: chave de modulo %q", m.Key)
		}
		seen[m.Key] = true
		tasks := map[string]bool{}
		for _, t := range m.Tasks {
			if !validKey(t.Key) || tasks[t.Key] {
				return nil, fmt.Errorf("catalogo invalido: chave de tarefa %q no modulo %s", t.Key, m.Key)
			}
			tasks[t.Key] = true
		}
	}
	return &c, nil
}

// validKey aceita as chaves de tarefa que os harnesses executam (minusculas, digitos e _).
func validKey(k string) bool {
	if k == "" || len(k) > 64 {
		return false
	}
	for _, r := range k {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return false
		}
	}
	return true
}

// Filter devolve uma copia com os modulos e tarefas da plataforma (windows, linux ou darwin).
// Modulos sem script para a plataforma ou sem tarefas aplicaveis ficam de fora.
func (c *Catalog) Filter(platform string, scripts fs.FS) *Catalog {
	out := &Catalog{Version: c.Version, Modules: []*Module{}}
	for _, m := range c.Modules {
		if !slices.Contains(m.Platforms, platform) {
			continue
		}
		if scripts != nil {
			if _, err := fs.Stat(scripts, scriptPath(platform, m.Key)); err != nil {
				continue
			}
		}
		fm := *m
		fm.Tasks = []*Task{}
		for _, t := range m.Tasks {
			if slices.Contains(t.Platforms, platform) {
				fm.Tasks = append(fm.Tasks, t)
			}
		}
		if len(fm.Tasks) > 0 {
			out.Modules = append(out.Modules, &fm)
		}
	}
	return out
}

// Module procura um modulo pela chave.
func (c *Catalog) Module(key string) *Module {
	for _, m := range c.Modules {
		if m.Key == key {
			return m
		}
	}
	return nil
}

// Task procura uma tarefa pela chave.
func (m *Module) Task(key string) *Task {
	for _, t := range m.Tasks {
		if t.Key == key {
			return t
		}
	}
	return nil
}

// JSON serializa o catalogo (resposta de wincare_catalog).
func (c *Catalog) JSON() (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(c); err != nil {
		return "", err
	}
	return strings.TrimSpace(buf.String()), nil
}

// scriptPath e o caminho do script do modulo dentro do FS embutido.
func scriptPath(platform, module string) string {
	if platform == "windows" {
		return "scripts/windows/" + module + ".ps1"
	}
	return "scripts/unix/" + module + ".sh"
}

// runtimePath e o caminho do harness comum da plataforma.
func runtimePath(platform string) string {
	if platform == "windows" {
		return "scripts/windows/_runtime.ps1"
	}
	return "scripts/unix/_runtime.sh"
}
