//go:build windows

package actions

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func powerCheck() error { return nil }

// powerAction usa InitiateSystemShutdownEx (com o privilegio SeShutdownPrivilege ligado) e,
// se falhar, o shutdown.exe.
func powerAction(reboot bool) error {
	err := initiateShutdown(reboot)
	if err == nil {
		return nil
	}
	flag := "/s"
	if reboot {
		flag = "/r"
	}
	exe := filepath.Join(systemRoot(), `System32\shutdown.exe`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, cerr := exec.CommandContext(ctx, exe, flag, "/f", "/t", "5", "/d", "p:4:1").CombinedOutput()
	if cerr != nil {
		return fmt.Errorf("InitiateSystemShutdownEx: %v; shutdown.exe: %v %s", err, cerr, out)
	}
	return nil
}

func initiateShutdown(reboot bool) error {
	if err := enableShutdownPrivilege(); err != nil {
		return err
	}
	msg, _ := windows.UTF16PtrFromString("Cybereyes: desligamento solicitado pelo console")
	reason := uint32(windows.SHTDN_REASON_MAJOR_APPLICATION | windows.SHTDN_REASON_MINOR_MAINTENANCE | windows.SHTDN_REASON_FLAG_PLANNED)
	return windows.InitiateSystemShutdownEx(nil, msg, 0, true, reboot, reason)
}

func enableShutdownPrivilege() error {
	var tok windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &tok); err != nil {
		return err
	}
	defer tok.Close()
	var luid windows.LUID
	name, _ := windows.UTF16PtrFromString("SeShutdownPrivilege")
	if err := windows.LookupPrivilegeValue(nil, name, &luid); err != nil {
		return err
	}
	tp := windows.Tokenprivileges{PrivilegeCount: 1}
	tp.Privileges[0] = windows.LUIDAndAttributes{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED}
	// Se o privilegio nao puder ser ligado, InitiateSystemShutdownEx falha e o shutdown.exe assume.
	return windows.AdjustTokenPrivileges(tok, false, &tp, uint32(unsafe.Sizeof(tp)), nil, nil)
}

func systemRoot() string {
	if r := os.Getenv("SystemRoot"); r != "" {
		return r
	}
	return `C:\Windows`
}
