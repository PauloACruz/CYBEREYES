package inventory

import (
	"math"
	"strings"
	"testing"
	"time"
)

func TestIntervals(t *testing.T) {
	c := serverConfig{CheckinHello: 45, CheckinAgentInfo: 5, CheckinWMI: 1e9, CheckinDisks: math.NaN()}
	iv := c.intervals()
	if iv.Hello != 45*time.Second {
		t.Errorf("hello = %v", iv.Hello)
	}
	if iv.AgentInfo != time.Minute {
		t.Errorf("agentinfo abaixo do minimo = %v", iv.AgentInfo)
	}
	if iv.WMI != 24*time.Hour {
		t.Errorf("wmi acima do maximo = %v", iv.WMI)
	}
	if iv.Disks != limDisks.def || iv.Software != limSoftware.def {
		t.Errorf("ausente/invalido deve usar o padrao: %v %v", iv.Disks, iv.Software)
	}
}

func TestParseDpkg(t *testing.T) {
	out := "ii \tbash\t5.2.21-2ubuntu4\tamd64\tUbuntu Developers <ubuntu-devel@lists.ubuntu.com>\t1864\n" +
		"rc \tvelho\t1.0\tamd64\tX <x@y>\t10\n" +
		"hi \tfirefox\t130.0\tamd64\tMozilla\t\n" +
		"linha quebrada\n"
	list := parseDpkg(out)
	if len(list) != 2 {
		t.Fatalf("parseDpkg = %#v", list)
	}
	b := list[0]
	if b.Name != "bash" || b.Version != "5.2.21-2ubuntu4" || b.Publisher != "Ubuntu Developers" || b.Size != "1.8 MB" || b.Source != "dpkg" || b.Arch != "amd64" || b.Uninstall != "apt-get remove -y bash" {
		t.Errorf("bash = %#v", b)
	}
	if list[1].Size != "" {
		t.Errorf("tamanho vazio deve ficar vazio: %q", list[1].Size)
	}
}

func TestParseRpm(t *testing.T) {
	out := "bash\t5.1.8-9.el9\tx86_64\tRed Hat, Inc.\t7738634\t1700000000\ngpg-pubkey\t1-1\t(none)\t(none)\t0\t1700000000\nzlib\t1.2\tx86_64\t(none)\t100\t0\n"
	list := parseRpm(out, "dnf remove -y")
	if len(list) != 2 {
		t.Fatalf("parseRpm = %#v", list)
	}
	if list[0].Publisher != "Red Hat, Inc." || list[0].Size != "7.4 MB" || list[0].InstallDate == "" || list[0].Uninstall != "dnf remove -y bash" {
		t.Errorf("bash = %#v", list[0])
	}
	if list[1].Publisher != "" || list[1].InstallDate != "" {
		t.Errorf("(none) e data zero = %#v", list[1])
	}
}

func TestParseSnapFlatpakPacman(t *testing.T) {
	snap := "Name      Version   Rev    Tracking       Publisher   Notes\ncore22    20240111  1122   latest/stable  canonical✓  base\nfirefox   130.0     4848   latest/stable  mozilla**   -\n"
	s := parseSnap(snap)
	if len(s) != 2 || s[0].Publisher != "canonical" || s[1].Publisher != "mozilla" || s[1].Uninstall != "snap remove firefox" {
		t.Fatalf("parseSnap = %#v", s)
	}
	fp := "GNU Image Manipulation Program\torg.gimp.GIMP\t2.10.38\tflathub\n"
	f := parseFlatpak(fp)
	if len(f) != 1 || f[0].Name != "GNU Image Manipulation Program" || f[0].Version != "2.10.38" || f[0].Location != "org.gimp.GIMP" {
		t.Fatalf("parseFlatpak = %#v", f)
	}
	pac := "Name            : bash\nVersion         : 5.2.032-1\nPackager        : Levente <levente@archlinux.org>\nInstalled Size  : 9.32 MiB\nInstall Date    : Tue 06 Feb 2024 10:22:33 AM UTC\n\nName            : zstd\nVersion         : 1.5.6-1\n"
	p := parsePacman(pac)
	if len(p) != 2 || p[0].Publisher != "Levente" || p[0].Size != "9.32 MB" || p[0].InstallDate != "2024-02-06" || p[1].Name != "zstd" {
		t.Fatalf("parsePacman = %#v", p)
	}
}

func TestFormatInstallDate(t *testing.T) {
	if formatInstallDate("20240115") != "2024-01-15" || formatInstallDate("15/01/2024") != "15/01/2024" || formatInstallDate("") != "" {
		t.Fatal("formatInstallDate")
	}
}

