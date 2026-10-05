package checks

import (
	"context"
	"errors"
	"sync"
	"time"
)

// errNoSample indica que ainda nao ha leitura anterior para calcular o uso de CPU.
var errNoSample = errors.New("sem amostra anterior de CPU")

// cpuTimes sao os contadores acumulados de CPU (unidade indiferente, so a razao importa).
type cpuTimes struct {
	Idle  float64
	Total float64
}

// cpuPercent calcula o uso entre duas leituras: 100 * (1 - ocioso/total).
func cpuPercent(prev, cur cpuTimes) (float64, error) {
	total := cur.Total - prev.Total
	idle := cur.Idle - prev.Idle
	if total <= 0 || idle < 0 {
		return 0, errNoSample
	}
	return clampPercent(100 * (1 - idle/total)), nil
}

func clampPercent(p float64) float64 {
	switch {
	case p != p: // NaN
		return 0
	case p < 0:
		return 0
	case p > 100:
		return 100
	}
	return p
}

// cpuSource produz amostras de uso de CPU; cada plataforma tem a sua.
type cpuSource interface {
	// next devolve o uso desde a chamada anterior (ou mede uma janela curta na primeira).
	next(ctx context.Context) (float64, error)
}

// timesSource usa os contadores acumulados do sistema (Linux e Windows).
type timesSource struct {
	read func() (cpuTimes, error)
	prev cpuTimes
	has  bool
}

func (t *timesSource) next(ctx context.Context) (float64, error) {
	cur, err := t.read()
	if err != nil {
		return 0, err
	}
	if !t.has {
		// Primeira leitura: mede uma janela curta.
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(time.Second):
		}
		t.prev, t.has = cur, true
		if cur, err = t.read(); err != nil {
			return 0, err
		}
	}
	p, err := cpuPercent(t.prev, cur)
	t.prev = cur
	return p, err
}

// Sampler mantem as amostras recentes de CPU e memoria em segundo plano, para que os checks
// cpuload e memory respondam sem bloquear.
type Sampler struct {
	every time.Duration

	srcMu sync.Mutex
	src   cpuSource
	mem   func() (float64, error)

	mu    sync.Mutex
	cpu   float64
	cpuAt time.Time
	memV  float64
	memAt time.Time
}

// NewSampler cria o amostrador com o periodo indicado.
func NewSampler(every time.Duration) *Sampler {
	if every <= 0 {
		every = sampleEvery
	}
	return &Sampler{every: every, src: newCPUSource(), mem: readMemPercent}
}

// Run amostra CPU e memoria periodicamente ate ctx ser cancelado.
func (s *Sampler) Run(ctx context.Context) {
	t := time.NewTicker(s.every)
	defer t.Stop()
	for {
		s.sampleCPU(ctx)
		s.sampleMem()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Sampler) sampleCPU(ctx context.Context) (float64, error) {
	s.srcMu.Lock()
	defer s.srcMu.Unlock()
	p, err := s.src.next(ctx)
	if err != nil {
		return 0, err
	}
	s.mu.Lock()
	s.cpu, s.cpuAt = p, time.Now()
	s.mu.Unlock()
	return p, nil
}

func (s *Sampler) sampleMem() (float64, error) {
	p, err := s.mem()
	if err != nil {
		return 0, err
	}
	p = clampPercent(p)
	s.mu.Lock()
	s.memV, s.memAt = p, time.Now()
	s.mu.Unlock()
	return p, nil
}

// fresh informa se a amostra ainda vale (ate tres periodos do amostrador).
func (s *Sampler) fresh(at time.Time) bool {
	return !at.IsZero() && time.Since(at) <= 3*s.every
}

// CPU devolve a amostra recente de uso de CPU; sem amostra recente, mede na hora.
func (s *Sampler) CPU(ctx context.Context) (float64, error) {
	s.mu.Lock()
	p, at := s.cpu, s.cpuAt
	s.mu.Unlock()
	if s.fresh(at) {
		return p, nil
	}
	return s.sampleCPU(ctx)
}

// Memory devolve o uso de memoria atual (leitura barata); em falha usa a ultima amostra recente.
func (s *Sampler) Memory() (float64, error) {
	p, err := s.sampleMem()
	if err == nil {
		return p, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fresh(s.memAt) {
		return s.memV, nil
	}
	return 0, err
}
