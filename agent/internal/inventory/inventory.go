// Package inventory envia ao servidor o estado da maquina: check-ins periodicos pelo NATS
// (agent-hello, agent-agentinfo, agent-disks, agent-winsvc, agent-publicip, agent-wmi),
// a configuracao de intervalos (GET config), o POST checkin, o inventario de software e o
// estado do Chocolatey. Tambem trata os comandos "sysinfo" e "softwarelist".
package inventory

import (
	"context"
	"errors"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Tempos fixos dos lacos REST.
const (
	configEvery     = time.Hour
	configRetry     = 5 * time.Minute
	checkinEvery    = 6 * time.Hour // cada POST checkin no Windows dispara getwinupdates (bug 15 do servidor)
	checkinRetry    = 10 * time.Minute
	softwareFirst   = 2 * time.Minute
	softwareRetry   = 15 * time.Minute
	notConnectedTry = 10 * time.Second
)

// Nomes dos check-ins (campo reply da mensagem NATS).
const (
	kindHello     = "agent-hello"
	kindAgentInfo = "agent-agentinfo"
	kindDisks     = "agent-disks"
	kindWinSvc    = "agent-winsvc"
	kindPublicIP  = "agent-publicip"
	kindWMI       = "agent-wmi"
)

// job e um check-in periodico pelo NATS.
type job struct {
	kind    string
	trigger chan struct{}
	every   func() time.Duration
	timeout time.Duration
	retry   time.Duration
	build   func(ctx context.Context) (any, error)
}

type module struct {
	e    *env.Env
	mu   sync.RWMutex
	cfg  intervals
	jobs map[string]*job
	ip   *http.Client
	sw   softwareCache
}

// Register registra "sysinfo" e "softwarelist", define e.Refresh e inicia os lacos periodicos.
func Register(e *env.Env) error {
	if e == nil || e.Cfg == nil || e.Reg == nil || e.Pub == nil {
		return errors.New("inventario: ambiente incompleto")
	}
	m := &module{e: e, cfg: defaultIntervals(), jobs: map[string]*job{}}
	m.ip = newIPClient(e)
	m.sw.sem = make(chan struct{}, 1)

	m.addJob(kindHello, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.Hello }) }, 20*time.Second, 15*time.Second, m.buildHello)
	m.addJob(kindAgentInfo, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.AgentInfo }) }, 45*time.Second, time.Minute, m.buildAgentInfo)
	m.addJob(kindDisks, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.Disks }) }, 45*time.Second, 2*time.Minute, m.buildDisks)
	m.addJob(kindPublicIP, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.PublicIP }) }, 40*time.Second, 2*time.Minute, m.buildPublicIP)
	m.addJob(kindWMI, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.WMI }) }, 3*time.Minute, 10*time.Minute, m.buildWMI)
	if runtime.GOOS == "windows" {
		m.addJob(kindWinSvc, func() time.Duration { return m.interval(func(c intervals) time.Duration { return c.WinSvc }) }, time.Minute, 5*time.Minute, m.buildWinSvc)
	}

	e.Reg.HandleTimeout("sysinfo", 15*time.Second, func(context.Context, rpc.Request) any {
		m.refresh()
		return "ok"
	})
	e.Reg.HandleTimeout("softwarelist", 58*time.Second, func(ctx context.Context, _ rpc.Request) any {
		return m.softwareList(ctx)
	})
	e.Refresh = m.refresh

	for _, j := range m.jobs {
		j := j
		e.Go("inventario-"+j.kind, func(ctx context.Context) { m.natsLoop(ctx, j) })
	}
	e.Go("inventario-conexao", m.watchConnection)
	e.Go("inventario-config", m.configLoop)
	e.Go("inventario-checkin", m.checkinLoop)
	e.Go("inventario-software", m.softwareLoop)
	return nil
}

func (m *module) addJob(kind string, every func() time.Duration, timeout, retry time.Duration, build func(context.Context) (any, error)) {
	m.jobs[kind] = &job{kind: kind, trigger: make(chan struct{}, 1), every: every, timeout: timeout, retry: retry, build: build}
}

func (m *module) interval(get func(intervals) time.Duration) time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return get(m.cfg)
}

// fire pede a execucao imediata dos check-ins indicados (sem bloquear; pedidos repetidos se juntam).
func (m *module) fire(kinds ...string) {
	for _, k := range kinds {
		if j, ok := m.jobs[k]; ok {
			select {
			case j.trigger <- struct{}{}:
			default:
			}
		}
	}
}

// refresh reenvia agora sistema, discos, WMI, IP publico e servicos (comando sysinfo e e.Refresh).
func (m *module) refresh() {
	m.fire(kindAgentInfo, kindDisks, kindWMI, kindPublicIP, kindWinSvc)
}

