// Package logs coleta os logs do sistema (Log de Eventos no Windows, journald no Linux e log
// unificado no macOS) e envia ao servidor em lotes (contrato, secao 3.10).
//
// A posicao de leitura de cada fonte fica em um arquivo de estado e so avanca depois que o
// servidor confirma o lote; em falha o mesmo trecho e lido e reenviado no ciclo seguinte.
package logs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

const (
	configInterval  = 10 * time.Minute
	collectInterval = 60 * time.Second

	// Limites do servidor (LogIngest.cs): 1000 entradas e 2 MB por lote. Fica uma folga no tamanho.
	maxBatchEntries = 1000
	maxBatchBytes   = 2*1024*1024 - 64*1024

	maxMessage = 8000
	maxSource  = 200
	maxLogName = 64
	maxHost    = 255

	defaultMaxPerCycle = 500
	// maxScan limita quantos registros cada fonte le por ciclo; o restante fica para o ciclo seguinte.
	maxScan = 50000

	// SourceAgent e o "source" da entrada em que o proprio agente avisa que descartou eventos
	// (AgentContract.LogSourceAgent no servidor). Passa mesmo abaixo do nivel minimo.
	SourceAgent = "wincare-agent"
)

// Niveis aceitos pelo servidor, do menos para o mais grave.
const (
	LevelInfo     = "info"
	LevelWarning  = "warning"
	LevelError    = "error"
	LevelCritical = "critical"
)

// rank devolve a gravidade do nivel (info 0 ... critical 3). Nivel desconhecido conta como info.
func rank(level string) int {
	switch strings.ToLower(level) {
	case LevelCritical:
		return 3
	case LevelError:
		return 2
	case LevelWarning:
		return 1
	}
	return 0
}

// normLevel devolve o nivel em minusculas, trocando valores desconhecidos por info.
func normLevel(level string) string {
	switch l := strings.ToLower(level); l {
	case LevelCritical, LevelError, LevelWarning:
		return l
	}
	return LevelInfo
}

// Config e a resposta de GET /api/v3/{agent_id}/logconfig/.
type Config struct {
	Enabled     bool     `json:"enabled"`
	MinLevel    string   `json:"min_level"`
	WindowsLogs []string `json:"windows_logs"`
	MaxPerCycle int      `json:"max_per_cycle"`
}

func (c Config) maxPerCycle() int {
	if c.MaxPerCycle <= 0 {
		return defaultMaxPerCycle
	}
	return c.MaxPerCycle
}

// Entry e um evento lido de uma fonte.
type Entry struct {
	Time    time.Time
	Level   string
	Source  string
	Log     string
	EventID *int64
	Message string
	Host    string
	// Key e Pos sao a posicao de leitura logo depois deste evento: chave do cursor e valor.
	Key string
	Pos string
}

// Source e uma fonte de logs do sistema.
type Source interface {
	// Read le os eventos novos a partir das posicoes em cur, chamando emit para cada um, em ordem.
	// Uma chave ausente em cur e uma primeira leitura: a fonte devolve a posicao atual sem emitir
	// historico. O mapa devolvido traz as novas posicoes das chaves lidas por completo; um erro
	// parcial (um log que falhou) vem junto com as posicoes das demais chaves.
	Read(ctx context.Context, cfg Config, cur map[string]string, emit func(Entry)) (map[string]string, error)
}

// client e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type client interface {
	Get(ctx context.Context, path string, out any) error
	Post(ctx context.Context, path string, body, out any) error
}

// wireEntry e o formato de cada entrada em POST /api/v3/logs/.
type wireEntry struct {
	Time    string  `json:"time"`
	Level   string  `json:"level"`
	Source  string  `json:"source"`
	Log     string  `json:"log"`
	EventID *int64  `json:"event_id"`
	Message string  `json:"message"`
	Host    *string `json:"host"`
}

