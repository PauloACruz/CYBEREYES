//go:build linux || darwin

package sysinfo

import (
	"fmt"
	"strings"

	"golang.org/x/sys/unix"
)

// usage consulta o uso de um caminho montado com statfs.
func usage(path string) (DiskUsage, error) {
	if path == "" {
		return DiskUsage{}, fmt.Errorf("caminho vazio")
	}
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return DiskUsage{}, err
	}
	bsize := blockSize(&st)
	total := uint64(st.Blocks) * bsize
	free := uint64(st.Bfree) * bsize
	avail := uint64(st.Bavail) * bsize
	used := uint64(0)
	if total > free {
		used = total - free
	}
	return DiskUsage{Device: path, Mountpoint: path, Total: total, Used: used, Free: avail}, nil
}

func trimNul(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		b = b[:i]
	}
	return string(b)
}
