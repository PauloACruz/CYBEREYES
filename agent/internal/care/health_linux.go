//go:build linux

package care

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

func platformProbes() []probe {
	return []probe{
		{key: "cpu", label: "Carga de CPU", category: catPerformance, timeout: 5 * time.Second, first: true, fn: linuxCPU},
		{key: "memory", label: "Memoria", category: catPerformance, timeout: 5 * time.Second, fn: linuxMemory},
		{key: "disk", label: "Espaco em disco", category: catStorage, timeout: 20 * time.Second, fn: linuxDisks},
		{key: "uptime", label: "Tempo ligado", category: catStability, timeout: 5 * time.Second, fn: linuxUptime},
		{key: "pending_reboot", label: "Reinicio pendente", category: catStability, timeout: 35 * time.Second, fn: linuxPendingReboot},
		{key: "services", label: "Unidades do systemd com falha", category: catStability, timeout: 20 * time.Second, fn: linuxFailedUnits},
		{key: "system_errors", label: "Erros de sistema (24 h)", category: catStability, timeout: 40 * time.Second, fn: linuxJournalErrors},
		{key: "updates", label: "Atualizacoes pendentes", category: catSecurity, timeout: 60 * time.Second, fn: linuxUpdates},
	}
}

func linuxCPU(context.Context) []HealthItem {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return []HealthItem{{Key: "cpu", Label: "Carga de CPU", Category: catPerformance, Status: hUnknown, Detail: err.Error()}}
	}
	f := strings.Fields(string(b))
	if len(f) < 2 {
		return []HealthItem{{Key: "cpu", Label: "Carga de CPU", Category: catPerformance, Status: hUnknown}}
	}
	load5, _ := strconv.ParseFloat(f[1], 64)
	return []HealthItem{cpuLoadItem(load5, runtime.NumCPU())}
}

func linuxMemory(context.Context) []HealthItem {
	vals := map[string]uint64{}
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return []HealthItem{{Key: "memory", Label: "Memoria", Category: catPerformance, Status: hUnknown, Detail: err.Error()}}
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		fs := strings.Fields(v)
		if len(fs) == 0 {
			continue
		}
		n, _ := strconv.ParseUint(fs[0], 10, 64)
		vals[k] = n * 1024
	}
	avail, ok := vals["MemAvailable"]
	if !ok {
		avail = vals["MemFree"] + vals["Buffers"] + vals["Cached"]
	}
	return []HealthItem{memoryItem(vals["MemTotal"], avail)}
}

// Sistemas de arquivos de disco avaliados (pseudo, rede, squashfs e overlay ficam de fora).
var linuxDiskFS = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true, "f2fs": true,
	"jfs": true, "reiserfs": true, "ntfs": true, "ntfs3": true, "fuseblk": true, "vfat": true, "exfat": true, "bcachefs": true,
}

