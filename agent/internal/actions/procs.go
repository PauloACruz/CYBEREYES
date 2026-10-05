package actions

import (
	"context"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Proc e um item da resposta do procs. cpu_percent e str: o servidor le com GetString.
type Proc struct {
	PID        int    `json:"pid"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	MemBytes   int64  `json:"membytes"`
	CPUPercent string `json:"cpu_percent"`
}

const (
	// cpuSample e a janela de medicao do uso de CPU.
	cpuSample = time.Second
	// maxProcs limita a resposta (o NATS aceita ate 64 MiB; folga ampla).
	maxProcs = 10000
)

// procTimes e uma leitura do tempo de CPU acumulado de cada processo.
type procTimes map[int]time.Duration

// cpuPercent calcula o uso no intervalo como fracao da maquina inteira (0 a 100, como o
// Gerenciador de Tarefas): tempo de CPU gasto / (tempo decorrido x numero de CPUs).
func cpuPercent(used, elapsed time.Duration, ncpu int) float64 {
	if elapsed <= 0 || used <= 0 {
		return 0
	}
	if ncpu < 1 {
		ncpu = 1
	}
	p := used.Seconds() / (elapsed.Seconds() * float64(ncpu)) * 100
	if math.IsNaN(p) || math.IsInf(p, 0) || p < 0 {
		return 0
	}
	if p > 100 {
		p = 100
	}
	return p
}

// formatCPU formata o percentual com uma casa ("1.5").
func formatCPU(p float64) string {
	if math.IsNaN(p) || math.IsInf(p, 0) || p < 0 {
		p = 0
	}
	return strconv.FormatFloat(p, 'f', 1, 64)
}

// sampleCPU mede o uso de CPU entre duas leituras de tempos separadas por cpuSample.
// Processos que surgiram no meio contam a partir de zero so se ja existiam na segunda leitura.
func sampleCPU(ctx context.Context, read func() (procTimes, error)) (first, second procTimes, elapsed time.Duration, err error) {
	first, err = read()
	if err != nil {
		return nil, nil, 0, err
	}
	start := time.Now()
	select {
	case <-ctx.Done():
	case <-time.After(cpuSample):
	}
	second, err = read()
	if err != nil {
		return nil, nil, 0, err
	}
	return first, second, time.Since(start), nil
}

// usage devolve o percentual do processo pid entre as duas leituras.
func usage(pid int, first, second procTimes, elapsed time.Duration) string {
	a, ok1 := first[pid]
	b, ok2 := second[pid]
	if !ok1 || !ok2 || b < a {
		return formatCPU(0)
	}
	return formatCPU(cpuPercent(b-a, elapsed, runtime.NumCPU()))
}

// procs: lista de { pid, name, username, membytes, cpu_percent }.
func (h *handlers) procs(ctx context.Context, _ rpc.Request) any {
	list, err := guard(ctx, shortTimeout, func() procList {
		l, err := listProcs(ctx)
		return procList{l, err}
	})
	if err == nil {
		err = list.err
	}
	if err != nil {
		return errText(fmt.Errorf("falha ao listar processos: %w", err))
	}
	out := list.items
	sort.Slice(out, func(i, j int) bool { return out[i].PID < out[j].PID })
	if len(out) > maxProcs {
		out = out[:maxProcs]
	}
	if out == nil {
		out = []Proc{}
	}
	return out
}

type procList struct {
	items []Proc
	err   error
}

// killproc: { procpid } -> "ok" ou a mensagem de erro.
func (h *handlers) killproc(ctx context.Context, req rpc.Request) any {
	pid := req.Int("procpid")
	if pid <= 0 {
		return "PID invalido"
	}
	if pid == os.Getpid() {
		return "nao e possivel encerrar o proprio agente"
	}
	err, gerr := guard(ctx, shortTimeout, func() error { return killProcess(pid) })
	if gerr != nil {
		return "falha ao encerrar o processo: " + gerr.Error()
	}
	if err != nil {
		return err.Error()
	}
	return "ok"
}
