// Package care e o Cybereyes Care no EYES: catalogo de modulos, execucao dos scripts de
// manutencao (wincare_run/wincare_cancel, eventos em <agent_id>.cmdoutput.<run_id>) e o
// Health Check (wincare_health). Os nomes "wincare_*" e o prefixo "wc-" sao contrato do servidor.
package care

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Nomes dos comandos (Api/Rmm/AgentContract.cs).
const (
	FuncCatalog = "wincare_catalog"
	FuncRun     = "wincare_run"
	FuncCancel  = "wincare_cancel"
	FuncHealth  = "wincare_health"
)

var runIDPattern = regexp.MustCompile(`^wc-[0-9a-f]{32}$`)

// Service guarda o catalogo e a execucao em andamento (uma por vez).
type Service struct {
	pub      publisher
	log      *slog.Logger
	base     context.Context
	platform string
	scripts  fs.FS
	full     *Catalog
	catalog  *Catalog
	catJSON  string
	workDir  func() string
	limit    func(module string) time.Duration
	now      func() time.Time

	mu  sync.Mutex
	cur *run
}

// newService monta o servico para a plataforma com os scripts informados.
func newService(ctx context.Context, pub publisher, log *slog.Logger, platform string, scripts fs.FS) (*Service, error) {
	data, err := fs.ReadFile(scripts, "scripts/catalog.json")
	if err != nil {
		return nil, fmt.Errorf("catalogo do Care ausente: %w", err)
	}
	full, err := parseCatalog(data)
	if err != nil {
		return nil, err
	}
	filtered := full.Filter(platform, scripts)
	js, err := filtered.JSON()
	if err != nil {
		return nil, err
	}
	return &Service{
		pub: pub, log: log, base: ctx, platform: platform, scripts: scripts,
		full: full, catalog: filtered, catJSON: js,
		workDir: defaultWorkDir, limit: RunLimit, now: time.Now,
	}, nil
}

// RunLimit e o tempo limite por modulo: 4 h para windows_update, 2 h para os demais.
func RunLimit(module string) time.Duration {
	if module == "windows_update" {
		return 4 * time.Hour
	}
	return 2 * time.Hour
}

// defaultWorkDir e a pasta das execucoes (estado recriavel, acessivel so a SYSTEM/root).
func defaultWorkDir() string {
	dir := filepath.Join(config.StateDir(), "care")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return filepath.Join(os.TempDir(), "eyes-care")
	}
	return dir
}

// Register registra wincare_catalog, wincare_run, wincare_cancel e wincare_health.
func Register(e *env.Env) error {
	s, err := newService(e.Ctx, e.Pub, e.Log, runtime.GOOS, embedded)
	if err != nil {
		return err
	}
	e.Reg.HandleTimeout(FuncCatalog, 20*time.Second, func(context.Context, rpc.Request) any { return s.catJSON })
	e.Reg.HandleTimeout(FuncRun, 30*time.Second, func(_ context.Context, req rpc.Request) any {
		return s.Start(field(req, "run_id"), field(req, "module"), field(req, "tasks"), field(req, "params"))
	})
	e.Reg.HandleTimeout(FuncCancel, 30*time.Second, func(_ context.Context, req rpc.Request) any { return s.Cancel(field(req, "run_id")) })
	e.Reg.HandleTimeout(FuncHealth, 6*time.Minute, func(ctx context.Context, _ rpc.Request) any {
		rep := CollectHealth(ctx)
		b, err := json.Marshal(rep)
		if err != nil {
			return "error: falha ao montar o relatorio de saude"
		}
		return string(b)
	})
	return nil
}

// field le um campo do payload (mapa de str), com o nivel de cima como alternativa.
func field(req rpc.Request, key string) string {
	if v := req.Payload().Str(key); v != "" {
		return v
	}
	return req.Str(key)
}

// Start valida o pedido, responde "started" e executa o modulo em segundo plano.
func (s *Service) Start(runID, module, tasksCSV, params string) string {
	if !runIDPattern.MatchString(runID) {
		return "error: run_id invalido"
	}
	m := s.catalog.Module(module)
	if m == nil {
		if s.full.Module(module) != nil {
			return "error: modulo nao suportado neste sistema: " + module
		}
		return "error: modulo desconhecido: " + module
	}
	var tasks []string
	seen := map[string]bool{}
	for _, k := range strings.Split(tasksCSV, ",") {
		k = strings.TrimSpace(k)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		if m.Task(k) == nil {
			if fm := s.full.Module(module); fm != nil && fm.Task(k) != nil {
				return "error: tarefa nao suportada neste sistema: " + k
			}
			return "error: tarefa desconhecida: " + k
		}
		tasks = append(tasks, k)
	}
	if len(tasks) == 0 {
		return "error: nenhuma tarefa informada"
	}
	params = strings.TrimSpace(params)
	if params == "" || params == "null" {
		params = "{}"
	}
	var values map[string]any
	if err := json.Unmarshal([]byte(params), &values); err != nil || values == nil {
		return "error: params invalido (esperado objeto JSON)"
	}
	for _, k := range tasks {
		for _, p := range m.Task(k).Params {
			if p.Required && emptyParam(values[p.Name]) {
				return fmt.Sprintf("error: parametro obrigatorio ausente: %s (tarefa %s)", p.Name, k)
			}
		}
	}

	s.mu.Lock()
	if s.cur != nil {
		s.mu.Unlock()
		return "error: busy"
	}
	limit := s.limit(module)
	ctx, cancel := context.WithTimeout(s.base, limit)
	ru := &run{id: runID, module: m, tasks: tasks, params: json.RawMessage(params), limit: limit,
		ctx: ctx, cancel: cancel, stopped: make(chan struct{})}
	s.cur = ru
	s.mu.Unlock()

	s.log.Info("Care: execucao iniciada", "run_id", runID, "modulo", module, "tarefas", strings.Join(tasks, ","))
	go s.execute(ru)
	return "started"
}

func emptyParam(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(x) == ""
	}
	return false
}

// Cancel encerra a execucao em andamento; o evento done "cancelled" sai em seguida.
func (s *Service) Cancel(runID string) string {
	s.mu.Lock()
	ru := s.cur
	s.mu.Unlock()
	if ru == nil || ru.id != runID {
		return "error: not running"
	}
	s.log.Info("Care: execucao cancelada", "run_id", runID)
	ru.markCancelled()
	return "ok"
}

// Running devolve o run_id em andamento ("" quando parado).
func (s *Service) Running() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cur == nil {
		return ""
	}
	return s.cur.id
}
