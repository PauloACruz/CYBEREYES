// Package env reune as dependencias compartilhadas pelos modulos do EYES
// (configuracao, cliente REST, publicacao no NATS, registro de comandos e log).
package env

import (
	"context"
	"log/slog"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/config"
	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// Publisher publica mensagens no NATS.
type Publisher interface {
	// Checkin publica no assunto <agent_id> com o tipo no campo reply.
	Checkin(kind string, body any) error
	// Publish publica em <agent_id>.<sufixo>.
	Publish(suffix string, body any) error
	// Connected informa se a conexao esta ativa.
	Connected() bool
}

// Env e passado a cada modulo na partida.
type Env struct {
	Cfg *config.Config
	API *api.Client
	Pub Publisher
	Reg *rpc.Registry
	Log *slog.Logger
	// Ctx e cancelado quando o agente para; lacos em segundo plano devem respeita-lo.
	Ctx context.Context
	// Service indica execucao como servico do sistema (eyes service); falso em "eyes run".
	Service bool
	// Refresh pede o reenvio imediato do inventario (sistema, discos, WMI, IP publico).
	Refresh func()
}

// Go executa fn em segundo plano, recuperando panicos para nao derrubar o servico.
func (e *Env) Go(name string, fn func(ctx context.Context)) {
	go func() {
		defer func() {
			if p := recover(); p != nil {
				e.Log.Error("falha em rotina de segundo plano", "rotina", name, "panic", p)
			}
		}()
		fn(e.Ctx)
	}()
}
