//go:build windows

package checks

import (
	"strings"

	"golang.org/x/sys/windows"
)

// platformDiskUsage le a unidade ("C:" ou "C:\") com GetDiskFreeSpaceEx.
func platformDiskUsage(name string) (diskUsage, error) {
	root := strings.TrimRight(name, `\/`)
	if len(root) == 1 {
		root += ":"
	}
	root += `\`
	p, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return diskUsage{}, err
	}
	var avail, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(p, &avail, &total, &free); err != nil {
		return diskUsage{}, err
	}
	if total == 0 {
		return diskUsage{}, windows.ERROR_NOT_READY
	}
	// No Windows o percentual usa o espaco livre total, como o Explorer.
	return usageFrom(total, free, free), nil
}
