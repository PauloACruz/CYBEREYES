package speedtest

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

// TestLive mede de verdade contra a Cloudflare: EYES_SPEEDTEST_LIVE=quick (ou full) go test -run TestLive -v.
func TestLive(t *testing.T) {
	mode := os.Getenv("EYES_SPEEDTEST_LIVE")
	if mode == "" {
		t.Skip("defina EYES_SPEEDTEST_LIVE=quick|full para medir de verdade")
	}
	ctx, cancel := context.WithTimeout(context.Background(), testTimeout)
	defer cancel()
	e := NewEngine(Config{Mode: mode, ServerURL: os.Getenv("EYES_SPEEDTEST_SERVER"), Progress: func(phase string, pct int, live float64) {
		t.Logf("%s %3d%% %.1f Mbit/s", phase, pct, live)
	}})
	start := time.Now()
	rep, err := e.Run(ctx)
	out, _ := json.MarshalIndent(rep, "", "  ")
	t.Logf("relatorio em %s:\n%s", time.Since(start).Round(time.Second), out)
	if err != nil {
		t.Fatal(err)
	}
}

// TestCollectNetwork confere a coleta da rede local no sistema de verdade (CI nos tres sistemas).
func TestCollectNetwork(t *testing.T) {
	if os.Getenv("EYES_SPEEDTEST_LIVE") == "" {
		t.Skip("defina EYES_SPEEDTEST_LIVE=quick|full para ler a rede de verdade")
	}
	n, warn := collectNetwork(context.Background())
	out, _ := json.MarshalIndent(n, "", "  ")
	t.Logf("rede:\n%s\navisos: %v", out, warn)
	if n.LocalIP == "" || n.Interface == "" || n.Type == "" {
		t.Errorf("rede incompleta: %+v", n)
	}
	if n.Gateway == "" {
		t.Errorf("gateway nao encontrado: %+v", n)
	}
}
