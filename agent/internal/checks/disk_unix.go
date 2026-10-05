//go:build !windows

package checks

import (
	"golang.org/x/sys/unix"
)

// platformDiskUsage le o ponto de montagem com statfs ("/", "/home"...).
func platformDiskUsage(name string) (diskUsage, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(name, &st); err != nil {
		return diskUsage{}, err
	}
	bs := uint64(st.Bsize) //nolint:gosec // tamanho de bloco nunca e negativo
	return usageFrom(uint64(st.Blocks)*bs, uint64(st.Bfree)*bs, uint64(st.Bavail)*bs), nil
}
