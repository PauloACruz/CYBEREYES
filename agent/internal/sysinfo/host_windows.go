//go:build windows

package sysinfo

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

var (
	kernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64       = kernel32.NewProc("GetTickCount64")
)

// OSName devolve o nome do Windows ("Windows 11 Pro, 64 bit v23H2 (build 22631.4317)").
func OSName() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "Windows"
	}
	defer k.Close()
	product, _, _ := k.GetStringValue("ProductName")
	display, _, _ := k.GetStringValue("DisplayVersion")
	if display == "" {
		display, _, _ = k.GetStringValue("ReleaseId")
	}
	build, _, _ := k.GetStringValue("CurrentBuild")
	if build == "" {
		build, _, _ = k.GetStringValue("CurrentBuildNumber")
	}
	ubr, _, _ := k.GetIntegerValue("UBR")
	return formatWindowsOS(product, display, build, ubr, is64BitOS())
}

// is64BitOS informa se o Windows e de 64 bits (mesmo com o EYES de 32 bits).
func is64BitOS() bool {
	for _, v := range []string{os.Getenv("PROCESSOR_ARCHITEW6432"), os.Getenv("PROCESSOR_ARCHITECTURE")} {
		switch strings.ToUpper(v) {
		case "AMD64", "ARM64", "IA64":
			return true
		}
	}
	return unsafe.Sizeof(uintptr(0)) == 8
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

// TotalRAM devolve a memoria fisica total em bytes.
func TotalRAM() (uint64, error) {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, err := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0, err
	}
	return m.TotalPhys, nil
}

// BootTime devolve a hora de partida em segundos Unix.
func BootTime() int64 {
	if err := procGetTickCount64.Find(); err != nil {
		return 0
	}
	r1, r2, _ := procGetTickCount64.Call()
	ms := uint64(r1)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		// Em 32 bits o valor de 64 bits volta dividido em dois registradores.
		ms |= uint64(r2) << 32
	}
	return time.Now().Add(-time.Duration(ms) * time.Millisecond).Unix()
}

// NeedsReboot verifica as marcas de reinicio pendente do Windows Update, do CBS e das
// renomeacoes de arquivos pendentes.
func NeedsReboot(context.Context) bool {
	keys := []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
	}
	for _, p := range keys {
		if k, err := registry.OpenKey(registry.LOCAL_MACHINE, p, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
			k.Close()
			return true
		}
	}
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err == nil {
		defer k.Close()
		if vals, _, err := k.GetStringsValue("PendingFileRenameOperations"); err == nil {
			for _, v := range vals {
				if strings.TrimSpace(v) != "" {
					return true
				}
			}
		}
	}
	return false
}

func loggedInUser(context.Context) string {
	u, err := execx.ConsoleUser()
	if err != nil {
		return ""
	}
	return u
}

func disks(ctx context.Context) ([]DiskUsage, error) {
	buf := make([]uint16, 512)
	n, err := windows.GetLogicalDriveStrings(uint32(len(buf)), &buf[0])
	if err != nil {
		return nil, err
	}
	if int(n) > len(buf) {
		buf = make([]uint16, n+1)
		if n, err = windows.GetLogicalDriveStrings(uint32(len(buf)), &buf[0]); err != nil {
			return nil, err
		}
	}
	out := []DiskUsage{}
	for _, root := range splitMultiSZ(buf[:n]) {
		if ctx.Err() != nil {
			break
		}
		p, err := windows.UTF16PtrFromString(root)
		if err != nil || windows.GetDriveType(p) != windows.DRIVE_FIXED {
			continue
		}
		d, err := usage(root)
		if err != nil || d.Total == 0 {
			continue
		}
		out = append(out, d)
	}
	return out, nil
}

// usage aceita "C:", "C:\" ou "c".
func usage(path string) (DiskUsage, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return DiskUsage{}, errors.New("unidade vazia")
	}
	if len(path) == 1 {
		path += ":"
	}
	root := path
	if !strings.HasSuffix(root, `\`) {
		root += `\`
	}
	p, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return DiskUsage{}, err
	}
	var avail, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(p, &avail, &total, &free); err != nil {
		return DiskUsage{}, err
	}
	fsName := make([]uint16, windows.MAX_PATH+1)
	fstype := ""
	if err := windows.GetVolumeInformation(p, nil, 0, nil, nil, nil, &fsName[0], uint32(len(fsName))); err == nil {
		fstype = windows.UTF16ToString(fsName)
	}
	device := strings.ToUpper(strings.TrimSuffix(root, `\`))
	used := uint64(0)
	if total > free {
		used = total - free
	}
	return DiskUsage{Device: device, Mountpoint: root, Fstype: fstype, Total: total, Used: used, Free: free}, nil
}

func splitMultiSZ(buf []uint16) []string {
	var out []string
	start := 0
	for i, c := range buf {
		if c == 0 {
			if i > start {
				out = append(out, windows.UTF16ToString(buf[start:i]))
			}
			start = i + 1
		}
	}
	return out
}