func linuxDisks(context.Context) []HealthItem {
	f, err := os.Open("/proc/self/mounts")
	if err != nil {
		return []HealthItem{{Key: "disk", Label: "Espaco em disco", Category: catStorage, Status: hUnknown, Detail: err.Error()}}
	}
	defer f.Close()
	byDev := map[string]string{}
	var order []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) < 4 || !linuxDiskFS[fs[2]] {
			continue
		}
		dev, mnt := fs[0], unescapeMount(fs[1])
		if hasOpt(fs[3], "ro") || skipMount(mnt) {
			continue
		}
		if cur, ok := byDev[dev]; ok {
			// Subvolumes do btrfs e bind mounts: fica o ponto de montagem mais curto.
			if len(mnt) < len(cur) {
				byDev[dev] = mnt
			}
			continue
		}
		byDev[dev] = mnt
		order = append(order, dev)
	}
	var items []HealthItem
	for _, dev := range order {
		mnt := byDev[dev]
		var st unix.Statfs_t
		if err := unix.Statfs(mnt, &st); err != nil || st.Blocks == 0 {
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

func skipMount(m string) bool {
	if m == "/boot/efi" || m == "/efi" {
		return true
	}
	for _, p := range []string{"/snap/", "/run/", "/proc/", "/sys/", "/dev/", "/var/lib/docker/", "/var/lib/containers/", "/var/snap/"} {
		if strings.HasPrefix(m+"/", p) {
			return true
		}
	}
	return false
}

func hasOpt(opts, opt string) bool {
	for _, o := range strings.Split(opts, ",") {
		if o == opt {
			return true
		}
	}
	return false
}

// unescapeMount desfaz os escapes octais de /proc/self/mounts (\040 = espaco).
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

func linuxUptime(context.Context) []HealthItem {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return []HealthItem{{Key: "uptime", Label: "Tempo ligado", Category: catStability, Status: hUnknown, Detail: err.Error()}}
	}
	f := strings.Fields(string(b))
	secs, _ := strconv.ParseFloat(f[0], 64)
	return []HealthItem{uptimeItem(time.Duration(secs * float64(time.Second)))}
}

func linuxPendingReboot(ctx context.Context) []HealthItem {
	var reasons []string
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		r := "Pacotes atualizados pedem reinicio"
		if b, err := os.ReadFile("/var/run/reboot-required.pkgs"); err == nil {
			pkgs := uniqueLines(string(b))
			if len(pkgs) > 0 {
				r += " (" + joinLimited(pkgs, 5) + ")"
			}
		}
		reasons = append(reasons, r)
	}
	if path, err := exec.LookPath("needs-restarting"); err == nil && len(reasons) == 0 {
		// RHEL e derivados: codigo 1 indica reinicio necessario.
		if _, _, code, err := runCmd(ctx, nil, path, "-r"); err == nil && code == 1 {
			reasons = append(reasons, "needs-restarting -r indica reinicio necessario")
		}
	}
	// Kernel em execucao removido por uma atualizacao.
	var uts unix.Utsname
	if err := unix.Uname(&uts); err == nil {
		rel := unix.ByteSliceToString(uts.Release[:])
		if entries, err := os.ReadDir("/lib/modules"); err == nil && len(entries) > 0 {
			if _, err := os.Stat(filepath.Join("/lib/modules", rel)); err != nil {
				reasons = append(reasons, "O kernel em execucao ("+rel+") foi substituido por uma atualizacao")
			}
		}
	}
	return []HealthItem{rebootItem(reasons)}
}

func uniqueLines(s string) []string {
	seen := map[string]bool{}
	var out []string
	for _, l := range strings.Split(s, "\n") {
		l = strings.TrimSpace(l)
		if l != "" && !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	return out
}

// linuxFailedUnits conta as unidades do systemd em estado failed (fora do systemd o item nao se aplica).
func linuxFailedUnits(ctx context.Context) []HealthItem {
	path, err := exec.LookPath("systemctl")
	if err != nil {
		return nil
	}
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return nil
	}
	out, _, code, err := runCmd(ctx, []string{"LC_ALL=C", "SYSTEMD_COLORS=0"}, path, "list-units", "--state=failed", "--no-legend", "--plain", "--no-pager")
	if err != nil || code != 0 {
		return []HealthItem{{Key: "services", Label: "Unidades do systemd com falha", Category: catStability, Status: hUnknown, Detail: "systemctl falhou"}}
	}
	var failed []string
	for _, l := range strings.Split(out, "\n") {
		f := strings.Fields(l)
		if len(f) == 0 {
			continue
		}
		u := strings.TrimLeft(f[0], "\u25cf* ")
		if u == "" && len(f) > 1 {
			u = f[1]
		}
		if u != "" {
			failed = append(failed, u)
		}
	}
	return []HealthItem{servicesItem("Unidades do systemd com falha", failed)}
}

// linuxJournalErrors conta mensagens de prioridade err ou mais grave nas ultimas 24 h.
func linuxJournalErrors(ctx context.Context) []HealthItem {
	path, err := exec.LookPath("journalctl")
	if err != nil {
		return nil
	}
	out, _, code, err := runCmd(ctx, []string{"LC_ALL=C", "SYSTEMD_COLORS=0"}, path,
		"-p", "err", "--since", "-24h", "-q", "--no-pager", "-o", "short-iso", "-n", "5000")
	if err != nil || code != 0 {
		return []HealthItem{{Key: "system_errors", Label: "Erros de sistema (24 h)", Category: catStability, Status: hUnknown, Detail: "journalctl falhou"}}
	}
	count := 0
	bySource := map[string]int{}
	for _, l := range strings.Split(out, "\n") {
		if strings.TrimSpace(l) == "" || strings.HasPrefix(l, "-- ") {
			continue
		}
		count++
		bySource[journalIdent(l)]++
	}
	return []HealthItem{errorsItem(count, bySource, 0)}
}

