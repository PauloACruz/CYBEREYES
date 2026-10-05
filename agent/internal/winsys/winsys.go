// Package winsys reune utilitarios do Windows usados pelos comandos do console:
// servicos (Service Control Manager) e registro. Fora do Windows as funcoes
// devolvem ErrUnsupported; a logica pura (caminhos, formatos de valores e nomes
// de estados) fica em arquivos sem restricao de sistema para ser testada em qualquer lugar.
package winsys

import "errors"

// ErrUnsupported indica recurso disponivel somente no Windows.
var ErrUnsupported = errors.New("recurso disponivel somente no Windows")

// ErrServiceNotFound indica servico inexistente.
var ErrServiceNotFound = errors.New("not found")

// Service descreve um servico do Windows no formato do comando winservices e do check-in agent-winsvc.
type Service struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	// Status: running, stopped, start_pending, stop_pending, paused, pause_pending, continue_pending.
	Status string `json:"status"`
	// StartType: auto, manual, disabled, boot, system.
	StartType   string `json:"start_type"`
	AutoDelay   bool   `json:"autodelay"`
	PID         int    `json:"pid"`
	BinPath     string `json:"binpath"`
	Username    string `json:"username"`
	Description string `json:"description"`
}

// Map devolve o servico como mapa (chaves do contrato), util para respostas msgpack.
func (s Service) Map() map[string]any {
	return map[string]any{
		"name":         s.Name,
		"display_name": s.DisplayName,
		"status":       s.Status,
		"start_type":   s.StartType,
		"autodelay":    s.AutoDelay,
		"pid":          s.PID,
		"binpath":      s.BinPath,
		"username":     s.Username,
		"description":  s.Description,
	}
}

// StatusName converte o estado numerico do SCM (SERVICE_STOPPED=1 ... SERVICE_PAUSED=7) no texto do console.
func StatusName(state uint32) string {
	switch state {
	case 1:
		return "stopped"
	case 2:
		return "start_pending"
	case 3:
		return "stop_pending"
	case 4:
		return "running"
	case 5:
		return "continue_pending"
	case 6:
		return "pause_pending"
	case 7:
		return "paused"
	}
	return "unknown"
}

// StartTypeName converte o tipo de inicio numerico (SERVICE_BOOT_START=0 ... SERVICE_DISABLED=4) no texto do console.
func StartTypeName(startType uint32) string {
	switch startType {
	case 0:
		return "boot"
	case 1:
		return "system"
	case 2:
		return "auto"
	case 3:
		return "manual"
	case 4:
		return "disabled"
	}
	return "unknown"
}

// ParseStartType converte o startType do editwinsvc (auto, autodelay, manual, disabled) no
// valor numerico do SCM e no indicador de inicio atrasado.
func ParseStartType(s string) (startType uint32, delayed bool, err error) {
	switch s {
	case "auto", "automatic":
		return 2, false, nil
	case "autodelay":
		return 2, true, nil
	case "manual":
		return 3, false, nil
	case "disabled":
		return 4, false, nil
	}
	return 0, false, errors.New("tipo de inicializacao invalido: " + s)
}
