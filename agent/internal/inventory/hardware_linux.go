//go:build linux

package inventory

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

// collectHardware monta o mapa plano que o servidor le no Linux (make_model, serialnumber,
// cpus, gpus, disks, local_ips). Cada sonda e de melhor esforco.
func collectHardware(ctx context.Context) map[string]any {
	dmi := func(n string) string { return readTrim(filepath.Join("/sys/class/dmi/id", n)) }
	ci := cpuInfo{}
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		ci = parseCPUInfo(string(data))
	}

	vendor, product, version := dmi("sys_vendor"), dmi("product_name"), dmi("product_version")
	if sysinfo.CleanValue(vendor) == "" && sysinfo.CleanValue(product) == "" {
		vendor, product, version = dmi("board_vendor"), dmi("board_name"), ""
	}
	makeModel := linuxMakeModel(vendor, product, version)
	if makeModel == "" {
		makeModel = deviceTreeString("model")
	}
	if makeModel == "" {
		makeModel = ci.Board
	}

	serial := ""
	for _, s := range []string{dmi("product_serial"), dmi("chassis_serial"), dmi("board_serial"), deviceTreeString("serial-number"), ci.Serial} {
		if s = sysinfo.CleanValue(s); s != "" {
			serial = s
			break
		}
	}

	cpus := ci.Models
	if len(cpus) == 0 {
		if out, err := sysinfo.Output(ctx, 10*time.Second, "lscpu"); err == nil {
			if m := parseLscpu(out); m != "" {
				cpus = []string{m}
			}
		}
	}
	if len(cpus) == 0 && ci.Threads > 0 {
		cpus = []string{runtime.GOARCH + " (" + strconv.Itoa(ci.Threads) + " threads)"}
	}

	w := map[string]any{
		"make_model":   makeModel,
		"serialnumber": serial,
		"cpus":         nonNil(cpus),
		"gpus":         nonNil(linuxGPUs(ctx)),
		"disks":        nonNil(linuxDisks()),
		"local_ips":    nonNil(sysinfo.LocalIPs()),
		"manufacturer": sysinfo.CleanValue(vendor),
		"model":        sysinfo.CleanValue(product),
		"bios_version": dmi("bios_version"),
		"bios_date":    dmi("bios_date"),
		"cpu_cores":    ci.Cores,
		"cpu_threads":  ci.Threads,
		"total_ram_gb": sysinfo.TotalRAMGB(),
		"os":           sysinfo.OSName(),
	}
	return w
}

func readTrim(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Trim(string(data), "\x00\n "))
}

// deviceTreeString le um texto do device tree (placas ARM como Raspberry Pi).
func deviceTreeString(name string) string {
	for _, base := range []string{"/proc/device-tree", "/sys/firmware/devicetree/base"} {
		if s := readTrim(filepath.Join(base, name)); s != "" {
			return s
		}
	}
	return ""
}

// linuxGPUs usa o lspci; sem ele, le as classes PCI 0x03 do sysfs e, por fim, os drivers DRM.
func linuxGPUs(ctx context.Context) []string {
	if _, err := exec.LookPath("lspci"); err == nil {
		if out, err := sysinfo.Output(ctx, 10*time.Second, "lspci", "-mm"); err == nil {
			if g := parseLspci(out); len(g) > 0 {
				return g
			}
		}
	}
	var gpus []string
	devs, _ := filepath.Glob("/sys/bus/pci/devices/*")
	for _, d := range devs {
		if strings.HasPrefix(readTrim(filepath.Join(d, "class")), "0x03") {
			gpus = append(gpus, pciGPUName(readTrim(filepath.Join(d, "vendor")), readTrim(filepath.Join(d, "device"))))
		}
	}
	if len(gpus) > 0 {
		return gpus
	}
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*")
	seen := map[string]bool{}
	for _, c := range cards {
		if strings.Contains(filepath.Base(c), "-") {
			continue
		}
		if link, err := os.Readlink(filepath.Join(c, "device", "driver")); err == nil {
			drv := filepath.Base(link)
			if !seen[drv] {
				seen[drv] = true
				gpus = append(gpus, drv)
			}
		}
	}
	return gpus
}

// linuxDisks lista os discos fisicos de /sys/block com modelo e tamanho.
func linuxDisks() []string {
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		name := e.Name()
		if skipBlockDevice(name) {
			continue
		}
		base := filepath.Join("/sys/block", name)
		sectors, err := strconv.ParseUint(readTrim(filepath.Join(base, "size")), 10, 64)
		if err != nil || sectors == 0 {
			continue
		}
		model := readTrim(filepath.Join(base, "device", "model"))
		if model == "" {
			model = readTrim(filepath.Join(base, "device", "name")) // cartoes SD e eMMC
		}
		vendor := readTrim(filepath.Join(base, "device", "vendor"))
		out = append(out, diskLabel(vendor, model, name, sectors*512))
	}
	return out
}

func skipBlockDevice(name string) bool {
	for _, p := range []string{"loop", "ram", "zram", "dm-", "md", "sr", "fd", "nbd", "zd"} {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return strings.Contains(name, "boot") || strings.Contains(name, "rpmb")
}
