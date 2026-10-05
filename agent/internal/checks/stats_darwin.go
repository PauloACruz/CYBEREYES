//go:build darwin

package checks

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// No macOS os contadores de CPU so saem pela API Mach (cgo); o EYES le o resumo do top.
func newCPUSource() cpuSource { return topSource{} }

type topSource struct{}

var topIdle = regexp.MustCompile(`CPU usage:.*?([\d.]+)% idle`)

// next roda "top -l 2 -n 0 -s 1": a segunda amostra cobre o ultimo segundo.
func (topSource) next(ctx context.Context) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/top", "-l", "2", "-n", "0", "-s", "1").Output()
	if err != nil {
		return 0, err
	}
	m := topIdle.FindAllStringSubmatch(string(out), -1)
	if len(m) == 0 {
		return 0, errors.New("saida do top sem uso de CPU")
	}
	idle, err := strconv.ParseFloat(m[len(m)-1][1], 64)
	if err != nil {
		return 0, err
	}
	return clampPercent(100 - idle), nil
}

var vmPageSize = regexp.MustCompile(`page size of (\d+) bytes`)

// readMemPercent usa hw.memsize e vm_stat: disponivel = livre + inativa + especulativa.
func readMemPercent() (float64, error) {
	total, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/vm_stat").Output()
	if err != nil {
		return 0, err
	}
	page := 4096.0
	if m := vmPageSize.FindStringSubmatch(string(out)); m != nil {
		if n, err := strconv.ParseFloat(m[1], 64); err == nil && n > 0 {
			page = n
		}
	}
	var pages float64
	for _, line := range strings.Split(string(out), "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Pages free", "Pages inactive", "Pages speculative":
			n, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(val), "."), 64)
			if err == nil {
				pages += n
			}
		}
	}
	if total == 0 {
		return 0, errors.New("hw.memsize zerado")
	}
	return clampPercent(100 * (float64(total) - pages*page) / float64(total)), nil
}
