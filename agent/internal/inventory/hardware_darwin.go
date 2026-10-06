//go:build darwin

package inventory

import (
	"context"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

var ioregSerial = regexp.MustCompile(`"IOPlatformSerialNumber"\s*=\s*"([^"]+)"`)

// collectHardware monta o mapa plano que o servidor le no macOS (make_model, serialnumber,
// cpus, gpus, disks, local_ips) a partir do sysctl, system_profiler e ioreg.
func collectHardware(ctx context.Context) map[string]any {
	var hw macHardware
	if out, err := sysinfo.Output(ctx, 60*time.Second, "/usr/sbin/system_profiler", "-json",
		"SPHardwareDataType", "SPDisplaysDataType", "SPNVMeDataType", "SPSerialATADataType"); err == nil {
		hw, _ = parseMacProfiler([]byte(out))
	}
	if hw.MakeModel == "" {
		if m, err := unix.Sysctl("hw.model"); err == nil && m != "" {
			hw.MakeModel = "Apple " + strings.TrimSpace(m)
			hw.Model = strings.TrimSpace(m)
		}
	}
	if sysinfo.CleanValue(hw.Serial) == "" {
		if out, err := sysinfo.Output(ctx, 15*time.Second, "/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"); err == nil {
			if m := ioregSerial.FindStringSubmatch(out); m != nil {
				hw.Serial = m[1]
			}
		}
	}
	cpus := []string{}
	if b, err := unix.Sysctl("machdep.cpu.brand_string"); err == nil && strings.TrimSpace(b) != "" {
		cpus = append(cpus, strings.TrimSpace(b))
	} else if hw.Chip != "" {
		cpus = append(cpus, hw.Chip)
	}
	cores, _ := unix.SysctlUint32("hw.physicalcpu")
	threads, _ := unix.SysctlUint32("hw.logicalcpu")
	return map[string]any{
		"make_model":   hw.MakeModel,
		"serialnumber": sysinfo.CleanValue(hw.Serial),
		"cpus":         cpus,
		"gpus":         nonNil(hw.GPUs),
		"disks":        nonNil(hw.Disks),
		"local_ips":    nonNil(sysinfo.LocalIPs()),
		"nics":         sysinfo.NICs(),
		"manufacturer": "Apple",
		"model":        hw.Model,
		"cpu_cores":    cores,
		"cpu_threads":  threads,
		"total_ram_gb": sysinfo.TotalRAMGB(),
		"os":           sysinfo.OSName(),
	}
}