// Register inicia a coleta de logs em segundo plano.
func Register(e *env.Env) error {
	src := newSource(e.Log.With("modulo", "logs"))
	if src == nil {
		return nil
	}
	c := newCollector(e.API, src, e.Cfg.AgentID, filepath.Join(config.StateDir(), "logs.json"), e.Log.With("modulo", "logs"))
	e.Go("logs", c.run)
	return nil
}

type collector struct {
	api     client
	src     Source
	agentID string
	path    string
	log     *slog.Logger
	host    string
	now     func() time.Time

	cfg       Config
	cfgKnown  bool
	cursors   map[string]string
	loaded    bool
	lastError string
}

func newCollector(c client, src Source, agentID, statePath string, log *slog.Logger) *collector {
	host, _ := os.Hostname()
	return &collector{api: c, src: src, agentID: agentID, path: statePath, log: log, host: host, now: time.Now}
}

// run busca a configuracao na partida e a cada 10 minutos e coleta a cada 60 segundos.
func (c *collector) run(ctx context.Context) {
	var lastCfg time.Time
	for {
		if lastCfg.IsZero() || c.now().Sub(lastCfg) >= configInterval {
			if err := c.refreshConfig(ctx); err != nil {
				c.warn("falha ao ler a configuracao de logs", err)
			} else {
				lastCfg = c.now()
			}
		}
		if c.cfgKnown && c.cfg.Enabled {
			if err := c.cycle(ctx); err != nil {
				c.warn("falha na coleta de logs", err)
			} else {
				c.lastError = ""
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(collectInterval):
		}
	}
}

// warn registra o erro uma vez enquanto ele se repetir.
func (c *collector) warn(msg string, err error) {
	if s := msg + ": " + err.Error(); s != c.lastError {
		c.lastError = s
		c.log.Warn(msg, "erro", err)
	}
}

// refreshConfig le a configuracao. Ao religar a coleta, as posicoes antigas sao descartadas para
// recomecar do momento atual em vez de enviar todo o periodo em que ela ficou desligada.
func (c *collector) refreshConfig(ctx context.Context) error {
	var cfg Config
	if err := c.api.Get(ctx, "/api/v3/"+c.agentID+"/logconfig/", &cfg); err != nil {
		return err
	}
	if cfg.Enabled && c.cfgKnown && !c.cfg.Enabled {
		c.loadState()
		if len(c.cursors) > 0 {
			c.cursors = map[string]string{}
			if err := c.saveState(); err != nil {
				c.log.Warn("falha ao gravar a posicao dos logs", "erro", err)
			}
		}
	}
	c.cfg, c.cfgKnown = cfg, true
	return nil
}

// cycle le os eventos novos, envia em lotes e avanca a posicao a cada lote confirmado.
func (c *collector) cycle(ctx context.Context) error {
	c.loadState()
	cfg := c.cfg
	minRank := rank(cfg.MinLevel)
	limit := cfg.maxPerCycle()

	var kept []Entry
	dropped := 0
	cur := make(map[string]string, len(c.cursors))
	for k, v := range c.cursors {
		cur[k] = v
	}
	next, readErr := c.src.Read(ctx, cfg, cur, func(e Entry) {
		if rank(e.Level) < minRank {
			return
		}
		if len(kept) < limit {
			kept = append(kept, e)
		} else {
			dropped++
		}
	})
	if readErr != nil && ctx.Err() != nil {
		return readErr
	}

	wire := make([]wireEntry, 0, len(kept)+1)
	for _, e := range kept {
		wire = append(wire, c.toWire(e))
	}
	if dropped > 0 {
		wire = append(wire, wireEntry{
			Time:    c.now().UTC().Format(time.RFC3339Nano),
			Level:   LevelWarning,
			Source:  SourceAgent,
			Message: fmt.Sprintf("%d eventos descartados pelo limite", dropped),
			Host:    c.hostPtr(""),
		})
	}

	batches := split(wire)
	pos := 0
	for i, b := range batches {
		err := c.api.Post(ctx, "/api/v3/logs/", map[string]any{"entries": b}, nil)
		if err != nil && !permanent(err) {
			// Mantem a posicao: o mesmo trecho e lido e reenviado no proximo ciclo.
			return errors.Join(err, readErr)
		}
		if err != nil {
			// Lote recusado pelo servidor (400): reenviar nao adianta e travaria a coleta.
			c.log.Error("lote de logs recusado pelo servidor; descartado", "entradas", len(b), "erro", err)
		}
		for _, e := range kept[pos:min(pos+len(b), len(kept))] {
			if e.Key != "" {
				c.cursors[e.Key] = e.Pos
			}
		}
		pos += len(b)
		if i == len(batches)-1 {
			merge(c.cursors, next)
		}
		if err := c.saveState(); err != nil {
			c.log.Warn("falha ao gravar a posicao dos logs", "erro", err)
		}
	}
	if len(batches) == 0 && merge(c.cursors, next) {
		if err := c.saveState(); err != nil {
			c.log.Warn("falha ao gravar a posicao dos logs", "erro", err)
		}
	}
	return readErr
}

// permanent informa se o servidor recusou o lote por conteudo (400), caso em que nao ha repeticao.
func permanent(err error) bool {
	return api.IsStatus(err, http.StatusBadRequest) || api.IsStatus(err, http.StatusRequestEntityTooLarge)
}

// merge copia src em dst e informa se algo mudou.
func merge(dst, src map[string]string) bool {
	changed := false
	for k, v := range src {
		if dst[k] != v {
			dst[k] = v
			changed = true
		}
	}
	return changed
}

func (c *collector) toWire(e Entry) wireEntry {
	t := e.Time
	if t.IsZero() {
		t = c.now()
	}
	return wireEntry{
		Time:    t.UTC().Format(time.RFC3339Nano),
		Level:   normLevel(e.Level),
		Source:  truncate(e.Source, maxSource),
		Log:     truncate(e.Log, maxLogName),
		EventID: e.EventID,
		Message: truncate(e.Message, maxMessage),
		Host:    c.hostPtr(e.Host),
	}
}

func (c *collector) hostPtr(h string) *string {
	if h == "" {
		h = c.host
	}
	if h == "" {
		return nil
	}
	h = truncate(h, maxHost)
	return &h
}

// split divide as entradas em lotes de ate 1000 itens e menos de 2 MB de JSON.
func split(entries []wireEntry) [][]wireEntry {
	var out [][]wireEntry
	var cur []wireEntry
	size := 0
	for _, e := range entries {
		data, _ := json.Marshal(e)
		n := len(data) + 1
		if len(cur) > 0 && (len(cur) >= maxBatchEntries || size+n > maxBatchBytes) {
			out = append(out, cur)
			cur, size = nil, 0
		}
		cur = append(cur, e)
		size += n
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// truncate corta s em max caracteres (runas), troca UTF-8 invalido e remove o caractere nulo,
// que o servidor tambem remove.
func truncate(s string, max int) string {
	s = strings.ToValidUTF8(s, "�")
	if strings.IndexByte(s, 0) >= 0 {
		s = strings.ReplaceAll(s, "\x00", "")
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	n := 0
	for i := range s {
		if n == max {
			return s[:i]
		}
		n++
	}
	return s
}

// estado persistido em <StateDir>/logs.json.
type state struct {
	Cursors map[string]string `json:"cursors"`
}

func (c *collector) loadState() {
	if c.loaded {
		return
	}
	c.loaded = true
	c.cursors = map[string]string{}
	data, err := os.ReadFile(c.path)
	if err != nil {
		return
	}
	var st state
	if json.Unmarshal(data, &st) == nil && st.Cursors != nil {
		c.cursors = st.Cursors
	}
}

// saveState grava as posicoes de forma atomica.
func (c *collector) saveState() error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(state{Cursors: c.cursors})
	if err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}
