//go:build windows

package sysinfo

import (
	"context"
	"errors"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shlwapi                 = windows.NewLazySystemDLL("shlwapi.dll")
	procSHLoadIndirectStrng = shlwapi.NewProc("SHLoadIndirectString")
)

// services enumera os servicos Win32 com estado, PID e configuracao (cada consulta de
// configuracao e de melhor esforco: um servico sem permissao sai so com nome e estado).
func services(ctx context.Context) ([]Service, error) {
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT|windows.SC_MANAGER_ENUMERATE_SERVICE)
	if err != nil {
		return nil, err
	}
	defer windows.CloseServiceHandle(scm)

	var buf []byte
	var needed, count uint32
	for {
		var p *byte
		if len(buf) > 0 {
			p = &buf[0]
		}
		err = windows.EnumServicesStatusEx(scm, windows.SC_ENUM_PROCESS_INFO, windows.SERVICE_WIN32,
			windows.SERVICE_STATE_ALL, p, uint32(len(buf)), &needed, &count, nil, nil)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.ERROR_MORE_DATA) || needed <= uint32(len(buf)) {
			return nil, err
		}
		buf = make([]byte, needed)
	}
	out := make([]Service, 0, count)
	if count == 0 {
		return out, nil
	}
	entries := unsafe.Slice((*windows.ENUM_SERVICE_STATUS_PROCESS)(unsafe.Pointer(&buf[0])), int(count))
	for _, e := range entries {
		s := Service{
			Name:        windows.UTF16PtrToString(e.ServiceName),
			DisplayName: windows.UTF16PtrToString(e.DisplayName),
			Status:      ServiceStatus(e.ServiceStatusProcess.CurrentState),
			PID:         int(e.ServiceStatusProcess.ProcessId),
		}
		if ctx.Err() == nil {
			fillConfig(scm, &s)
		}
		out = append(out, s)
	}
	return out, nil
}

func lookupService(name string) (Service, error) {
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return Service{}, err
	}
	defer windows.CloseServiceHandle(scm)
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return Service{}, err
	}
	h, err := windows.OpenService(scm, p, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return Service{}, err
	}
	var st windows.SERVICE_STATUS_PROCESS
	var needed uint32
	err = windows.QueryServiceStatusEx(h, windows.SC_STATUS_PROCESS_INFO, (*byte)(unsafe.Pointer(&st)), uint32(unsafe.Sizeof(st)), &needed)
	windows.CloseServiceHandle(h)
	if err != nil {
		return Service{}, err
	}
	s := Service{Name: name, Status: ServiceStatus(st.CurrentState), PID: int(st.ProcessId)}
	fillConfig(scm, &s)
	if s.DisplayName == "" {
		s.DisplayName = name
	}
	return s, nil
}

// fillConfig completa tipo de inicio, caminho, conta, descricao e inicio atrasado.
func fillConfig(scm windows.Handle, s *Service) {
	p, err := windows.UTF16PtrFromString(s.Name)
	if err != nil {
		return
	}
	h, err := windows.OpenService(scm, p, windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		return
	}
	defer windows.CloseServiceHandle(h)

	n := uint32(2048)
	for i := 0; i < 3; i++ {
		b := make([]byte, n)
		cfg := (*windows.QUERY_SERVICE_CONFIG)(unsafe.Pointer(&b[0]))
		err := windows.QueryServiceConfig(h, cfg, n, &n)
		if err == nil {
			s.StartType = ServiceStartType(cfg.StartType)
			s.BinPath = windows.UTF16PtrToString(cfg.BinaryPathName)
			s.Username = windows.UTF16PtrToString(cfg.ServiceStartName)
			if s.DisplayName == "" || strings.HasPrefix(s.DisplayName, "@") {
				s.DisplayName = indirect(windows.UTF16PtrToString(cfg.DisplayName))
			}
			break
		}
		if !errors.Is(err, syscall.ERROR_INSUFFICIENT_BUFFER) {
			break
		}
	}
	if b := config2(h, windows.SERVICE_CONFIG_DESCRIPTION); len(b) >= int(unsafe.Sizeof(windows.SERVICE_DESCRIPTION{})) {
		d := (*windows.SERVICE_DESCRIPTION)(unsafe.Pointer(&b[0]))
		s.Description = indirect(windows.UTF16PtrToString(d.Description))
	}
	if b := config2(h, windows.SERVICE_CONFIG_DELAYED_AUTO_START_INFO); len(b) >= int(unsafe.Sizeof(windows.SERVICE_DELAYED_AUTO_START_INFO{})) {
		d := (*windows.SERVICE_DELAYED_AUTO_START_INFO)(unsafe.Pointer(&b[0]))
		s.Autodelay = d.IsDelayedAutoStartUp != 0 && s.StartType == "auto"
	}
	s.DisplayName = indirect(s.DisplayName)
}

func config2(h windows.Handle, level uint32) []byte {
	n := uint32(1024)
	for i := 0; i < 3; i++ {
		b := make([]byte, n)
		err := windows.QueryServiceConfig2(h, level, &b[0], n, &n)
		if err == nil {
			return b
		}
		if !errors.Is(err, syscall.ERROR_INSUFFICIENT_BUFFER) || n == 0 {
			return nil
		}
	}
	return nil
}

// indirect resolve textos de recurso ("@%SystemRoot%\system32\x.dll,-100") com SHLoadIndirectString.
func indirect(s string) string {
	if !strings.HasPrefix(s, "@") || procSHLoadIndirectStrng.Find() != nil {
		return s
	}
	src, err := windows.UTF16PtrFromString(s)
	if err != nil {
		return s
	}
	out := make([]uint16, 1024)
	hr, _, _ := procSHLoadIndirectStrng.Call(uintptr(unsafe.Pointer(src)), uintptr(unsafe.Pointer(&out[0])), uintptr(len(out)), 0)
	if hr != 0 {
		return s
	}
	if r := windows.UTF16ToString(out); r != "" {
		return r
	}
	return s
}
