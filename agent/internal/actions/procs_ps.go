//go:build !linux && !windows

package actions

import (
	"context"
	"os/exec"
	"time"
)

// listProcs usa o ps (macOS e outros Unix sem /proc): duas leituras do tempo de CPU acumulado
// separadas por cpuSample, sem cgo.
func listProcs(ctx context.Context) ([]Proc, error) {
	var last []psRow
	read := func() (procTimes, error) {
		rows, err := runPS(ctx)
		if err != nil {
			return nil, err
		}
		last = rows
		t := procTimes{}
		for _, r := range rows {
			t[r.pid] = r.cpu
		}
		return t, nil
	}
	first, second, elapsed, err := sampleCPU(ctx, read)
	if err != nil {
		return nil, err
	}
	out := make([]Proc, 0, len(last))
	for _, r := range last {
		out = append(out, Proc{
			PID:        r.pid,
			Name:       r.name,
			Username:   r.user,
			MemBytes:   r.rssKiB * 1024,
			CPUPercent: usage(r.pid, first, second, elapsed),
		})
	}
	return out, nil
}

func runPS(ctx context.Context) ([]psRow, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// comm por ultimo: pode conter espacos.
	out, err := exec.CommandContext(ctx, "ps", "-axww", "-o", "pid=,rss=,time=,user=,comm=").Output()
	if err != nil {
		return nil, err
	}
	return parsePS(string(out)), nil
}
