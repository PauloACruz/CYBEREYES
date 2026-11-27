package actions

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// O "reiniciar" do console era parar e depois iniciar: parar o proprio EYES matava o agente e o iniciar nunca chegava,
// deixando a maquina fora do ar ate alguem ligar o servico nela.
func TestServicoDoProprioEyes(t *testing.T) {
	oldSelf, oldRestart := isSelf, restartSelf
	t.Cleanup(func() { isSelf, restartSelf = oldSelf, oldRestart })
	isSelf = func(name string) bool { return strings.EqualFold(name, "eyes") }
	restarts := 0
	restartSelf = func() error { restarts++; return nil }

	h := &handlers{}
	ctx := context.Background()
	act := func(name, action string) SvcResult {
		return h.winsvcaction(ctx, rpc.Request{"payload": map[string]any{"name": name, "action": action}}).(SvcResult)
	}

	if r := act("EYES", "stop"); r.Success || !strings.Contains(r.ErrorMsg, "nao pode ser parado") {
		t.Errorf("parar o EYES deveria ser recusado: %#v", r)
	}
	if r := act("eyes", "start"); !r.Success {
		t.Errorf("iniciar o EYES (ja rodando) deveria dar certo: %#v", r)
	}
	if r := act("eyes", "restart"); !r.Success || restarts != 1 {
		t.Errorf("reiniciar o EYES deveria usar o processo separado: %#v, reinicios %d", r, restarts)
	}
	restartSelf = func() error { return errors.New("falhou") }
	if r := act("eyes", "restart"); r.Success || r.ErrorMsg != "falhou" {
		t.Errorf("a falha do reinicio deveria voltar ao console: %#v", r)
	}

	for _, startType := range []string{"manual", "disabled"} {
		r := h.editwinsvc(ctx, rpc.Request{"payload": map[string]any{"name": "eyes", "startType": startType}}).(SvcResult)
		if r.Success || !strings.Contains(r.ErrorMsg, "desativado") {
			t.Errorf("%s no EYES deveria ser recusado: %#v", startType, r)
		}
	}

	// Outros servicos seguem para o SCM (fora do Windows o winsys recusa) e "restart" virou acao valida.
	if r := act("spooler", "restart"); r.Success || strings.Contains(r.ErrorMsg, "acao invalida") {
		t.Errorf("restart de outro servico deveria ir ao SCM: %#v", r)
	}
	if restarts != 1 {
		t.Errorf("outro servico nao deveria reiniciar o EYES (%d)", restarts)
	}
}
