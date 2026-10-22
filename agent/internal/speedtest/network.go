package speedtest

import (
	"context"
	"net"
	"os"
	"runtime"
	"strings"
	"time"

	probing "github.com/prometheus-community/pro-bing"
)

// icmpPing envia count pacotes ICMP (como o check de ping: privilegiado no Windows e, com root, no Linux).
func icmpPing(ctx context.Context, host string, count int) PingTarget {
	t := PingTarget{Host: host}
	p, err := probing.NewPinger(host)
	if err != nil {
		t.Error = err.Error()
		return t
	}
	p.SetLogger(probing.NoopLogger{})
	p.Count = count
	p.Interval = 200 * time.Millisecond
	p.Timeout = time.Duration(count)*p.Interval + 2*time.Second
	switch runtime.GOOS {
	case "windows":
		p.SetPrivileged(true)
	case "linux":
		p.SetPrivileged(os.Geteuid() == 0)
	}
	if err := p.RunWithContext(ctx); err != nil {
		t.Error = err.Error()
		return t
	}
	s := p.Statistics()
	t.Sent, t.Received, t.LossPct = s.PacketsSent, s.PacketsRecv, round2(s.PacketLoss)
	samples := make([]float64, 0, len(s.Rtts))
	for _, r := range s.Rtts {
		samples = append(samples, msOf(r))
	}
	t.Stats = summarize(samples)
	if t.Sent == 0 {
		t.Error = "nenhum pacote enviado"
	}
	return t
}

// collectNetwork descobre a interface de saida (a que o sistema usaria para chegar a internet) e
// completa com os detalhes de cada sistema: tipo, velocidade do link, gateway, DNS e Wi-Fi.
func collectNetwork(ctx context.Context) (Network, []string) {
	var n Network
	var warn []string
	n.LocalIP = outboundIP()
	if iface := interfaceByIP(n.LocalIP); iface != nil {
		n.Interface = iface.Name
		n.MTU = iface.MTU
		n.MAC = strings.ToUpper(iface.HardwareAddr.String())
	}
	pctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	warn = append(warn, platformNetwork(pctx, &n)...)
	if n.Type == "" {
		n.Type = guessType(n.Interface)
	}
	return n, warn
}

// outboundIP pergunta ao sistema o endereco de origem para a internet (UDP nao envia nada).
func outboundIP() string {
	for _, target := range []string{"1.1.1.1:443", "8.8.8.8:53"} {
		c, err := net.Dial("udp", target)
		if err != nil {
			continue
		}
		addr, _ := c.LocalAddr().(*net.UDPAddr)
		_ = c.Close()
		if addr != nil {
			return addr.IP.String()
		}
	}
	return ""
}

func interfaceByIP(ip string) *net.Interface {
	if ip == "" {
		return nil
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for i := range ifaces {
		addrs, err := ifaces[i].Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.String() == ip {
				return &ifaces[i]
			}
		}
	}
	return nil
}

// guessType usa o nome da interface quando o sistema nao informou o tipo.
func guessType(name string) string {
	l := strings.ToLower(name)
	switch {
	case l == "":
		return ""
	case strings.HasPrefix(l, "wl") || strings.Contains(l, "wi-fi") || strings.Contains(l, "wifi") || strings.Contains(l, "wireless"):
		return "wifi"
	case strings.HasPrefix(l, "eth") || strings.HasPrefix(l, "en") || strings.Contains(l, "ethernet"):
		return "ethernet"
	}
	return "other"
}
