//go:build windows

package service

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// Run executa sob o SCM quando iniciado como servico; caso contrario, em primeiro plano.
func Run(run RunFunc) error {
	isSvc, err := svc.IsWindowsService()
	if err != nil {
		return err
	}
	if !isSvc {
		return runForeground(run)
	}
	return svc.Run(Name, &handler{run: run})
}

type handler struct{ run RunFunc }

func (h *handler) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const accepts = svc.AcceptStop | svc.AcceptShutdown
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- h.run(ctx) }()
	status <- svc.Status{State: svc.Running, Accepts: accepts}
	for {
		select {
		case err := <-done:
			cancel()
			if err != nil {
				return true, 1
			}
			return false, 0
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending, WaitHint: 20000}
				cancel()
				select {
				case <-done:
				case <-time.After(20 * time.Second):
				}
				return false, 0
			}
		}
	}
}

// Install registra o servico (inicio automatico, reinicio em caso de falha) e o inicia.
func Install(binary string) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err == nil {
		_ = stopService(s)
		cfg, cerr := s.Config()
		if cerr == nil {
			cfg.BinaryPathName = `"` + binary + `" service`
			cfg.StartType = mgr.StartAutomatic
			cfg.DisplayName = DisplayName
			cfg.Description = Description
			err = s.UpdateConfig(cfg)
		} else {
			err = cerr
		}
	} else {
		s, err = m.CreateService(Name, binary, mgr.Config{
			DisplayName:  DisplayName,
			Description:  Description,
			StartType:    mgr.StartAutomatic,
			ErrorControl: mgr.ErrorNormal,
		}, "service")
	}
	if err != nil {
		return err
	}
	defer s.Close()
	actions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}
	if err := s.SetRecoveryActions(actions, 86400); err != nil {
		return err
	}
	_ = s.SetRecoveryActionsOnNonCrashFailures(true)
	return s.Start()
}

// Uninstall para e remove o servico.
func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return nil
	}
	defer s.Close()
	_ = stopService(s)
	return s.Delete()
}

// Stop para o servico.
func Stop() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return err
	}
	defer s.Close()
	return stopService(s)
}

// Restart reinicia o servico.
func Restart() error {
	if err := Stop(); err != nil {
		return err
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return err
	}
	defer s.Close()
	return s.Start()
}

// RestartDetached reinicia por um processo separado (o servico atual sera encerrado).
func RestartDetached() error {
	cmd := exec.Command("cmd.exe", "/C", "timeout /t 3 /nobreak >NUL & net stop "+Name+" & net start "+Name)
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS, HideWindow: true}
	return cmd.Start()
}

func stopService(s *mgr.Service) error {
	st, err := s.Query()
	if err != nil {
		return err
	}
	if st.State == svc.Stopped {
		return nil
	}
	if _, err := s.Control(svc.Stop); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
		return err
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		st, err = s.Query()
		if err != nil {
			return err
		}
		if st.State == svc.Stopped {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("o servico nao parou em 30 s (estado %s)", strconv.Itoa(int(st.State)))
}
