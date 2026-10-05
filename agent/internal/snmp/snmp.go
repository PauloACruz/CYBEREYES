// Package snmp e o papel de coletor SNMP do EYES (contrato, secao 3.11): consulta os
// dispositivos do site por SNMP v2c/v3, recebe traps v1/v2c e envia tudo ao servidor por REST.
// Tambem atende o comando NATS snmp_test (secao 4.3).
package snmp

import (
	"context"
	"encoding/json"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

const (
	configInterval = 5 * time.Minute
	tickInterval   = time.Second
	flushInterval  = 5 * time.Second

	// Limites do servidor: ate 1000 itens por lote. O tamanho fica bem abaixo dos 30 MB do Nginx.
	maxBatchItems = 1000
	maxBatchBytes = 8 * 1024 * 1024

	// Itens retidos enquanto o servidor estiver fora; os mais antigos saem primeiro.
	maxPendingResults = 5000
	maxPendingTraps   = 10000

	// maxConcurrent limita as coletas simultaneas.
	maxConcurrent = 16
)

// Config e a resposta de GET /api/v3/{agent_id}/snmp/.
type Config struct {
	Enabled  bool     `json:"enabled"`
	TrapPort int      `json:"trap_port"`
	Devices  []Target `json:"devices"`
}

// client e o subconjunto do cliente REST usado aqui (*api.Client o satisfaz).
type client interface {
	Get(ctx context.Context, path string, out any) error
	Post(ctx context.Context, path string, body, out any) error
}

// Register registra o snmp_test e inicia o coletor em segundo plano.
func Register(e *env.Env) error {
	c := newCollector(e.API, e.Cfg.AgentID, e.Log.With("modulo", "snmp"))
	e.Reg.HandleTimeout("snmp_test", 2*time.Minute, c.handleTest)
	e.Go("snmp", c.run)
	return nil
}

type device struct {
	t       Target
	next    time.Time
	running bool
}

type collector struct {
	api     client
	agentID string
	log     *slog.Logger
	dial    func(context.Context, Target) (session, error)
	now     func() time.Time
	// trapAddr sobrescreve o endereco do receptor de traps (testes).
	trapAddr string

	mu       sync.Mutex
	enabled  bool
	devices  map[int]*device
	results  []Result
	traps    []Trap
	trap     *trapServer
	sem      chan struct{}
	lastLogs map[string]string
	wg       sync.WaitGroup
	// flushing evita dois envios simultaneos (fora de ordem, o servidor ignora o resultado mais antigo).
	flushing sync.Mutex
}

func newCollector(c client, agentID string, log *slog.Logger) *collector {
	return &collector{
		api: c, agentID: agentID, log: log, dial: dial, now: time.Now,
		devices: map[int]*device{}, sem: make(chan struct{}, maxConcurrent), lastLogs: map[string]string{},
	}
}

// warnOnce registra a mensagem uma vez enquanto ela se repetir na mesma chave.
func (c *collector) warnOnce(key, msg string, err error) {
	c.mu.Lock()
	text := msg
	if err != nil {
		text += ": " + err.Error()
	}
	repeated := c.lastLogs[key] == text
	c.lastLogs[key] = text
	c.mu.Unlock()
	if !repeated {
		c.log.Warn(msg, "erro", err)
	}
}

func (c *collector) clearLog(key string) {
	c.mu.Lock()
	delete(c.lastLogs, key)
	c.mu.Unlock()
}

// run le a configuracao a cada 5 minutos, agenda as coletas e envia resultados e traps.
func (c *collector) run(ctx context.Context) {
	defer func() {
		c.mu.Lock()
		ts := c.trap
		c.trap = nil
		c.mu.Unlock()
		ts.stop()
	}()
	c.refresh(ctx)
	cfgTick := time.NewTicker(configInterval)
	defer cfgTick.Stop()
	tick := time.NewTicker(tickInterval)
	defer tick.Stop()
	flushTick := time.NewTicker(flushInterval)
	defer flushTick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-cfgTick.C:
			c.refresh(ctx)
		case <-tick.C:
			c.schedule(ctx)
		case <-flushTick.C:
			// Envio em rotina propria para nao atrasar o agendamento.
			go c.flush(ctx)
		}
	}
}

