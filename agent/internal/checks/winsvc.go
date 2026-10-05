package checks

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Estados de servico do Windows no formato usado pelo EYES.
const (
	svcRunning         = "running"
	svcStopped         = "stopped"
	svcStartPending    = "start_pending"
	svcStopPending     = "stop_pending"
	svcContinuePending = "continue_pending"
	svcPausePending    = "pause_pending"
	svcPaused          = "paused"
)

// errNoService indica servico inexistente.
var errNoService = errors.New("servico nao existe")

// Funcoes substituiveis nos testes.
var (
	svcQuery = queryService
	svcStart = startService
	// svcPoll e o intervalo de espera depois de pedir o inicio do servico.
	svcPoll = time.Second
)

var svcLabels = map[string]string{
	svcRunning:         "em execucao",
	svcStopped:         "parado",
	svcStartPending:    "iniciando",
	svcStopPending:     "parando",
	svcContinuePending: "retomando",
	svcPausePending:    "pausando",
	svcPaused:          "pausado",
}

func svcLabel(state string) string {
	if l, ok := svcLabels[state]; ok {
		return l
	}
	return state
}

// winsvcCheck decide o status no agente (contrato 3.5, PROPOSTA):
//   - passa com o servico em execucao, ou iniciando com pass_if_start_pending;
//   - servico inexistente passa so com pass_if_svc_not_exist;
//   - parado com restart_if_stopped: tenta iniciar; passa se ficar em execucao.
func winsvcCheck(ctx context.Context, c Check) (map[string]any, error) {
	if c.SvcName == "" {
		return winsvcBody(statusFailing, "Servico nao informado no check"), nil
	}
	state, err := svcQuery(c.SvcName)
	if errors.Is(err, errUnsupported) {
		return nil, fmt.Errorf("%w: %v", errSkip, err)
	}
	if errors.Is(err, errNoService) {
		if c.PassIfSvcNotExist {
			return winsvcBody(statusPassing, fmt.Sprintf("Servico %s nao existe (permitido pelo check)", c.SvcName)), nil
		}
		return winsvcBody(statusFailing, fmt.Sprintf("Servico %s nao existe", c.SvcName)), nil
	}
	if err != nil {
		return winsvcBody(statusFailing, fmt.Sprintf("Falha ao consultar o servico %s: %v", c.SvcName, err)), nil
	}
	switch {
	case state == svcRunning:
		return winsvcBody(statusPassing, fmt.Sprintf("Servico %s %s", c.SvcName, svcLabel(state))), nil
	case state == svcStartPending && c.PassIfStartPending:
		return winsvcBody(statusPassing, fmt.Sprintf("Servico %s %s (permitido pelo check)", c.SvcName, svcLabel(state))), nil
	case state == svcStopped && c.RestartIfStopped:
		return restartService(ctx, c), nil
	}
	return winsvcBody(statusFailing, fmt.Sprintf("Servico %s %s", c.SvcName, svcLabel(state))), nil
}

func restartService(ctx context.Context, c Check) map[string]any {
	if err := svcStart(c.SvcName); err != nil {
		return winsvcBody(statusFailing, fmt.Sprintf("Servico %s parado; falha ao iniciar: %v", c.SvcName, err))
	}
	wait := min(c.Timeout, 60*time.Second)
	deadline := time.Now().Add(wait)
	state := svcStartPending
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return winsvcBody(statusFailing, fmt.Sprintf("Servico %s parado; inicio interrompido", c.SvcName))
		case <-time.After(svcPoll):
		}
		s, err := svcQuery(c.SvcName)
		if err != nil {
			return winsvcBody(statusFailing, fmt.Sprintf("Servico %s parado; inicio pedido, mas a consulta falhou: %v", c.SvcName, err))
		}
		state = s
		if state == svcRunning {
			return winsvcBody(statusPassing, fmt.Sprintf("Servico %s estava parado e foi iniciado pelo EYES", c.SvcName))
		}
		if state == svcStopped {
			break
		}
	}
	if state == svcStartPending && c.PassIfStartPending {
		return winsvcBody(statusPassing, fmt.Sprintf("Servico %s estava parado; inicio pedido e ainda em andamento", c.SvcName))
	}
	return winsvcBody(statusFailing, fmt.Sprintf("Servico %s parado; inicio pedido, estado atual: %s", c.SvcName, svcLabel(state)))
}

func winsvcBody(status, info string) map[string]any {
	return map[string]any{"status": status, "more_info": info}
}
