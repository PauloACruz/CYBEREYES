package speedtest

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

func platformNetwork(ctx context.Context, n *Network) []string {
	var warn []string
	if b, err := os.ReadFile("/proc/net/route"); err == nil {
		n.Gateway = parseProcRoute(string(b), n.Interface)
	}
	n.DNSServers = linuxDNS()
	if n.Interface == "" {
		return warn
	}
	sys := filepath.Join("/sys/class/net", n.Interface)
	switch {
	case exists(filepath.Join(sys, "wireless")) || exists(filepath.Join(sys, "phy80211")):
		n.Type = "wifi"
	case exists(filepath.Join(sys, "device")):
		n.Type = "ethernet"
	default:
		n.Type = "other"
	}
	if driver, err := os.Readlink(filepath.Join(sys, "device", "driver")); err == nil {
		n.Description = "Driver " + filepath.Base(driver)
	}
	if b, err := os.ReadFile(filepath.Join(sys, "speed")); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && v > 0 {
			n.LinkMbps = float64(v)
		}
	}
	if n.Type != "wifi" {
		return warn
	}
	if iw, err := exec.LookPath("iw"); err == nil {
		res := execx.Run(ctx, execx.Spec{Path: iw, Args: []string{"dev", n.Interface, "link"}, Timeout: 10 * time.Second})
		n.WiFi = parseIwLink(res.Stdout)
	}
	if n.WiFi == nil {
		if b, err := os.ReadFile("/proc/net/wireless"); err == nil {
			if rssi, ok := parseProcWireless(string(b), n.Interface); ok {
				n.WiFi = &WiFi{RSSI: rssi, SignalPct: signalPct(rssi)}
			}
		}
	}
	if n.WiFi == nil {
		warn = append(warn, "Não foi possível ler os detalhes do Wi-Fi (instale o pacote iw)")
	} else if n.WiFi.RxMbps > 0 {
		n.LinkMbps = n.WiFi.RxMbps
	}
	return warn
}

// linuxDNS le o resolv.conf; com o systemd-resolved (127.0.0.53), le os servidores reais dele.
func linuxDNS() []string {
	b, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}
	servers := parseResolvConf(string(b))
	if len(servers) == 1 && servers[0] == "127.0.0.53" {
		if b, err := os.ReadFile("/run/systemd/resolve/resolv.conf"); err == nil {
			if real := parseResolvConf(string(b)); len(real) > 0 {
				return real
			}
		}
	}
	return servers
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