// refresh busca a configuracao; em falha mantem a anterior.
func (c *collector) refresh(ctx context.Context) {
	var cfg Config
	if err := c.api.Get(ctx, "/api/v3/"+c.agentID+"/snmp/", &cfg); err != nil {
		c.warnOnce("config", "falha ao ler a configuracao SNMP", err)
		return
	}
	c.clearLog("config")
	c.apply(cfg)
}

// apply atualiza a lista de dispositivos e liga, troca ou desliga o receptor de traps.
func (c *collector) apply(cfg Config) {
	now := c.now()
	var invalid []error
	var invalidHosts []string
	c.mu.Lock()
	c.enabled = cfg.Enabled
	seen := map[int]bool{}
	if cfg.Enabled {
		for _, t := range cfg.Devices {
			if err := t.normalize(); err != nil {
				invalid = append(invalid, err)
				invalidHosts = append(invalidHosts, t.Host)
				continue
			}
			seen[t.ID] = true
			if d, ok := c.devices[t.ID]; ok {
				if t.Interval != d.t.Interval {
					d.next = now.Add(time.Duration(rand.IntN(t.Interval)) * time.Second)
				}
				d.t = t
				continue
			}
			// Primeira coleta logo, espalhada nos primeiros segundos para nao disparar tudo junto.
			c.devices[t.ID] = &device{t: t, next: now.Add(time.Duration(rand.IntN(min(t.Interval, 30))) * time.Second)}
		}
	}
	for id := range c.devices {
		if !seen[id] {
			delete(c.devices, id)
		}
	}
	cur := c.trap
	c.mu.Unlock()
	for i, err := range invalid {
		c.warnOnce("device:"+invalidHosts[i], "dispositivo SNMP ignorado", err)
	}

	port := cfg.TrapPort
	want := cfg.Enabled && port > 0 && port <= 65535
	if want && cur.alive() && cur.port == port {
		return
	}
	if cur != nil {
		cur.stop()
		c.setTrap(nil)
	}
	if !want {
		c.clearLog("trap")
		return
	}
	var ts *trapServer
	var err error
	if c.trapAddr != "" {
		ts, err = startTrapServerAddr(c.trapAddr, port, c.addTrap)
	} else {
		ts, err = startTrapServer(port, c.addTrap)
	}
	if err != nil {
		// Porta em uso ou sem privilegio: registra uma vez e tenta de novo na proxima configuracao.
		c.warnOnce("trap", "receptor de traps SNMP indisponivel na porta UDP "+strconv.Itoa(port), err)
		return
	}
	c.clearLog("trap")
	c.log.Info("receptor de traps SNMP ativo", "porta", port)
	c.setTrap(ts)
}

func (c *collector) setTrap(ts *trapServer) {
	c.mu.Lock()
	c.trap = ts
	c.mu.Unlock()
}

// schedule inicia as coletas vencidas.
func (c *collector) schedule(ctx context.Context) {
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		return
	}
	for _, d := range c.devices {
		if d.running || now.Before(d.next) {
			continue
		}
		select {
		case c.sem <- struct{}{}:
		default:
			return
		}
		d.running = true
		d.next = now.Add(time.Duration(d.t.Interval) * time.Second)
		t := d.t
		c.wg.Add(1)
		go func() {
			defer c.wg.Done()
			defer func() { <-c.sem }()
			defer func() {
				if p := recover(); p != nil {
					c.log.Error("falha na coleta SNMP", "host", t.Host, "panic", p)
				}
				c.mu.Lock()
				d.running = false
				c.mu.Unlock()
			}()
			c.addResult(c.pollOnce(ctx, t))
		}()
	}
}

// pollOnce coleta o alvo, limitado ao intervalo dele para nunca acumular coletas.
func (c *collector) pollOnce(ctx context.Context, t Target) Result {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(t.Interval)*time.Second)
	defer cancel()
	return pollTarget(ctx, c.dial, t, c.now())
}

