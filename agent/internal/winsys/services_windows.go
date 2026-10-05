//go:build windows

package winsys

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func openSCM(access uint32) (windows.Handle, error) {
	h, err := windows.OpenSCManager(nil, nil, access)
	if err != nil {
		return 0, fmt.Errorf("falha ao abrir o gerenciador de servicos: %w", err)
	}
	return h, nil
}

func openService(scm windows.Handle, name string, access uint32) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	h, err := windows.OpenService(scm, p, access)
	if err != nil {
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) || errors.Is(err, windows.ERROR_INVALID_NAME) {
			return 0, ErrServiceNotFound
		}
		return 0, err
	}
	return h, nil
}

// ListServices devolve os servicos Win32 (sem drivers), ordenados pelo nome.
func ListServices() ([]Service, error) {
	scm, err := openSCM(windows.SC_MANAGER_CONNECT | windows.SC_MANAGER_ENUMERATE_SERVICE)
	if err != nil {
		return nil, err
	}
	defer windows.CloseServiceHandle(scm)

	var buf []uint64 // alinhado em 8 bytes
	var needed, count, resume uint32
	size := uint32(64 << 10)
	for i := 0; ; i++ {
		buf = make([]uint64, size/8+1)
		err = windows.EnumServicesStatusEx(scm, windows.SC_ENUM_PROCESS_INFO, windows.SERVICE_WIN32, windows.SERVICE_STATE_ALL,
			(*byte)(unsafe.Pointer(&buf[0])), uint32(len(buf)*8), &needed, &count, &resume, nil)
		if err == nil {
			break
		}
		if !errors.Is(err, windows.ERROR_MORE_DATA) || i > 5 {
			return nil, fmt.Errorf("falha ao listar os servicos: %w", err)
		}
		// Recomeca do zero com um buffer maior para ter a lista inteira de uma vez.
		resume = 0
		size = uint32(len(buf)*8) + needed + 4096
	}
	entries := unsafe.Slice((*windows.ENUM_SERVICE_STATUS_PROCESS)(unsafe.Pointer(&buf[0])), count)
	out := make([]Service, 0, count)
	for _, e := range entries {
		s := Service{
			Name:        windows.UTF16PtrToString(e.ServiceName),
			DisplayName: windows.UTF16PtrToString(e.DisplayName),
			Status:      StatusName(e.ServiceStatusProcess.CurrentState),
			PID:         int(e.ServiceStatusProcess.ProcessId),
			StartType:   "unknown",
		}
		if h, err := openService(scm, s.Name, windows.SERVICE_QUERY_CONFIG); err == nil {
			fillConfig(h, &s)
			windows.CloseServiceHandle(h)
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// GetService devolve um servico pelo nome curto (ErrServiceNotFound se nao existir).
func GetService(name string) (Service, error) {
	scm, err := openSCM(windows.SC_MANAGER_CONNECT)
	if err != nil {
		return Service{}, err
	}
	defer windows.CloseServiceHandle(scm)
	h, err := openService(scm, name, windows.SERVICE_QUERY_CONFIG|windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return Service{}, err
	}
	defer windows.CloseServiceHandle(h)
	s := Service{Name: name, StartType: "unknown"}
	st, err := queryStatus(h)
	if err != nil {
		return Service{}, err
	}
	s.Status = StatusName(st.CurrentState)
	s.PID = int(st.ProcessId)
	fillConfig(h, &s)
	if s.DisplayName == "" {
		s.DisplayName = name
	}
	return s, nil
}

func queryStatus(h windows.Handle) (windows.SERVICE_STATUS_PROCESS, error) {
	var st windows.SERVICE_STATUS_PROCESS
	var needed uint32
	err := windows.QueryServiceStatusEx(h, windows.SC_STATUS_PROCESS_INFO, (*byte)(unsafe.Pointer(&st)), uint32(unsafe.Sizeof(st)), &needed)
	return st, err
}

// fillConfig completa o servico com binpath, conta, tipo de inicio, descricao e inicio atrasado.
// Cada consulta e opcional: servicos protegidos podem negar parte delas.
func fillConfig(h windows.Handle, s *Service) {
	if b, err := queryConfig(h); err == nil {
		c := (*windows.QUERY_SERVICE_CONFIG)(unsafe.Pointer(&b[0]))
		s.BinPath = windows.UTF16PtrToString(c.BinaryPathName)
		s.Username = windows.UTF16PtrToString(c.ServiceStartName)
		s.StartType = StartTypeName(c.StartType)
		if dn := windows.UTF16PtrToString(c.DisplayName); dn != "" && s.DisplayName == "" {
			s.DisplayName = dn
		}
	}
	if b, err := queryConfig2(h, windows.SERVICE_CONFIG_DESCRIPTION); err == nil {
		d := (*windows.SERVICE_DESCRIPTION)(unsafe.Pointer(&b[0]))
		if d.Description != nil {
			s.Description = windows.UTF16PtrToString(d.Description)
		}
	}
	if s.StartType == "auto" {
		if b, err := queryConfig2(h, windows.SERVICE_CONFIG_DELAYED_AUTO_START_INFO); err == nil {
			d := (*windows.SERVICE_DELAYED_AUTO_START_INFO)(unsafe.Pointer(&b[0]))
			s.AutoDelay = d.IsDelayedAutoStartUp != 0
		}
	}
}

func queryConfig(h windows.Handle) ([]uint64, error) {
	n := uint32(1024)
	for i := 0; i < 5; i++ {
		b := make([]uint64, n/8+1)
		err := windows.QueryServiceConfig(h, (*windows.QUERY_SERVICE_CONFIG)(unsafe.Pointer(&b[0])), uint32(len(b)*8), &n)
		if err == nil {
			return b, nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return nil, err
		}
	}
	return nil, windows.ERROR_INSUFFICIENT_BUFFER
}

func queryConfig2(h windows.Handle, level uint32) ([]uint64, error) {
	n := uint32(1024)
	for i := 0; i < 5; i++ {
		b := make([]uint64, n/8+1)
		err := windows.QueryServiceConfig2(h, level, (*byte)(unsafe.Pointer(&b[0])), uint32(len(b)*8), &n)
		if err == nil {
			return b, nil
		}
		if !errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			return nil, err
		}
	}
	return nil, windows.ERROR_INSUFFICIENT_BUFFER
}

// StartService inicia o servico e espera ficar em execucao (ate o prazo do ctx).
func StartService(ctx context.Context, name string) error {
	scm, err := openSCM(windows.SC_MANAGER_CONNECT)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(scm)
	h, err := openService(scm, name, windows.SERVICE_START|windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(h)
	s := &mgr.Service{Name: name, Handle: h}
	st, err := s.Query()
	if err != nil {
		return err
	}
	switch st.State {
	case svc.Running:
		return nil
	case svc.StopPending:
		// Espera terminar de parar antes de iniciar.
		if _, err := waitState(ctx, s, svc.Stopped); err != nil {
			return err
		}
	}
	if st.State != svc.StartPending {
		if err := s.Start(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
			return startError(err)
		}
	}
	last, err := waitState(ctx, s, svc.Running)
	if err != nil {
		if last.State == svc.Stopped {
			return fmt.Errorf("o servico parou logo apos iniciar (codigo de saida %d)", exitCode(last))
		}
		return err
	}
	return nil
}

func startError(err error) error {
	switch {
	case errors.Is(err, windows.ERROR_SERVICE_DISABLED):
		return errors.New("o servico esta desativado")
	case errors.Is(err, windows.ERROR_SERVICE_DEPENDENCY_FAIL):
		return errors.New("falha ao iniciar um servico do qual este depende")
	case errors.Is(err, windows.ERROR_SERVICE_LOGON_FAILED):
		return errors.New("falha de logon da conta do servico")
	case errors.Is(err, windows.ERROR_ACCESS_DENIED):
		return errors.New("acesso negado")
	}
	return fmt.Errorf("falha ao iniciar: %v", err)
}

func exitCode(st svc.Status) uint32 {
	if st.Win32ExitCode == uint32(windows.ERROR_SERVICE_SPECIFIC_ERROR) {
		return st.ServiceSpecificExitCode
	}
	return st.Win32ExitCode
}

// StopService para o servico e espera ficar parado (ate o prazo do ctx).
func StopService(ctx context.Context, name string) error {
	scm, err := openSCM(windows.SC_MANAGER_CONNECT)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(scm)
	h, err := openService(scm, name, windows.SERVICE_STOP|windows.SERVICE_QUERY_STATUS|windows.SERVICE_ENUMERATE_DEPENDENTS)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(h)
	s := &mgr.Service{Name: name, Handle: h}
	st, err := s.Query()
	if err != nil {
		return err
	}
	if st.State == svc.Stopped {
		return nil
	}
	if st.State != svc.StopPending {
		if _, err := s.Control(svc.Stop); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
			if errors.Is(err, windows.ERROR_DEPENDENT_SERVICES_RUNNING) {
				deps, _ := s.ListDependentServices(svc.Active)
				return fmt.Errorf("existem servicos dependentes em execucao: %s", strings.Join(deps, ", "))
			}
			if errors.Is(err, windows.ERROR_INVALID_SERVICE_CONTROL) || errors.Is(err, windows.ERROR_SERVICE_CANNOT_ACCEPT_CTRL) {
				return errors.New("o servico nao aceita o comando de parada agora")
			}
			if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
				return errors.New("acesso negado")
			}
			return fmt.Errorf("falha ao parar: %v", err)
		}
	}
	_, err = waitState(ctx, s, svc.Stopped)
	return err
}

// waitState consulta o estado a cada 300 ms ate chegar em want ou acabar o prazo.
func waitState(ctx context.Context, s *mgr.Service, want svc.State) (svc.Status, error) {
	tick := time.NewTicker(300 * time.Millisecond)
	defer tick.Stop()
	var last svc.Status
	for {
		st, err := s.Query()
		if err != nil {
			return last, err
		}
		last = st
		if st.State == want {
			return st, nil
		}
		if want == svc.Running && st.State == svc.Stopped {
			// Tentou iniciar e parou: nao adianta esperar mais.
			return st, fmt.Errorf("o servico parou logo apos iniciar (codigo de saida %d)", exitCode(st))
		}
		select {
		case <-ctx.Done():
			return st, fmt.Errorf("o servico nao chegou ao estado %s no tempo esperado (estado atual: %s)",
				StatusName(uint32(want)), StatusName(uint32(st.State)))
		case <-tick.C:
		}
	}
}

// SetStartType muda so o tipo de inicio (auto, autodelay, manual, disabled), sem tocar na conta nem na senha.
func SetStartType(name, startType string) error {
	t, delayed, err := ParseStartType(startType)
	if err != nil {
		return err
	}
	scm, err := openSCM(windows.SC_MANAGER_CONNECT)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(scm)
	h, err := openService(scm, name, windows.SERVICE_CHANGE_CONFIG|windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		return err
	}
	defer windows.CloseServiceHandle(h)
	const noChange = windows.SERVICE_NO_CHANGE
	if err := windows.ChangeServiceConfig(h, noChange, t, noChange, nil, nil, nil, nil, nil, nil, nil); err != nil {
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			return errors.New("acesso negado")
		}
		return fmt.Errorf("falha ao alterar o tipo de inicializacao: %v", err)
	}
	info := windows.SERVICE_DELAYED_AUTO_START_INFO{}
	if delayed {
		info.IsDelayedAutoStartUp = 1
	}
	err = windows.ChangeServiceConfig2(h, windows.SERVICE_CONFIG_DELAYED_AUTO_START_INFO, (*byte)(unsafe.Pointer(&info)))
	if err != nil && delayed {
		return fmt.Errorf("falha ao ativar o inicio atrasado: %v", err)
	}
	return nil
}