// journalIdent extrai o identificador de "2026-10-05T10:00:00-0300 host ident[123]: msg".
func journalIdent(l string) string {
	f := strings.SplitN(l, " ", 4)
	if len(f) < 3 {
		return "?"
	}
	id := f[2]
	if i := strings.IndexAny(id, "[:"); i > 0 {
		id = id[:i]
	}
	return strings.TrimRight(id, "]")
}

// linuxUpdates conta pacotes atualizaveis pelo apt (simulacao, sem trava) ou pelo dnf/yum (cache local).
func linuxUpdates(ctx context.Context) []HealthItem {
	env := []string{"LC_ALL=C", "DEBIAN_FRONTEND=noninteractive"}
	unknown := func(d string) []HealthItem {
		return []HealthItem{{Key: "updates", Label: "Atualizacoes pendentes", Category: catSecurity, Status: hUnknown, Detail: d}}
	}
	if _, err := os.Stat("/usr/lib/update-notifier/apt-check"); err == nil {
		_, errOut, _, err := runCmd(ctx, env, "/usr/lib/update-notifier/apt-check")
		if err == nil {
			var total, sec int
			if n, _ := fmt.Sscanf(strings.TrimSpace(lastLine(errOut)), "%d;%d", &total, &sec); n == 2 {
				return []HealthItem{updatesItem(total, sec, "apt (update-notifier)")}
			}
		}
	}
	if path, err := exec.LookPath("apt-get"); err == nil {
		out, _, code, err := runCmd(ctx, env, path, "-s", "-q", "-o", "Debug::NoLocking=true", "dist-upgrade")
		if err != nil || code != 0 {
			return unknown("apt-get -s dist-upgrade falhou")
		}
		var total, sec int
		for _, l := range strings.Split(out, "\n") {
			if strings.HasPrefix(l, "Inst ") {
				total++
				if strings.Contains(strings.ToLower(l), "security") {
					sec++
				}
			}
		}
		return []HealthItem{updatesItem(total, sec, "apt; lista de pacotes da ultima atualizacao do cache")}
	}
	for _, tool := range []string{"dnf", "yum"} {
		path, err := exec.LookPath(tool)
		if err != nil {
			continue
		}
		out, _, code, err := runCmd(ctx, env, path, "-q", "-C", "check-update")
		if err != nil || (code != 0 && code != 100) {
			return unknown(tool + " check-update falhou (cache local ausente?)")
		}
		total := countDnfPackages(out)
		sec := 0
		if total > 0 {
			if sout, _, scode, serr := runCmd(ctx, env, path, "-q", "-C", "updateinfo", "list", "--security"); serr == nil && scode == 0 {
				sec = countDnfSecurity(sout)
			}
		}
		return []HealthItem{updatesItem(total, sec, tool+"; cache local de metadados")}
	}
	return nil
}

// countDnfPackages conta linhas de pacote (3 colunas) ate a secao de obsoletos.
func countDnfPackages(out string) int {
	n := 0
	for _, l := range strings.Split(out, "\n") {
		if strings.HasPrefix(l, "Obsoleting") {
			break
		}
		f := strings.Fields(l)
		if len(f) == 3 && strings.Contains(f[0], ".") {
			n++
		}
	}
	return n
}

// countDnfSecurity conta pacotes distintos em "ID-do-aviso Nivel/Sec. pacote".
func countDnfSecurity(out string) int {
	seen := map[string]bool{}
	for _, l := range strings.Split(out, "\n") {
		f := strings.Fields(l)
		if len(f) == 3 && strings.HasSuffix(f[1], "Sec.") {
			seen[f[2]] = true
		}
	}
	return len(seen)
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return lines[len(lines)-1]
}
