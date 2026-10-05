package actions

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// psRow e uma linha do ps (usado no macOS e em outros Unix sem /proc).
type psRow struct {
	pid    int
	rssKiB int64
	cpu    time.Duration
	user   string
	name   string
}

// parsePS interpreta linhas "pid rss time user comm"; comm e o caminho do executavel (fica o nome base).
func parsePS(out string) []psRow {
	rows := []psRow{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		pid, err := strconv.Atoi(f[0])
		if err != nil || pid < 0 {
			continue
		}
		rss, _ := strconv.ParseInt(f[1], 10, 64)
		if rss < 0 {
			rss = 0
		}
		comm := strings.Join(f[4:], " ")
		if i := strings.LastIndexByte(comm, '/'); i >= 0 && i < len(comm)-1 {
			comm = comm[i+1:]
		}
		rows = append(rows, psRow{pid: pid, rssKiB: rss, cpu: parseCPUTime(f[2]), user: f[3], name: comm})
	}
	return rows
}

// parseCPUTime interpreta o tempo de CPU do ps: "[[dd-]hh:]mm:ss[.ff]" (o macOS usa "mmm:ss.ff").
func parseCPUTime(s string) time.Duration {
	var days float64
	if i := strings.IndexByte(s, '-'); i > 0 {
		d, err := strconv.ParseFloat(s[:i], 64)
		if err != nil {
			return 0
		}
		days, s = d, s[i+1:]
	}
	parts := strings.Split(s, ":")
	if len(parts) > 3 {
		return 0
	}
	var total float64
	mult := 1.0
	for i := len(parts) - 1; i >= 0; i-- {
		v, err := strconv.ParseFloat(parts[i], 64)
		if err != nil || v < 0 {
			return 0
		}
		total += v * mult
		mult *= 60
	}
	total += days * 86400
	if math.IsNaN(total) || math.IsInf(total, 0) {
		return 0
	}
	return time.Duration(total * float64(time.Second))
}
