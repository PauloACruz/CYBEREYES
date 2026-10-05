package core

import (
	"context"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// updateCheckLoop consulta GET /api/v3/<id>/update/ alguns minutos apos a partida e a cada 6 horas.
// Garante a atualizacao mesmo quando o NATS nao funciona (o "agentupdate" chega pelo NATS).
func updateCheckLoop(ctx context.Context, e *env.Env) {
	delay := time.Duration(120+rand.IntN(120)) * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = time.Duration(6*3600+rand.IntN(1800)) * time.Second
		var info struct {
			Version    string `json:"version"`
			SHA256     string `json:"sha256"`
			AutoUpdate bool   `json:"auto_update"`
		}
		if err := e.API.Get(ctx, "/api/v3/"+e.Cfg.AgentID+"/update/", &info); err != nil {
			e.Log.Debug("verificacao de atualizacao", "erro", err)
			continue
		}
		if !info.AutoUpdate || info.SHA256 == "" || !newer(info.Version, version.Version) {
			continue
		}
		e.Log.Info("versao nova disponivel no servidor", "atual", version.Version, "nova", info.Version)
		uctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		reply := update(uctx, e, rpc.Request{"payload": map[string]any{"version": info.Version, "sha256": info.SHA256}})
		cancel()
		if s, ok := reply.(string); ok && s != "ok" {
			e.Log.Warn("atualizacao automatica falhou", "resposta", s)
		}
	}
}

// newer informa se a versao a (X.Y.Z) e maior que b.
func newer(a, b string) bool {
	pa, pb := parseVersion(a), parseVersion(b)
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parseVersion(v string) [3]int {
	var out [3]int
	for i, part := range strings.SplitN(strings.TrimPrefix(strings.TrimSpace(v), "v"), ".", 3) {
		n, _ := strconv.Atoi(strings.SplitN(part, "-", 2)[0])
		out[i] = n
	}
	return out
}
