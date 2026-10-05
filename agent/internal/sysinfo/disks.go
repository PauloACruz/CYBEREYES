package sysinfo

import (
	"context"
	"strconv"
	"strings"
)

// DiskUsage e o uso de um volume montado, em bytes.
type DiskUsage struct {
	// Device e o nome usado pelo console e pelos checks: "C:" no Windows, ponto de montagem ("/") no Unix.
	Device string
	// Mountpoint e o ponto de montagem ("C:\" no Windows).
	Mountpoint string
	// Source e o dispositivo de origem ("/dev/sda1"), vazio no Windows.
	Source string
	Fstype string
	Total  uint64
	// Used e o espaco ocupado (total menos livre).
	Used uint64
	// Free e o espaco disponivel para uso (no Unix, sem a reserva do root).
	Free uint64
}

// Percent devolve o percentual usado (0..100, uma casa), como o df: usado / (usado + disponivel).
func (d DiskUsage) Percent() float64 {
	den := d.Used + d.Free
	if den == 0 {
		return 0
	}
	p := Round(float64(d.Used)*100/float64(den), 1)
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// Disks lista os volumes locais fixos com o uso de cada um.
func Disks(ctx context.Context) ([]DiskUsage, error) { return disks(ctx) }

// Usage devolve o uso do volume indicado ("C:" no Windows, caminho de montagem no Unix).
func Usage(path string) (DiskUsage, error) { return usage(path) }

// mountEntry e uma linha de /proc/self/mounts.
type mountEntry struct {
	Source, Mountpoint, Fstype string
}

// realFS sao os sistemas de arquivos de discos de verdade (o resto e virtual).
var realFS = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true, "f2fs": true,
	"jfs": true, "reiserfs": true, "vfat": true, "exfat": true, "ntfs": true, "ntfs3": true, "fuseblk": true,
	"hfsplus": true, "nilfs2": true, "bcachefs": true, "ufs": true, "apfs": true, "hfs": true, "msdos": true,
}

// skipMountPrefixes sao pontos de montagem de sistema, pacotes ou conteineres.
var skipMountPrefixes = []string{"/snap/", "/var/lib/docker/", "/var/lib/containers/", "/var/snap/", "/run/", "/proc/", "/sys/", "/dev/"}

// parseMounts le o formato de /proc/self/mounts e filtra os volumes reais, um por dispositivo.
func parseMounts(data string) []mountEntry {
	var out []mountEntry
	seen := map[string]bool{}
	for _, line := range strings.Split(data, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		e := mountEntry{Source: unescapeMount(f[0]), Mountpoint: unescapeMount(f[1]), Fstype: f[2]}
		if !realFS[e.Fstype] {
			continue
		}
		if e.Fstype != "zfs" && !strings.HasPrefix(e.Source, "/") {
			continue
		}
		if strings.HasPrefix(e.Source, "/dev/loop") {
			continue
		}
		skip := false
		for _, p := range skipMountPrefixes {
			if strings.HasPrefix(e.Mountpoint, p) {
				skip = true
				break
			}
		}
		if skip || seen[e.Source] {
			continue
		}
		seen[e.Source] = true
		out = append(out, e)
	}
	return out
}

// unescapeMount desfaz o escape octal do kernel ("\040" para espaco).
func unescapeMount(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			if n, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
