//go:build linux

package checks

import (
	"bufio"
	"errors"
	"os"
	"strconv"
	"strings"
)

func newCPUSource() cpuSource { return &timesSource{read: readCPUTimes} }

// readCPUTimes le a linha "cpu" de /proc/stat.
func readCPUTimes() (cpuTimes, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	return parseProcStat(string(data))
}

// parseProcStat soma user, nice, system, idle, iowait, irq, softirq e steal da linha agregada.
// guest e guest_nice ja estao contidos em user e nice.
func parseProcStat(data string) (cpuTimes, error) {
	for _, line := range strings.Split(data, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 || f[0] != "cpu" {
			continue
		}
		var v [8]float64
		for i := 0; i < 8 && i+1 < len(f); i++ {
			n, err := strconv.ParseFloat(f[i+1], 64)
			if err != nil {
				return cpuTimes{}, err
			}
			v[i] = n
		}
		var t cpuTimes
		for _, n := range v {
			t.Total += n
		}
		t.Idle = v[3] + v[4]
		return t, nil
	}
	return cpuTimes{}, errors.New("linha cpu ausente em /proc/stat")
}

// readMemPercent calcula o uso de memoria por /proc/meminfo (MemTotal - MemAvailable).
func readMemPercent() (float64, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	defer f.Close()
	vals := map[string]float64{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		key, rest, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		if n, err := strconv.ParseFloat(fields[0], 64); err == nil {
			vals[key] = n
		}
	}
	return memPercentFromInfo(vals)
}

func memPercentFromInfo(vals map[string]float64) (float64, error) {
	total := vals["MemTotal"]
	if total <= 0 {
		return 0, errors.New("MemTotal ausente em /proc/meminfo")
	}
	avail, ok := vals["MemAvailable"]
	if !ok {
		// Kernels antigos (< 3.14) nao tem MemAvailable.
		avail = vals["MemFree"] + vals["Buffers"] + vals["Cached"]
	}
	return clampPercent(100 * (total - avail) / total), nil
}
