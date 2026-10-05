package inventory

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
)

// Interpretadores do inventario de hardware de Linux e macOS. Ficam sem tag de build para os testes.

// cpuInfo resume /proc/cpuinfo.
type cpuInfo struct {
	Models  []string // modelos distintos (um por soquete, sem repetir)
	Threads int
	Cores   int
	Serial  string // Raspberry Pi e outras placas ARM
	Board   string // linha "Model" (placas ARM)
}

// parseCPUInfo interpreta /proc/cpuinfo de x86 e ARM.
func parseCPUInfo(data string) cpuInfo {
	var ci cpuInfo
	seenModel := map[string]bool{}
	cores := map[string]bool{}
	coresPerSocket := map[string]int{}
	phys, core := "", ""
	for _, line := range strings.Split(data, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "processor":
			ci.Threads++
			phys, core = "", ""
		case "model name", "cpu model":
			if v != "" && !seenModel[v] {
				seenModel[v] = true
				ci.Models = append(ci.Models, strings.Join(strings.Fields(v), " "))
			}
		case "physical id":
			phys = v
		case "core id":
			core = v
			cores[phys+"/"+core] = true
		case "cpu cores":
			var n int
			if _, err := fmt.Sscan(v, &n); err == nil {
				coresPerSocket[phys] = n
			}
		case "Serial":
			ci.Serial = v
		case "Model":
			ci.Board = v
		}
	}
	ci.Cores = len(cores)
	if sum := 0; len(coresPerSocket) > 0 {
		for _, n := range coresPerSocket {
			sum += n
		}
		if sum > ci.Cores {
			ci.Cores = sum
		}
	}
	if ci.Cores == 0 {
		ci.Cores = ci.Threads
	}
	return ci
}

// parseLscpu devolve "Vendor ID" e "Model name" do lscpu (usado em ARM, onde o cpuinfo nao tem nome).
func parseLscpu(out string) string {
	vendor, model := "", ""
	for _, line := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "Vendor ID":
			if vendor == "" {
				vendor = strings.TrimSpace(v)
			}
		case "Model name":
			if model == "" {
				model = strings.TrimSpace(v)
			}
		}
	}
	if model == "" || model == "-" {
		return ""
	}
	if vendor != "" && !strings.Contains(strings.ToLower(model), strings.ToLower(vendor)) && !strings.HasPrefix(vendor, "Genuine") && !strings.HasPrefix(vendor, "Authentic") {
		return vendor + " " + model
	}
	return model
}

// splitQuoted divide uma linha do lspci -mm em campos (aspas agrupam).
func splitQuoted(line string) []string {
	var out []string
	var b strings.Builder
	inQ, has := false, false
	for _, r := range line {
		switch {
		case r == '"':
			inQ = !inQ
			has = true
		case r == ' ' && !inQ:
			if has {
				out = append(out, b.String())
				b.Reset()
				has = false
			}
		default:
			b.WriteRune(r)
			has = true
		}
	}
	if has {
		out = append(out, b.String())
	}
	return out
}

// parseLspci tira as placas de video da saida de "lspci -mm".
func parseLspci(out string) []string {
	gpus := []string{}
	for _, line := range strings.Split(out, "\n") {
		f := splitQuoted(strings.TrimSpace(line))
		if len(f) < 4 {
			continue
		}
		class := strings.ToLower(f[1])
		if !strings.Contains(class, "vga") && !strings.Contains(class, "3d controller") && !strings.Contains(class, "display controller") {
			continue
		}
		gpus = append(gpus, strings.TrimSpace(f[2]+" "+f[3]))
	}
	return gpus
}

// pciVendors traduz os fabricantes de video mais comuns quando o lspci nao existe.
var pciVendors = map[string]string{
	"0x8086": "Intel", "0x10de": "NVIDIA", "0x1002": "AMD", "0x1af4": "Red Hat Virtio", "0x15ad": "VMware",
	"0x1234": "QEMU", "0x80ee": "VirtualBox", "0x1414": "Microsoft Hyper-V", "0x102b": "Matrox", "0x1a03": "ASPEED",
	"0x1013": "Cirrus Logic", "0x5333": "S3",
}