func (c *collector) addResult(r Result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.results = append(c.results, r)
	if over := len(c.results) - maxPendingResults; over > 0 {
		c.results = append([]Result(nil), c.results[over:]...)
	}
}

func (c *collector) addTrap(t Trap) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.traps = append(c.traps, t)
	if over := len(c.traps) - maxPendingTraps; over > 0 {
		c.traps = append([]Trap(nil), c.traps[over:]...)
	}
}

// flush envia resultados e traps pendentes. O que falhar volta para a fila.
func (c *collector) flush(ctx context.Context) {
	if !c.flushing.TryLock() {
		return
	}
	defer c.flushing.Unlock()
	c.mu.Lock()
	results, traps := c.results, c.traps
	c.results, c.traps = nil, nil
	c.mu.Unlock()

	if rest := sendBatches(ctx, c, "/api/v3/snmp/results/", "results", results); len(rest) > 0 {
		c.mu.Lock()
		c.results = append(rest, c.results...)
		if over := len(c.results) - maxPendingResults; over > 0 {
			c.results = c.results[over:]
		}
		c.mu.Unlock()
	}
	if rest := sendBatches(ctx, c, "/api/v3/snmp/traps/", "traps", traps); len(rest) > 0 {
		c.mu.Lock()
		c.traps = append(rest, c.traps...)
		if over := len(c.traps) - maxPendingTraps; over > 0 {
			c.traps = c.traps[over:]
		}
		c.mu.Unlock()
	}
}

// sendBatches envia items em lotes e devolve o que nao foi entregue.
func sendBatches[T any](ctx context.Context, c *collector, path, key string, items []T) []T {
	for len(items) > 0 {
		n := batchLen(items)
		err := c.api.Post(ctx, path, map[string]any{key: items[:n]}, nil)
		if err != nil && !permanent(err) {
			c.warnOnce("post:"+key, "falha ao enviar "+key+" SNMP; reenvio no proximo ciclo", err)
			return items
		}
		if err != nil {
			c.log.Error("lote SNMP recusado pelo servidor; descartado", "tipo", key, "itens", n, "erro", err)
		} else {
			c.clearLog("post:" + key)
		}
		items = items[n:]
	}
	return nil
}

// batchLen escolhe quantos itens do inicio cabem num lote (1000 itens e maxBatchBytes).
func batchLen[T any](items []T) int {
	size := 0
	for i, it := range items {
		if i >= maxBatchItems {
			return i
		}
		data, _ := json.Marshal(it)
		size += len(data) + 1
		if i > 0 && size > maxBatchBytes {
			return i
		}
	}
	return len(items)
}

// permanent informa se o servidor recusou o lote por conteudo (400), caso em que nao ha repeticao.
func permanent(err error) bool {
	return api.IsStatus(err, http.StatusBadRequest) || api.IsStatus(err, http.StatusRequestEntityTooLarge)
}

// handleTest atende o snmp_test: le o grupo system do alvo e responde uma string JSON.
func (c *collector) handleTest(ctx context.Context, req rpc.Request) any {
	t, err := ParseTarget(req.Payload().Str("target"))
	if err != nil {
		return "error: alvo SNMP invalido: " + err.Error()
	}
	return testTarget(ctx, c.dial, t)
}

// testTarget faz o teste de conexao e devolve a resposta ja em JSON.
func testTarget(ctx context.Context, dialer func(context.Context, Target) (session, error), t Target) string {
	limit := time.Duration(t.Timeout*(t.Retries+1)+5) * time.Second
	ctx, cancel := context.WithTimeout(ctx, min(limit, 115*time.Second))
	defer cancel()
	reply := TestReply{}
	s, err := dialer(ctx, t)
	if err == nil {
		defer s.Close()
		var sys *System
		var rtt time.Duration
		sys, rtt, err = pollSystem(s)
		if err == nil {
			reply.Reachable, reply.RTTMs, reply.System = true, millis(rtt), sys
		}
	}
	if err != nil {
		msg := errorText(err)
		reply.Error = &msg
	}
	data, _ := json.Marshal(reply)
	return string(data)
}
