package remote

import (
	"context"
	"errors"

	"github.com/pauloacruz/cybereyes/agent/internal/env"
)

// errDenied indica que o usuario recusou o acesso, ou que nao havia como perguntar.
var errDenied = errors.New("acesso recusado pelo usuario")

// consent aplica a politica de aviso antes da tela (contrato, secao 8.3). Devolve a funcao que encerra o aviso.
// O aviso e o pedido pelo eyes-tray chegam na fase 12.3; ate la "notify" segue sem aviso e "ask" recusa.
func consent(ctx context.Context, e *env.Env, t target, p HelperParams, technician string) (func(), error) {
	switch p.Policy.Consent {
	case "ask":
		return func() {}, errDenied
	case "notify":
		e.Log.Info("aviso ao usuario indisponivel nesta versao; acesso segue sem aviso", "sessao_remota", p.SessionID)
	}
	return func() {}, nil
}