// natsLoop executa um check-in no intervalo do servidor ou quando disparado.
func (m *module) natsLoop(ctx context.Context, j *job) {
	timer := time.NewTimer(j.every())
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-j.trigger:
		}
		next := j.every()
		if !m.e.Pub.Connected() {
			// O vigia da conexao dispara de novo assim que o NATS conectar.
			next = notConnectedTry
		} else if err := m.runJob(ctx, j); err != nil {
			if ctx.Err() != nil {
				return
			}
			m.e.Log.Warn("falha no check-in", "tipo", j.kind, "erro", err)
			if j.retry < next {
				next = j.retry
			}
		}
		timer.Reset(next)
	}
}

func (m *module) runJob(ctx context.Context, j *job) error {
	ctx, cancel := context.WithTimeout(ctx, j.timeout)
	defer cancel()
	body, err := j.build(ctx)
	if err != nil {
		return err
	}
	if err := m.e.Pub.Checkin(j.kind, body); err != nil {
		return err
	}
	m.e.Log.Debug("check-in enviado", "tipo", j.kind)
	return nil
}

// watchConnection dispara os check-ins quando o NATS conecta: todos na primeira conexao
// (o agente aparece online em segundos) e hello e agentinfo a cada reconexao.
func (m *module) watchConnection(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	was, first := false, true
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		now := m.e.Pub.Connected()
		if now && !was {
			if first {
				m.fire(kindHello, kindAgentInfo, kindDisks, kindPublicIP, kindWMI, kindWinSvc)
				first = false
			} else {
				m.fire(kindHello, kindAgentInfo)
			}
		}
		was = now
	}
}

// waitConnected espera o NATS conectar (os comandos que o servidor publica em resposta ao REST
// so chegam com a assinatura ativa).
func (m *module) waitConnected(ctx context.Context) bool {
	for !m.e.Pub.Connected() {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(2 * time.Second):
		}
	}
	return true
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// configLoop busca os intervalos na partida e a cada hora.
func (m *module) configLoop(ctx context.Context) {
	for {
		next := configEvery
		if err := m.fetchConfig(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			m.e.Log.Warn("falha ao buscar a configuracao do agente; usando os intervalos atuais", "erro", err)
			next = configRetry
		}
		if !sleepCtx(ctx, next) {
			return
		}
	}
}

func (m *module) fetchConfig(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var raw serverConfig
	if err := m.e.API.Get(ctx, "/api/v3/"+m.e.Cfg.AgentID+"/config/", &raw); err != nil {
		return err
	}
	iv := raw.intervals()
	m.mu.Lock()
	m.cfg = iv
	m.mu.Unlock()
	m.e.Log.Debug("configuracao do agente atualizada", "hello", iv.Hello, "agentinfo", iv.AgentInfo, "wmi", iv.WMI)
	return nil
}

// checkinLoop envia o estado do Chocolatey (Windows) e o POST checkin na partida e a cada 6 horas.
func (m *module) checkinLoop(ctx context.Context) {
	if !sleepCtx(ctx, 5*time.Second) {
		return
	}
	for {
		if !m.waitConnected(ctx) {
			return
		}
		next := checkinEvery
		if chocoSupported {
			if err := m.postChoco(ctx); err != nil && ctx.Err() == nil {
				m.e.Log.Warn("falha ao informar o Chocolatey", "erro", err)
			}
		}
		if err := m.postCheckin(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			m.e.Log.Warn("falha no checkin REST", "erro", err)
			next = checkinRetry
		}
		if !sleepCtx(ctx, next) {
			return
		}
	}
}

func (m *module) postCheckin(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return m.e.API.Post(ctx, "/api/v3/checkin/", map[string]string{"agent_id": m.e.Cfg.AgentID}, nil)
}

func (m *module) postChoco(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return m.e.API.Post(ctx, "/api/v3/choco/", map[string]bool{"installed": chocoInstalled()}, nil)
}

// softwareLoop envia o inventario de software alguns minutos apos a partida e depois no intervalo checkin_sw.
func (m *module) softwareLoop(ctx context.Context) {
	next := softwareFirst
	for {
		if !sleepCtx(ctx, next) {
			return
		}
		next = m.interval(func(c intervals) time.Duration { return c.Software })
		if err := m.postSoftware(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			m.e.Log.Warn("falha ao enviar o inventario de software", "erro", err)
			if softwareRetry < next {
				next = softwareRetry
			}
		}
	}
}

func (m *module) postSoftware(ctx context.Context) error {
	cctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	list, err := m.software(cctx)
	cancel()
	if err != nil {
		return err
	}
	pctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := m.e.API.Post(pctx, "/api/v3/software/", map[string]any{"software": list}, nil); err != nil {
		return err
	}
	m.e.Log.Debug("inventario de software enviado", "itens", len(list))
	return nil
}

// softwareList responde ao comando softwarelist (o servidor espera 60 s e grava a lista recebida).
func (m *module) softwareList(ctx context.Context) any {
	ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()
	list, err := m.software(ctx)
	if err != nil {
		return "error: " + err.Error()
	}
	return list
}
