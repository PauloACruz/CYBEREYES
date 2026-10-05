package sysinfo

import (
	"context"
	"math"
	"net"
	"testing"
)

func TestFormatBytes(t *testing.T) {
	cases := map[uint64]string{
		0:                       "0 B",
		512:                     "512 B",
		1024:                    "1 KB",
		1536:                    "1.5 KB",
		12900000:                "12.3 MB",
		100 << 30:               "100 GB",
		uint64(1.5 * (1 << 40)): "1.5 TB",
	}
	for in, want := range cases {
		if got := FormatBytes(in); got != want {
			t.Errorf("FormatBytes(%d) = %q, quero %q", in, got, want)
		}
	}
	if got := FormatDecimalGB(500107862016); got != "500 GB" {
		t.Errorf("FormatDecimalGB = %q", got)
	}
}

func TestRoundNaN(t *testing.T) {
	if Round(math.NaN(), 2) != 0 || Round(math.Inf(1), 2) != 0 {
		t.Fatal("NaN/Inf precisam virar 0")
	}
	if Round(15.556, 2) != 15.56 {
		t.Fatal("arredondamento errado")
	}
}

func TestPercent(t *testing.T) {
	d := DiskUsage{Total: 100, Used: 40, Free: 50}
	if p := d.Percent(); p != 44.4 {
		t.Fatalf("percent = %v", p)
	}
	if (DiskUsage{}).Percent() != 0 {
		t.Fatal("disco vazio deve dar 0")
	}
}

func TestCleanValue(t *testing.T) {
	for _, s := range []string{"To be filled by O.E.M.", "Default string", "System Serial Number", "0", " none ", "N/A", "0000000", "\x00"} {
		if CleanValue(s) != "" {
			t.Errorf("CleanValue(%q) deveria ser vazio", s)
		}
	}
	if CleanValue(" PF2ABCDE \n") != "PF2ABCDE" {
		t.Error("serie valida alterada")
	}
}

func TestParseMounts(t *testing.T) {
	data := `sysfs /sys sysfs rw 0 0
/dev/nvme0n1p2 / ext4 rw,relatime 0 0
/dev/nvme0n1p1 /boot/efi vfat rw 0 0
/dev/loop3 /snap/core/1 squashfs ro 0 0
tmpfs /run tmpfs rw 0 0
/dev/sda1 /mnt/meu\040disco ntfs3 rw 0 0
/dev/nvme0n1p2 /home ext4 rw 0 0
overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0
/dev/sdb1 /var/lib/docker btrfs rw 0 0
rpool/ROOT/ubuntu / zfs rw 0 0
`
	got := parseMounts(data)
	want := []mountEntry{
		{"/dev/nvme0n1p2", "/", "ext4"},
		{"/dev/nvme0n1p1", "/boot/efi", "vfat"},
		{"/dev/sda1", "/mnt/meu disco", "ntfs3"},
		{"/dev/sdb1", "/var/lib/docker", "btrfs"},
		{"rpool/ROOT/ubuntu", "/", "zfs"},
	}
	if len(got) != len(want) {
		t.Fatalf("parseMounts = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("item %d = %#v, quero %#v", i, got[i], want[i])
		}
	}
}

func TestOSRelease(t *testing.T) {
	data := "NAME=\"Ubuntu\"\nVERSION=\"24.04.1 LTS (Noble Numbat)\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\n"
	if got := osReleaseName(data); got != "Ubuntu 24.04.1 LTS" {
		t.Fatalf("osReleaseName = %q", got)
	}
	if got := osReleaseName("NAME=Alpine\nVERSION='3.20'\n"); got != "Alpine 3.20" {
		t.Fatalf("osReleaseName sem PRETTY_NAME = %q", got)
	}
	if procStatBootTime("cpu 1 2 3\nbtime 1727000000\nprocesses 5\n") != 1727000000 {
		t.Fatal("btime")
	}
}

func TestLoginctlWho(t *testing.T) {
	lc := `     c1  120 gdm     seat0 tty1
      3 1000 joao   -     pts/0
      5 1001 maria  seat0 tty2
`
	if got := parseLoginctl(lc); got != "maria" {
		t.Fatalf("parseLoginctl = %q", got)
	}
	if got := parseLoginctl("3 1000 joao\n"); got != "joao" {
		t.Fatalf("parseLoginctl sem seat = %q", got)
	}
	if got := parseLoginctl(""); got != "" {
		t.Fatal("sem sessoes deve ser vazio")
	}
	who := "joao     pts/0        2026-10-05 10:00 (10.0.0.9)\nroot     tty1         2026-10-05 09:00\n"
	if got := parseWho(who); got != "root" {
		t.Fatalf("parseWho = %q", got)
	}
}

func TestFormatWindowsOS(t *testing.T) {
	got := formatWindowsOS("Windows 10 Pro", "23H2", "22631", 4317, true)
	if got != "Windows 11 Pro, 64 bit v23H2 (build 22631.4317)" {
		t.Fatalf("Windows 11 = %q", got)
	}
	got = formatWindowsOS("Windows Server 2019 Standard", "", "17763", 0, true)
	if got != "Windows Server 2019 Standard, 64 bit (build 17763)" {
		t.Fatalf("Server = %q", got)
	}
}

func TestServiceMaps(t *testing.T) {
	if ServiceStatus(4) != "running" || ServiceStatus(1) != "stopped" || ServiceStatus(2) != "start_pending" || ServiceStatus(7) != "paused" {
		t.Fatal("status")
	}
	if ServiceStartType(2) != "auto" || ServiceStartType(3) != "manual" || ServiceStartType(4) != "disabled" {
		t.Fatal("start type")
	}
}

func TestInterfaceFilter(t *testing.T) {
	for _, n := range []string{"docker0", "veth12ab", "br-1234", "virbr0", "cni0"} {
		if keepInterface(n) {
			t.Errorf("%s deveria ser ignorada", n)
		}
	}
	for _, n := range []string{"eth0", "enp3s0", "wlan0", "Ethernet"} {
		if !keepInterface(n) {
			t.Errorf("%s deveria ficar", n)
		}
	}
	if keepIP(net.ParseIP("fe80::1")) || keepIP(net.ParseIP("127.0.0.1")) || !keepIP(net.ParseIP("10.0.0.5")) {
		t.Error("filtro de IP")
	}
}

func TestLiveProbes(t *testing.T) {
	// Sondas reais: nao podem falhar nem devolver NaN.
	ctx := context.Background()
	if OSName() == "" {
		t.Error("OSName vazio")
	}
	if g := TotalRAMGB(); g <= 0 || math.IsNaN(g) {
		t.Errorf("TotalRAMGB = %v", g)
	}
	if BootTime() <= 0 {
		t.Error("BootTime")
	}
	if u := LoggedInUser(ctx); u == "" {
		t.Error("LoggedInUser vazio (deveria ser None)")
	}
	if _, err := Disks(ctx); err != nil {
		t.Errorf("Disks: %v", err)
	}
	_ = NeedsReboot(ctx)
	_ = LocalIPs()
}
