//go:build windows

package checks

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modkernel32              = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemTimes       = modkernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = modkernel32.NewProc("GlobalMemoryStatusEx")
)

func newCPUSource() cpuSource { return &timesSource{read: readCPUTimes} }

func ftValue(ft windows.Filetime) float64 {
	return float64(uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime))
}

// readCPUTimes usa GetSystemTimes; o tempo de kernel ja inclui o ocioso.
func readCPUTimes() (cpuTimes, error) {
	var idle, kernel, user windows.Filetime
	r, _, err := procGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	if r == 0 {
		return cpuTimes{}, err
	}
	return cpuTimes{Idle: ftValue(idle), Total: ftValue(kernel) + ftValue(user)}, nil
}

// memoryStatusEx e a estrutura MEMORYSTATUSEX.
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

// readMemPercent usa GlobalMemoryStatusEx (memoria fisica em uso).
func readMemPercent() (float64, error) {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, err := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0, err
	}
	if m.TotalPhys == 0 {
		return float64(m.MemoryLoad), nil
	}
	return clampPercent(100 * float64(m.TotalPhys-m.AvailPhys) / float64(m.TotalPhys)), nil
}
