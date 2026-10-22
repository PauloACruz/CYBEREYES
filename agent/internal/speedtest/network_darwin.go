package speedtest

import (
	"context"
	"os"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

func platformNetwork(ctx context.Context, n *Network) []string {
	var warn []string
	route := execx.Run(ctx, execx.Spec{Path: "/sbin/route", Args: []string{"-n", "get", "default"}, Timeout: 10 * time.Second})
	gateway, iface := parseRouteGetDefault(route.Stdout)
	n.Gateway = gateway
	if n.Interface == "" {
		n.Interface = iface
	}
	if b, err := os.ReadFile("/etc/resolv.conf"); err == nil {
		n.DNSServers = parseResolvConf(string(b))
	}
	ports := execx.Run(ctx, execx.Spec{Path: "/usr/sbin/networksetup", Args: []string{"-listallhardwareports"}, Timeout: 10 * time.Second})
	if port := parseHardwarePorts(ports.Stdout)[n.Interface]; port != "" {
		n.Description = port
		n.Type = portType(port)
	}
	if n.Interface != "" && n.Type != "wifi" {
		ifc := execx.Run(ctx, execx.Spec{Path: "/sbin/ifconfig", Args: []string{n.Interface}, Timeout: 10 * time.Second})
		n.LinkMbps = parseIfconfigMedia(ifc.Stdout)
	}
	if n.Type != "wifi" {
		return warn
	}
	sp := execx.Run(ctx, execx.Spec{Path: "/usr/sbin/system_profiler", Args: []string{"SPAirPortDataType", "-json"}, Timeout: 25 * time.Second})
	if w := parseSystemProfiler(sp.Stdout, n.Interface); w != nil {
		n.WiFi = w
		n.LinkMbps = w.TxMbps
	} else {
		warn = append(warn, "Não foi possível ler os detalhes do Wi-Fi (system_profiler)")
	}
	return warn
}
