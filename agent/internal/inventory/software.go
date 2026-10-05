package inventory

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

// maxSoftware limita a lista (a resposta do softwarelist passa pelo NATS e pelo console).
const maxSoftware = 5000

// Software e um item do inventario (POST software e resposta do softwarelist). O console so le texto.
type Software struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Publisher   string `json:"publisher"`
	InstallDate string `json:"install_date"`
	Size        string `json:"size"`
	Source      string `json:"source"`
	Location    string `json:"location"`
	Uninstall   string `json:"uninstall"`
}

// softwareCache guarda a ultima lista coletada; sem permite uma coleta por vez.
type softwareCache struct {
	sem  chan struct{}
	mu   sync.Mutex
	list []Software
	at   time.Time
}

func (c *softwareCache) get() []Software {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.list
}

func (c *softwareCache) set(list []Software) {
	c.mu.Lock()
	c.list = list
	c.at = time.Now()
	c.mu.Unlock()
}

// software coleta o inventario. Se outra coleta estiver em andamento e o tempo acabar,
// ou se a coleta falhar, devolve a ultima lista conhecida.
func (m *module) software(ctx context.Context) ([]Software, error) {
	select {
	case m.sw.sem <- struct{}{}:
	case <-ctx.Done():
		if cached := m.sw.get(); cached != nil {
			return cached, nil
		}
		return nil, errors.New("coleta de software em andamento; tente de novo em instantes")
	}
	defer func() { <-m.sw.sem }()
	list, err := collectSoftware(ctx)
	if len(list) == 0 {
		if cached := m.sw.get(); cached != nil {
			return cached, nil
		}
		if err == nil {
			err = errors.New("nenhum software encontrado")
		}
		return nil, err
	}
	if err != nil {
		m.e.Log.Debug("inventario de software parcial", "erro", err)
	}
	list = normalizeSoftware(list)
	m.sw.set(list)
	return list, nil
}

// normalizeSoftware apara os textos, descarta itens sem nome, remove repetidos (nome e versao),
// ordena por nome e limita a maxSoftware itens. Nunca devolve nil.
func normalizeSoftware(in []Software) []Software {
	out := make([]Software, 0, len(in))
	seen := map[string]bool{}
	for _, s := range in {
		s.Name = cleanText(s.Name)
		if s.Name == "" {
			continue
		}
		s.Version = cleanText(s.Version)
		s.Publisher = cleanText(s.Publisher)
		s.InstallDate = cleanText(s.InstallDate)
		s.Size = cleanText(s.Size)
		s.Source = cleanText(s.Source)
		s.Location = cleanText(s.Location)
		s.Uninstall = cleanText(s.Uninstall)
		key := strings.ToLower(s.Name) + "\x00" + strings.ToLower(s.Version)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Version < out[j].Version
	})
	if len(out) > maxSoftware {
		out = out[:maxSoftware]
	}
	return out
}

// cleanText apara espacos e NUL e garante UTF-8 valido.
func cleanText(s string) string {
	s = strings.ToValidUTF8(s, "")
	s = strings.ReplaceAll(s, "\x00", "")
	return strings.TrimSpace(s)
}

// joinErrs junta os erros de cada fonte de software.
func joinErrs(errs []error) error { return errors.Join(errs...) }