func TestNormalizeSoftware(t *testing.T) {
	in := []Software{{Name: " zeta "}, {Name: ""}, {Name: "Alpha", Version: "1"}, {Name: "alpha", Version: "1"}, {Name: "Beta\x00", Version: "2"}}
	out := normalizeSoftware(in)
	if len(out) != 3 || out[0].Name != "Alpha" || out[1].Name != "Beta" || out[2].Name != "zeta" {
		t.Fatalf("normalize = %#v", out)
	}
	if normalizeSoftware(nil) == nil {
		t.Fatal("lista nunca pode ser nil")
	}
	big := make([]Software, maxSoftware+10)
	for i := range big {
		big[i] = Software{Name: "app", Version: string(rune('a'+i%26)) + strings.Repeat("x", i/26)}
	}
	if len(normalizeSoftware(big)) != maxSoftware {
		t.Fatal("limite")
	}
}

func TestParseMacApps(t *testing.T) {
	data := []byte(`{"SPApplicationsDataType":[
	 {"_name":"Google Chrome","version":"129.0","obtained_from":"identified_developer","path":"/Applications/Google Chrome.app","lastModified":"2024-09-30T12:00:00Z","signed_by":["Developer ID Application: Google LLC (EQHXZ8M8AV)","Developer ID Certification Authority"]},
	 {"_name":"Safari","version":"17.5","obtained_from":"apple","path":"/Applications/Safari.app"},
	 {"_name":"Ticket Viewer","obtained_from":"apple","path":"/System/Library/CoreServices/Applications/Ticket Viewer.app"},
	 {"_name":"Pages","version":"14","obtained_from":"mac_app_store","path":"/Applications/Pages.app","signed_by":["Apple Mac OS Application Signing"]}
	]}`)
	list, err := parseMacApps(data)
	if err != nil || len(list) != 3 {
		t.Fatalf("parseMacApps = %#v, %v", list, err)
	}
	if list[0].Publisher != "Google LLC" || list[0].InstallDate != "2024-09-30" || list[0].Location != "/Applications/Google Chrome.app" {
		t.Errorf("chrome = %#v", list[0])
	}
	if list[1].Publisher != "Apple" || list[2].Source != "appstore" {
		t.Errorf("safari/pages = %#v %#v", list[1], list[2])
	}
}

