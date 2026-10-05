//go:build linux

package sysinfo

import (
	"context"
	"os"
	"os/exec"
	"time"

	"golang.org/x/sys/unix"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// OSName devolve o nome do sistema ("Ubuntu 24.04.1 LTS, kernel 6.8.0-45-generic").
func OSName() string {
	name := ""
	for _, p := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		if data, err := os.ReadFile(p); err == nil {
			name = osReleaseName(string(data))
			if name != "" {
				break
			}
		}
	}
	if name == "" {
		name = "Linux"
	}
	var u unix.Utsname
	if err := unix.Uname(&u); err == nil {
		if rel := trimNul(u.Release[:]); rel != "" {
			name += ", kernel " + rel
		}
	}
	return name
}

// TotalRAM devolve a memoria fisica total em bytes.
func TotalRAM() (uint64, error) {
	var si unix.Sysinfo_t
	if err := unix.Sysinfo(&si); err != nil {
		return 0, err
	}
	unit := uint64(si.Unit)
	if unit == 0 {
		unit = 1
	}
	return uint64(si.Totalram) * unit, nil //nolint:unconvert // uint32 em 32 bits
}

// BootTime devolve a hora de partida em segundos Unix.
func BootTime() int64 {
	if data, err := os.ReadFile("/proc/stat"); err == nil {
		if bt := procStatBootTime(string(data)); bt > 0 {
			return bt
		}
	}
	var si unix.Sysinfo_t
	if err := unix.Sysinfo(&si); err == nil && si.Uptime > 0 {
		return time.Now().Unix() - int64(si.Uptime)
	}
	return 0
}

// NeedsReboot informa reinicio pendente (Debian/Ubuntu: /var/run/reboot-required;
// RHEL e derivados: needs-restarting -r devolve 1 quando precisa).
func NeedsReboot(ctx context.Context) bool {
	for _, p := range []string{"/var/run/reboot-required", "/run/reboot-required"} {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	if path, err := exec.LookPath("needs-restarting"); err == nil {
		res := execx.Run(ctx, execx.Spec{Path: path, Args: []string{"-r"}, Timeout: 30 * time.Second})
		if res.Err == nil && !res.TimedOut && res.ExitCode == 1 {
			return true
		}
	}
	return false
}

func loggedInUser(ctx context.Context) string {
	if out, err := output(ctx, 5*time.Second, "loginctl", "list-sessions", "--no-legend", "--no-pager"); err == nil {
		if u := parseLoginctl(out); u != "" {
			return u
		}
	}
	if out, err := output(ctx, 5*time.Second, "who"); err == nil {
		return parseWho(out)
	}
	return ""
}

func blockSize(st *unix.Statfs_t) uint64 {
	if st.Frsize > 0 {
		return uint64(st.Frsize)
	}
	return uint64(st.Bsize) //nolint:gosec // tamanho de bloco sempre positivo
}

func disks(context.Context) ([]DiskUsage, error) {
	data, err := os.ReadFile("/proc/self/mounts")
	if err != nil {
		return nil, err
	}
	out := []DiskUsage{}
	for _, m := range parseMounts(string(data)) {
		d, err := usage(m.Mountpoint)
		if err != nil || d.Total == 0 {
			continue
		}
		d.Source = m.Source
		d.Fstype = m.Fstype
		out = append(out, d)
	}
	return out, nil
}
