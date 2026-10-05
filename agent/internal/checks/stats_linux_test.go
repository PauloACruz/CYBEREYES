//go:build linux

package checks

import (
	"context"
	"testing"
)

func TestLinuxStats(t *testing.T) {
	ct, err := parseProcStat("cpu  10 0 10 70 10 0 0 0 5 0\ncpu0 1 2 3 4\n")
	if err != nil || ct.Total != 100 || ct.Idle != 80 {
		t.Errorf("parseProcStat = %+v %v", ct, err)
	}
	if _, err := parseProcStat("intr 1 2 3"); err == nil {
		t.Error("sem linha cpu deveria falhar")
	}
	p, err := memPercentFromInfo(map[string]float64{"MemTotal": 1000, "MemAvailable": 250})
	if err != nil || p != 75 {
		t.Errorf("memoria = %v %v", p, err)
	}
	p, err = memPercentFromInfo(map[string]float64{"MemTotal": 1000, "MemFree": 100, "Buffers": 50, "Cached": 50})
	if err != nil || p != 80 {
		t.Errorf("memoria sem MemAvailable = %v %v", p, err)
	}
	// Leituras reais do sistema.
	if m, err := readMemPercent(); err != nil || m <= 0 || m > 100 {
		t.Errorf("readMemPercent = %v %v", m, err)
	}
	if c, err := newCPUSource().next(context.Background()); err != nil || c < 0 || c > 100 {
		t.Errorf("cpu real = %v %v", c, err)
	}
}