func TestParsePlist(t *testing.T) {
	data := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>CFBundleName</key><string>Firefox</string>
 <key>LSRequiresNativeExecution</key><true/>
 <key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeName</key><string>HTML</string></dict></array>
 <key>CFBundleShortVersionString</key><string>130.0</string>
</dict></plist>`)
	kv := parsePlistStrings(data)
	if kv["CFBundleName"] != "Firefox" || kv["CFBundleShortVersionString"] != "130.0" || kv["CFBundleTypeName"] != "" {
		t.Fatalf("plist = %#v", kv)
	}
}

func TestParseCPUInfo(t *testing.T) {
	x86 := `processor	: 0
model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz
physical id	: 0
core id		: 0
cpu cores	: 6

processor	: 1
model name	: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz
physical id	: 0
core id		: 0
cpu cores	: 6
`
	ci := parseCPUInfo(x86)
	if len(ci.Models) != 1 || ci.Models[0] != "Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz" || ci.Threads != 2 || ci.Cores != 6 {
		t.Fatalf("x86 = %#v", ci)
	}
	arm := "processor\t: 0\nBogoMIPS\t: 108.00\nCPU part\t: 0xd08\n\nprocessor\t: 1\n\nHardware\t: BCM2835\nSerial\t\t: 10000000abcdef01\nModel\t\t: Raspberry Pi 4 Model B Rev 1.4\n"
	ci = parseCPUInfo(arm)
	if len(ci.Models) != 0 || ci.Threads != 2 || ci.Serial != "10000000abcdef01" || ci.Board != "Raspberry Pi 4 Model B Rev 1.4" {
		t.Fatalf("arm = %#v", ci)
	}
	if got := parseLscpu("Architecture: aarch64\nVendor ID: ARM\nModel name: Cortex-A72\n"); got != "ARM Cortex-A72" {
		t.Fatalf("lscpu = %q", got)
	}
	if got := parseLscpu("Vendor ID: GenuineIntel\nModel name: Intel(R) Xeon(R)\n"); got != "Intel(R) Xeon(R)" {
		t.Fatalf("lscpu intel = %q", got)
	}
}

func TestParseLspci(t *testing.T) {
	out := `00:00.0 "Host bridge" "Intel Corporation" "8th Gen Core Processor Host Bridge" -r07 "Dell" "Device 085a"
00:02.0 "VGA compatible controller" "Intel Corporation" "CoffeeLake-S GT2 [UHD Graphics 630]" -r00 "Dell" "Device 085a"
01:00.0 "3D controller" "NVIDIA Corporation" "TU117M [GeForce GTX 1650 Mobile / Max-Q]" -ra1 "Dell" "Device 0a1f"
`
	g := parseLspci(out)
	if len(g) != 2 || g[0] != "Intel Corporation CoffeeLake-S GT2 [UHD Graphics 630]" || g[1] != "NVIDIA Corporation TU117M [GeForce GTX 1650 Mobile / Max-Q]" {
		t.Fatalf("lspci = %#v", g)
	}
	if pciGPUName("0x8086", "0x3e92") != "Intel GPU [8086:3e92]" || pciGPUName("0xabcd", "0x0001") != "GPU [abcd:0001]" {
		t.Fatal("pciGPUName")
	}
}

func TestMakeModelAndDisk(t *testing.T) {
	if got := linuxMakeModel("Dell Inc.", "OptiPlex 7070", ""); got != "Dell Inc. OptiPlex 7070" {
		t.Errorf("dell = %q", got)
	}
	if got := linuxMakeModel("LENOVO", "20XW0026BR", "ThinkPad X1 Carbon Gen 9"); got != "LENOVO ThinkPad X1 Carbon Gen 9 (20XW0026BR)" {
		t.Errorf("lenovo = %q", got)
	}
	if got := linuxMakeModel("To be filled by O.E.M.", "To be filled by O.E.M.", ""); got != "" {
		t.Errorf("placeholder = %q", got)
	}
	if got := linuxMakeModel("QEMU", "QEMU Standard PC (Q35 + ICH9, 2009)", ""); got != "QEMU Standard PC (Q35 + ICH9, 2009)" {
		t.Errorf("qemu = %q", got)
	}
	if got := diskLabel("ATA     ", "Samsung SSD 860 EVO 500GB", "sda", 500107862016); got != "Samsung SSD 860 EVO 500GB 500 GB" {
		t.Errorf("disk = %q", got)
	}
	if got := diskLabel("", "", "vda", 21474836480); got != "vda 21 GB" {
		t.Errorf("virtio = %q", got)
	}
}

func TestParseMacProfiler(t *testing.T) {
	data := []byte(`{
 "SPHardwareDataType":[{"_name":"hardware_overview","chip_type":"Apple M1 Pro","machine_model":"MacBookPro18,3","machine_name":"MacBook Pro","serial_number":"C02XK1ABCD12"}],
 "SPDisplaysDataType":[{"_name":"Apple M1 Pro","sppci_model":"Apple M1 Pro"}],
 "SPNVMeDataType":[{"_name":"Apple SSD Controller","_items":[{"_name":"APPLE SSD AP0512R","device_model":"APPLE SSD AP0512R","size_in_bytes":500277790720,"volumes":[{"_name":"Data","size_in_bytes":1}]}]}],
 "SPSerialATADataType":[]
}`)
	hw, err := parseMacProfiler(data)
	if err != nil {
		t.Fatal(err)
	}
	if hw.MakeModel != "Apple MacBook Pro (MacBookPro18,3)" || hw.Serial != "C02XK1ABCD12" || hw.Chip != "Apple M1 Pro" {
		t.Errorf("hw = %#v", hw)
	}
	if len(hw.GPUs) != 1 || len(hw.Disks) != 1 || hw.Disks[0] != "APPLE SSD AP0512R 500 GB" {
		t.Errorf("gpus/disks = %#v %#v", hw.GPUs, hw.Disks)
	}
}

func TestParsePublicIP(t *testing.T) {
	cases := map[string]string{
		"203.0.113.7\n":     "203.0.113.7",
		"2001:db8::1":       "2001:db8::1",
		"10.0.0.1":          "",
		"127.0.0.1":         "",
		"<html>erro</html>": "",
		"":                  "",
	}
	for in, want := range cases {
		if got := parsePublicIP(in); got != want {
			t.Errorf("parsePublicIP(%q) = %q, quero %q", in, got, want)
		}
	}
}

func TestStructsToMaps(t *testing.T) {
	type row struct {
		Caption   string
		Size      uint64
		IPEnabled bool
		IPAddress []string
		Load      float64
		hidden    int
	}
	rows := []row{{Caption: " Disco ", Size: 500107862016, IPEnabled: true, Load: math.NaN(), hidden: 1}}
	got := structsToMaps(&rows)
	if len(got) != 1 {
		t.Fatalf("structsToMaps = %#v", got)
	}
	m := got[0]
	if m["Caption"] != "Disco" || m["Size"] != uint64(500107862016) || m["IPEnabled"] != true || m["Load"] != 0.0 {
		t.Errorf("mapa = %#v", m)
	}
	if ips, ok := m["IPAddress"].([]any); !ok || ips == nil || len(ips) != 0 {
		t.Errorf("lista nula deve virar vazia: %#v", m["IPAddress"])
	}
	if _, ok := m["hidden"]; ok {
		t.Error("campo nao exportado vazou")
	}
}
