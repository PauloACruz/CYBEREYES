package sysinfo

import "context"

// Service e um servico do Windows no formato do console (agent-winsvc, winservices, winsvcdetail).
type Service struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	// Status: running, stopped, start_pending, stop_pending, paused, pause_pending, continue_pending.
	Status string `json:"status"`
	// StartType: auto, manual, disabled, boot, system.
	StartType   string `json:"start_type"`
	PID         int    `json:"pid"`
	BinPath     string `json:"binpath"`
	Username    string `json:"username"`
	Description string `json:"description"`
	// Autodelay indica inicio automatico atrasado.
	Autodelay bool `json:"autodelay"`
}

// Services lista os servicos Win32 do Windows. Fora do Windows devolve ErrUnsupported.
func Services(ctx context.Context) ([]Service, error) { return services(ctx) }

// LookupService devolve um servico pelo nome curto. Fora do Windows devolve ErrUnsupported.
func LookupService(name string) (Service, error) { return lookupService(name) }

// ServiceStatus traduz SERVICE_STATUS.dwCurrentState para o texto do console.
func ServiceStatus(state uint32) string {
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

// ServiceStartType traduz dwStartType para o texto do console.
func ServiceStartType(t uint32) string {
	switch t {
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