// pciGPUName monta o nome a partir dos ids do sysfs ("Intel GPU [8086:3e92]").
func pciGPUName(vendor, device string) string {
	vendor, device = strings.ToLower(strings.TrimSpace(vendor)), strings.ToLower(strings.TrimSpace(device))
	name := pciVendors[vendor]
	if name == "" {
		name = "GPU"
	} else {
		name += " GPU"
	}
	return fmt.Sprintf("%s [%s:%s]", name, strings.TrimPrefix(vendor, "0x"), strings.TrimPrefix(device, "0x"))
}

// linuxMakeModel junta fabricante e modelo do DMI. A Lenovo poe o nome comercial em product_version.
func linuxMakeModel(vendor, product, version string) string {
	vendor, product, version = sysinfo.CleanValue(vendor), sysinfo.CleanValue(product), sysinfo.CleanValue(version)
	if strings.EqualFold(vendor, "lenovo") && version != "" && !strings.EqualFold(version, product) {
		if product != "" {
			product = version + " (" + product + ")"
		} else {
			product = version
		}
	}
	if vendor != "" && product != "" && strings.HasPrefix(strings.ToLower(product), strings.ToLower(vendor)) {
		return product
	}
	return strings.TrimSpace(vendor + " " + product)
}

// diskLabel monta "<modelo> <N> GB" no mesmo formato que o servidor usa com o WMI.
func diskLabel(vendor, model, name string, bytes uint64) string {
	vendor, model = strings.TrimSpace(vendor), strings.TrimSpace(model)
	switch strings.ToUpper(vendor) {
	case "ATA", "", "NVME", "0X1AF4":
		vendor = ""
	}
	label := strings.TrimSpace(vendor + " " + model)
	if label == "" {
		label = name
	}
	return strings.Join(strings.Fields(label), " ") + " " + sysinfo.FormatDecimalGB(bytes)
}

// macHardware e o que interessa do system_profiler -json SPHardwareDataType SPDisplaysDataType
// SPNVMeDataType SPSerialATADataType.
type macHardware struct {
	MakeModel string
	Model     string
	Serial    string
	Chip      string
	GPUs      []string
	Disks     []string
}

func parseMacProfiler(data []byte) (macHardware, error) {
	var hw macHardware
	var doc map[string][]map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		return hw, err
	}
	for _, h := range doc["SPHardwareDataType"] {
		name, model := str(h, "machine_name"), str(h, "machine_model")
		hw.Model = model
		switch {
		case name != "" && model != "":
			hw.MakeModel = "Apple " + name + " (" + model + ")"
		case name != "":
			hw.MakeModel = "Apple " + name
		case model != "":
			hw.MakeModel = "Apple " + model
		}
		hw.Serial = str(h, "serial_number")
		hw.Chip = str(h, "chip_type")
		if hw.Chip == "" {
			hw.Chip = str(h, "cpu_type")
		}
		break
	}
	seen := map[string]bool{}
	for _, d := range doc["SPDisplaysDataType"] {
		g := str(d, "sppci_model")
		if g == "" {
			g = str(d, "_name")
		}
		if g != "" && !seen[g] {
			seen[g] = true
			hw.GPUs = append(hw.GPUs, g)
		}
	}
	for _, key := range []string{"SPNVMeDataType", "SPSerialATADataType"} {
		for _, ctrl := range doc[key] {
			collectMacDisks(ctrl, &hw.Disks)
		}
	}
	return hw, nil
}

// collectMacDisks percorre os _items dos controladores ate achar os discos (com size_in_bytes).
func collectMacDisks(node map[string]any, out *[]string) {
	if size, ok := node["size_in_bytes"].(float64); ok && size > 0 {
		name := str(node, "device_model")
		if name == "" {
			name = str(node, "_name")
		}
		*out = append(*out, diskLabel("", name, "disk", uint64(size)))
		return
	}
	items, _ := node["_items"].([]any)
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			collectMacDisks(m, out)
		}
	}
}

func str(m map[string]any, k string) string {
	if s, ok := m[k].(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

// nonNil garante lista vazia (e nao nula) no JSON enviado.
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
