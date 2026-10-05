//go:build windows

package checks

import (
	"errors"
	"fmt"

	"golang.org/x/sys/windows"
)

// errUnsupported nao ocorre no Windows; existe para o codigo comum.
var errUnsupported = errors.New("nao suportado")

func openService(name string, access uint32) (windows.Handle, windows.Handle, error) {
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, 0, fmt.Errorf("gerenciador de servicos: %w", err)
	}
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		windows.CloseServiceHandle(scm)
		return 0, 0, err
	}
	h, err := windows.OpenService(scm, p, access)
	if err != nil {
		windows.CloseServiceHandle(scm)
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return 0, 0, errNoService
		}
		return 0, 0, err
	}
	return scm, h, nil
}

// queryService devolve o estado atual do servico.
func queryService(name string) (string, error) {
	scm, h, err := openService(name, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return "", err
	}
	defer windows.CloseServiceHandle(scm)
	defer windows.CloseServiceHandle(h)
	var st windows.SERVICE_STATUS
	if err := windows.QueryServiceStatus(h, &st); err != nil {
		return "", err
	}
	switch st.CurrentState {
	case windows.SERVICE_RUNNING:
		return svcRunning, nil
	case windows.SERVICE_STOPPED:
		return svcStopped, nil
	case windows.SERVICE_START_PENDING:
		return svcStartPending, nil
	case windows.SERVICE_STOP_PENDING:
		return svcStopPending, nil
	case windows.SERVICE_CONTINUE_PENDING:
		return svcContinuePending, nil
	case windows.SERVICE_PAUSE_PENDING:
		return svcPausePending, nil
	case windows.SERVICE_PAUSED:
		return svcPaused, nil
	}
	return fmt.Sprintf("estado_%d", st.CurrentState), nil
}

// startService pede o inicio do servico.
func startService(name string) error {
	scm, h, err := openService(name, windows.SERVICE_START|windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(scm)
	defer windows.CloseServiceHandle(h)
	if err := windows.StartService(h, 0, nil); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return err
	}
	return nil
}
