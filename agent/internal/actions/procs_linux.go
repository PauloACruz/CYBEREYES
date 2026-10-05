//go:build linux

package actions

import (
	"bytes"
	"context"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// userHZ e o tique de /proc/<pid>/stat: fixo em 100 na ABI do Linux em todas as arquiteturas suportadas.
const userHZ = 100

// listProcs le /proc duas vezes para medir CPU e devolve os processos.
func listProcs(ctx context.Context) ([]Proc, error) {
	first, second, elapsed, err := sampleCPU(ctx, readLinuxTimes)
	if err != nil {
		return nil, err
	}
	page := int64(os.Getpagesize())
	users := map[string]string{}
	out := make([]Proc, 0, len(second))
	for pid := range second {
		st, err := readStat(pid)
		if err != nil {
			continue // processo terminou
		}
		out = append(out, Proc{
			PID:        pid,
			Name:       procName(pid, st.comm),
			Username:   procUser(pid, users),
			MemBytes:   st.rss * page,
			CPUPercent: usage(pid, first, second, elapsed),
		})
	}
	return out, nil
}

func readLinuxTimes() (procTimes, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	out := procTimes{}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid <= 0 {
			continue
		}
		st, err := readStat(pid)
		if err != nil {
			continue
		}
		out[pid] = time.Duration(st.ticks) * time.Second / userHZ
	}
	return out, nil
}

type linuxStat struct {
	comm  string
	ticks uint64 // utime + stime
	rss   int64  // paginas
}

func readStat(pid int) (linuxStat, error) {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return linuxStat{}, err
	}
	return parseStat(b)
}

// parseStat interpreta /proc/<pid>/stat. O nome fica entre o primeiro "(" e o ultimo ")"
// (pode ter espacos e parenteses); depois vem o estado (campo 3).
func parseStat(b []byte) (linuxStat, error) {
	open := bytes.IndexByte(b, '(')
	end := bytes.LastIndexByte(b, ')')
	if open < 0 || end < open {
		return linuxStat{}, os.ErrInvalid
	}
	f := strings.Fields(string(b[end+1:]))
	// f[0] = campo 3 (estado); utime = campo 14, stime = 15, rss = 24.
	if len(f) < 22 {
		return linuxStat{}, os.ErrInvalid
	}
	ut, _ := strconv.ParseUint(f[11], 10, 64)
	stt, _ := strconv.ParseUint(f[12], 10, 64)
	rss, _ := strconv.ParseInt(f[21], 10, 64)
	if rss < 0 {
		rss = 0
	}
	return linuxStat{comm: string(b[open+1 : end]), ticks: ut + stt, rss: rss}, nil
}

// procName usa o comm (ate 15 caracteres); quando cortado, tenta o nome do executavel na linha de comando.
func procName(pid int, comm string) string {
	if len(comm) < 15 {
		return comm
	}
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cmdline")
	if err != nil || len(b) == 0 {
		return comm
	}
	if i := bytes.IndexByte(b, 0); i >= 0 {
		b = b[:i]
	}
	base := filepath.Base(string(b))
	if strings.HasPrefix(base, comm) {
		return base
	}
	return comm
}

// procUser devolve o nome do usuario efetivo (linha Uid de /proc/<pid>/status).
func procUser(pid int, cache map[string]string) string {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/status")
	if err != nil {
		return ""
	}
	uid := statusUID(b)
	if uid == "" {
		return ""
	}
	if name, ok := cache[uid]; ok {
		return name
	}
	name := uid
	if u, err := user.LookupId(uid); err == nil {
		name = u.Username
	}
	cache[uid] = name
	return name
}

// statusUID extrai o UID efetivo (segundo numero da linha "Uid:").
func statusUID(b []byte) string {
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			f := strings.Fields(line[4:])
			if len(f) >= 2 {
				return f[1]
			}
			if len(f) == 1 {
				return f[0]
			}
		}
	}
	return ""
}
