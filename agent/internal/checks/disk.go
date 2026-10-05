package checks

import (
	"fmt"
	"strings"
)

// diskUsage e o espaco de um disco (bytes) e o percentual usado.
type diskUsage struct {
	Total       uint64
	Free        uint64
	Used        uint64
	PercentUsed float64
}

// readDisk le o disco; substituivel nos testes.
var readDisk = platformDiskUsage

// diskCheck monta o resultado do check diskspace: exists, percent_used e more_info.
func diskCheck(c Check) map[string]any {
	name := c.Disk
	if name == "" {
		return map[string]any{"exists": false, "percent_used": 0, "more_info": "Disco nao informado no check"}
	}
	u, err := readDisk(name)
	if err != nil {
		return map[string]any{"exists": false, "percent_used": 0, "more_info": fmt.Sprintf("Disco %s nao encontrado: %v", name, err)}
	}
	free := 100 - u.PercentUsed
	return map[string]any{
		"exists":       true,
		"percent_used": round2(u.PercentUsed),
		"more_info": fmt.Sprintf("Total: %s, Usado: %s, Livre: %s (%.1f%% livre)",
			humanBytes(u.Total), humanBytes(u.Used), humanBytes(u.Free), free),
	}
}

// usageFrom calcula o percentual usado como o df: usado / (usado + disponivel ao usuario).
func usageFrom(total, free, avail uint64) diskUsage {
	if free > total {
		free = total
	}
	used := total - free
	u := diskUsage{Total: total, Free: avail, Used: used}
	if den := used + avail; den > 0 {
		u.PercentUsed = clampPercent(100 * float64(used) / float64(den))
	}
	return u
}

// humanBytes formata em base 1024 com uma casa decimal.
func humanBytes(b uint64) string {
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	v := float64(b)
	i := 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d B", b)
	}
	s := fmt.Sprintf("%.1f", v)
	s = strings.TrimSuffix(s, ".0")
	return s + " " + units[i]
}
