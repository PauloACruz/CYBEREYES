//go:build darwin

package care

import (
	"context"
	"encoding/binary"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// No macOS ficam CPU, memoria, discos e tempo ligado. Servicos (launchd), log unificado e
// softwareupdate nao entram: nao ha criterio confiavel e rapido para eles.
func platformProbes() []probe {
	return []probe{
		{key: "cpu", label: "Carga de CPU", category: catPerformance, timeout: 5 * time.Second, first: true, fn: darwinCPU},
		{key: "memory", label: "Memoria", category: catPerformance, timeout: 15 * time.Second, fn: darwinMemory},
		{key: "disk", label: "Espaco em disco", category: catStorage, timeout: 20 * time.Second, fn: darwinDisks},
		{key: "uptime", label: "Tempo ligado", category: catStability, timeout: 5 * time.Second, fn: darwinUptime},
	}
}

// darwinCPU le vm.loadavg: struct loadavg { uint32 ldavg[3]; long fscale }.
func darwinCPU(context.Context) []HealthItem {
	b, err := unix.SysctlRaw("vm.loadavg")
	if err != nil || len(b) < 24 {
		return []HealthItem{{Key: "cpu", Label: "Carga de CPU", Category: catPerformance, Status: hUnknown, Detail: "vm.loadavg indisponivel"}}
	}
	ld := binary.LittleEndian.Uint32(b[4:8])
	scale := binary.LittleEndian.Uint64(b[16:24])
	if scale == 0 {
		scale = 2048
	}
	return []HealthItem{cpuLoadItem(float64(ld)/float64(scale), runtime.NumCPU())}
}

// darwinMemory: disponivel = paginas livres, inativas e especulativas (como o modulo component_test).
func darwinMemory(ctx context.Context) []HealthItem {
	total, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return []HealthItem{{Key: "memory", Label: "Memoria", Category: catPerformance, Status: hUnknown, Detail: err.Error()}}
	}
	out, _, code, err := runCmd(ctx, []string{"LC_ALL=C"}, "/usr/bin/vm_stat")
	if err != nil || code != 0 {
		return []HealthItem{{Key: "memory", Label: "Memoria", Category: catPerformance, Status: hUnknown, Detail: "vm_stat falhou"}}
	}
	page := uint64(4096)
	var pages uint64
	for _, l := range strings.Split(out, "\n") {
		if strings.Contains(l, "page size of") {
			for _, f := range strings.Fields(l) {
				if n, err := strconv.ParseUint(f, 10, 64); err == nil && n > 0 {
					page = n
				}
			}
			continue
		}
		k, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "Pages free", "Pages inactive", "Pages speculative":
			n, _ := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(v), "."), 10, 64)
			pages += n
		}
	}
	return []HealthItem{memoryItem(total, pages*page)}
}

var darwinDiskFS = map[string]bool{"apfs": true, "hfs": true, "exfat": true, "msdos": true, "ntfs": true}

func darwinDisks(context.Context) []HealthItem {
	n, err := unix.Getfsstat(nil, unix.MNT_NOWAIT)
	if err != nil || n == 0 {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: "getfsstat falhou"}}
	}
	buf := make([]unix.Statfs_t, n+4)
	n, err = unix.Getfsstat(buf, unix.MNT_NOWAIT)
	if err != nil {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: err.Error()}}
	}
	var items []HealthItem
	for _, st := range buf[:n] {
		mnt := unix.ByteSliceToString(st.Mntonname[:])
		fstype := unix.ByteSliceToString(st.Fstypename[:])
		if !darwinDiskFS[fstype] || st.Flags&unix.MNT_LOCAL == 0 || st.Blocks == 0 {
			continue
		}
		// "/" e somente leitura (volume de sistema selado), mas divide o espaco do conteiner
		// com o volume de dados: entra; os demais volumes somente leitura (imagens) nao.
		if mnt != "/" && (st.Flags&unix.MNT_RDONLY != 0 || strings.HasPrefix(mnt, "/System/Volumes/") || strings.HasPrefix(mnt, "/private/")) {
			continue
		}
		bs := uint64(st.Bsize)
		items = append(items, diskItem(mnt, st.Blocks*bs, st.Bavail*bs, mnt == "/"))
	}
	if len(items) == 0 {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: "Nenhum volume local encontrado"}}
	}
	return items
}

func darwinUptime(context.Context) []HealthItem {
	tv, err := unix.SysctlTimeval("kern.boottime")
	if err != nil {
		return []HealthItem{{Key: "uptime", Label: "Tempo ligado", Category: catStability, Status: hUnknown, Detail: err.Error()}}
	}
	boot := time.Unix(tv.Sec, int64(tv.Usec)*1000)
	return []HealthItem{uptimeItem(time.Since(boot))}
}
