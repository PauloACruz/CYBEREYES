//go:build darwin

package sysinfo

import (
	"context"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// OSName devolve o nome do sistema ("macOS 14.5 (23F79)").
func OSName() string {
	ver, _ := unix.Sysctl("kern.osproductversion")
	build, _ := unix.Sysctl("kern.osversion")
	ver = strings.TrimSpace(ver)
	if ver == "" {
		if out, err := output(context.Background(), 10*time.Second, "sw_vers", "-productVersion"); err == nil {
			ver = strings.TrimSpace(out)
		}
	}
	name := "macOS"
	if ver != "" {
		name += " " + ver
	}
	if build = strings.TrimSpace(build); build != "" {
		name += " (" + build + ")"
	}
	return name
}

// TotalRAM devolve a memoria fisica total em bytes.
func TotalRAM() (uint64, error) { return unix.SysctlUint64("hw.memsize") }

// BootTime devolve a hora de partida em segundos Unix.
func BootTime() int64 {
	tv, err := unix.SysctlTimeval("kern.boottime")
	if err != nil {
		return 0
	}
	return int64(tv.Sec) //nolint:unconvert // int32 em 32 bits
}

// NeedsReboot nao tem indicador confiavel no macOS: devolve sempre falso.
func NeedsReboot(context.Context) bool { return false }

func loggedInUser(ctx context.Context) string {
	// Dono de /dev/console e o usuario da sessao grafica; root indica a janela de login.
	if out, err := output(ctx, 5*time.Second, "stat", "-f", "%Su", "/dev/console"); err == nil {
		u := strings.TrimSpace(out)
		if u != "" && u != "root" && !ignoredUser(u) {
			return u
		}
	}
	if out, err := output(ctx, 5*time.Second, "who"); err == nil {
		return parseWho(out)
	}
	return ""
}

func blockSize(st *unix.Statfs_t) uint64 { return uint64(st.Bsize) }

// Volumes de sistema do APFS que nao interessam ao usuario.
const mntDontBrowse = 0x00100000

func disks(context.Context) ([]DiskUsage, error) {
	n, err := unix.Getfsstat(nil, unix.MNT_NOWAIT)
	if err != nil {
		return nil, err
	}
	buf := make([]unix.Statfs_t, n+4)
	n, err = unix.Getfsstat(buf, unix.MNT_NOWAIT)
	if err != nil {
		return nil, err
	}
	out := []DiskUsage{}
	seen := map[string]bool{}
	for _, st := range buf[:n] {
		fstype := trimNul(st.Fstypename[:])
		mnt := trimNul(st.Mntonname[:])
		src := trimNul(st.Mntfromname[:])
		if !realFS[fstype] || seen[src] {
			continue
		}
		if mnt != "/" && (st.Flags&mntDontBrowse != 0 || strings.HasPrefix(mnt, "/System/Volumes/") || strings.HasPrefix(mnt, "/private/var/")) {
			continue
		}
		seen[src] = true
		bs := uint64(st.Bsize)
		total := st.Blocks * bs
		if total == 0 {
			continue
		}
		free := st.Bfree * bs
		used := uint64(0)
		if total > free {
			used = total - free
		}
		out = append(out, DiskUsage{Device: mnt, Mountpoint: mnt, Source: src, Fstype: fstype, Total: total, Used: used, Free: st.Bavail * bs})
	}
	return out, nil
}
