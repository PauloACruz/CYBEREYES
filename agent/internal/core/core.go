// Package core tem os comandos basicos do EYES: ping, recuperacao e sincronizacao do MeshAgent
// e autoatualizacao do binario.
package core

import (
	"context"
	"math/rand/v2"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/mesh"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Register registra os comandos e inicia a sincronizacao periodica do MeshAgent.
func Register(e *env.Env) error {
	e.Reg.HandleTimeout("ping", 10*time.Second, func(context.Context, rpc.Request) any { return "pong" })
	e.Reg.HandleTimeout("recover", 10*time.Minute, func(ctx context.Context, req rpc.Request) any {
		mode := req.Payload().Str("mode")
		if mode == "" {
			mode = req.Str("mode")
		}
		if mode != "mesh" {
			return "error: modo de recuperacao desconhecido: " + mode
		}
		// Responde logo; a reinstalacao continua em segundo plano.
		e.Go("recover-mesh", func(context.Context) { recoverMesh(e) })
		return "ok"
	})
	e.Reg.HandleTimeout("agentupdate", 15*time.Minute, func(ctx context.Context, req rpc.Request) any {
		return update(ctx, e, req)
	})
	e.Go("syncmesh", func(ctx context.Context) { syncMeshLoop(ctx, e) })
	e.Go("updatecheck", func(ctx context.Context) { updateCheckLoop(ctx, e) })
	return nil
}

func recoverMesh(e *env.Env) {
	ctx, cancel := context.WithTimeout(e.Ctx, 10*time.Minute)
	defer cancel()
	if e.Cfg.NoMesh {
		e.Log.Info("recuperacao do MeshAgent ignorada: instalacao sem MeshAgent")
		return
	}
	file, err := mesh.Download(ctx, e.API, "GET", "/api/v3/"+e.Cfg.AgentID+"/meshreinstall/", nil)
	if err != nil {
		e.Log.Error("recuperacao do MeshAgent: download", "erro", err)
		return
	}
	_ = mesh.Uninstall(ctx)
	if err := mesh.Install(ctx, file); err != nil {
		e.Log.Error("recuperacao do MeshAgent: instalacao", "erro", err)
		return
	}
	for i := 0; i < 20; i++ {
		if node, err := mesh.NodeID(ctx); err == nil {
			_ = e.API.Post(ctx, "/api/v3/syncmesh/", map[string]string{"nodeid": node}, nil)
			e.Log.Info("MeshAgent recuperado", "node", node)
			return
		}
		time.Sleep(3 * time.Second)
	}
	e.Log.Warn("MeshAgent reinstalado, mas o node id ainda nao esta disponivel")
}

// syncMeshLoop informa o node id do MeshAgent na partida e a cada 15 a 20 minutos. Se o MeshAgent
// estiver ausente (falha na instalacao ou removido), o EYES o instala de novo, no maximo a cada 30 minutos.
func syncMeshLoop(ctx context.Context, e *env.Env) {
	last := ""
	delay := 30 * time.Second
	var lastInstall time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = time.Duration(900+rand.IntN(300)) * time.Second
		if mesh.Binary() == "" {
			if !e.Cfg.NoMesh && e.Service && time.Since(lastInstall) > 30*time.Minute {
				lastInstall = time.Now()
				e.Log.Info("MeshAgent ausente: instalando")
				recoverMesh(e)
			}
			continue
		}
		node, err := mesh.NodeID(ctx)
		if err != nil || node == last {
			continue
		}
		if err := e.API.Post(ctx, "/api/v3/syncmesh/", map[string]string{"nodeid": node}, nil); err != nil {
			e.Log.Warn("falha ao sincronizar o MeshAgent", "erro", err)
			continue
		}
		last = node
	}
}
