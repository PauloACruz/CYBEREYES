package speedtest

import (
	"encoding/json"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

// Leitores das saidas de cada sistema, sem dependencia de plataforma para poderem ser testados
// em qualquer maquina.

// winAdapter e o JSON do script PowerShell que descreve o adaptador de saida no Windows.
type winAdapter struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	MAC         string   `json:"mac"`
	Media       string   `json:"media"`
	RxBps       int64    `json:"rx_bps"`
	TxBps       int64    `json:"tx_bps"`
	Gateway     []string `json:"gateway"`
	DNS         []string `json:"dns"`
}

func parseWinAdapter(out string) (winAdapter, error) {
	var a winAdapter
	out = strings.TrimSpace(out)
	if i := strings.Index(out, "{"); i > 0 {
		out = out[i:]
	}
	if err := json.Unmarshal([]byte(out), &a); err != nil {
		return a, fmt.Errorf("saida inesperada do PowerShell: %w", err)
	}
	return a, nil
}

// applyWinAdapter preenche a rede com o adaptador do Windows.
func applyWinAdapter(n *Network, a winAdapter) {
	if a.Name != "" {
		n.Interface = a.Name
	}
	n.Description = a.Description
	if a.MAC != "" {
		n.MAC = strings.ToUpper(strings.ReplaceAll(a.MAC, "-", ":"))
	}
	switch m := strings.ToLower(a.Media); {
	case strings.Contains(m, "802.11") || strings.Contains(m, "wireless"):
		n.Type = "wifi"
	case strings.Contains(m, "802.3"):
		n.Type = "ethernet"
	case m != "":
		n.Type = "other"
	}
	if a.RxBps > 0 {
		n.LinkMbps = round1(float64(a.RxBps) / 1e6)
	}
	n.Gateway = firstIPv4(a.Gateway)
	n.DNSServers = cleanIPs(a.DNS)
}

var (
	percentRe = regexp.MustCompile(`^(\d{1,3})\s*%$`)
	leadNumRe = regexp.MustCompile(`^-?\d+(?:[.,]\d+)?`)
)

// parseNetsh le "netsh wlan show interfaces" em qualquer idioma: SSID, BSSID e Rssi nao sao
// traduzidos; o sinal termina em %, o tipo de radio comeca com 802.11, a banda termina em GHz e as
// taxas tem "(Mbps)" no nome (recepcao antes de transmissao). Com varias placas, usa a de nome
// name (a primeira linha do bloco) ou a primeira conectada a uma rede.
func parseNetsh(out, name string) *WiFi {
	var chosen *WiFi
	for _, block := range splitBlocks(out) {
		w := &WiFi{}
		blockName := ""
		rates := 0
		for i, line := range block {
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			key, value = strings.TrimSpace(key), strings.TrimSpace(value)
			if i == 0 {
				blockName = value
			}
			lk := strings.ToLower(key)
			switch {
			case key == "SSID":
				w.SSID = value
			case strings.Contains(key, "BSSID"):
				w.BSSID = strings.ToUpper(value)
			case lk == "rssi":
				w.RSSI, _ = strconv.Atoi(value)
			case strings.Contains(key, "(Mbps)"):
				if f, ok := leadFloat(value); ok {
					if rates == 0 {
						w.RxMbps = f
					} else {
						w.TxMbps = f
					}
					rates++
				}
			case lk == "channel" || lk == "canal" || lk == "kanal" || lk == "canale" || lk == "chaîne":
				w.Channel, _ = strconv.Atoi(value)
			case percentRe.MatchString(value):
				w.SignalPct, _ = strconv.Atoi(percentRe.FindStringSubmatch(value)[1])
			case strings.HasPrefix(value, "802.11"):
				w.Radio = value
			case strings.HasSuffix(value, "GHz") && value != "" && value[0] >= '0' && value[0] <= '9':
				w.Band = strings.ReplaceAll(value, ".", ",")
			}
		}
		if w.SSID == "" {
			continue
		}
		if name != "" && strings.EqualFold(blockName, name) {
			return w
		}
		if chosen == nil {
			chosen = w
		}
	}
	return chosen
}

// splitBlocks separa a saida em blocos de linhas nao vazias.
func splitBlocks(out string) [][]string {
	var blocks [][]string
	var cur []string
	for line := range strings.SplitSeq(strings.ReplaceAll(out, "\r", ""), "\n") {
		if strings.TrimSpace(line) == "" {
			if len(cur) > 0 {
				blocks = append(blocks, cur)
				cur = nil
			}
			continue
		}
		cur = append(cur, line)
	}
	if len(cur) > 0 {
		blocks = append(blocks, cur)
	}
	return blocks
}

func leadFloat(s string) (float64, bool) {
	m := leadNumRe.FindString(strings.TrimSpace(s))
	if m == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64)
	return f, err == nil
}

// parseIwLink le "iw dev <if> link" (Linux).
func parseIwLink(out string) *WiFi {
	if !strings.HasPrefix(strings.TrimSpace(out), "Connected to") {
		return nil
	}
	w := &WiFi{}
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "Connected to "); ok {
			w.BSSID = strings.ToUpper(strings.Fields(rest)[0])
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "SSID":
			w.SSID = value
		case "freq":
			if f, ok := leadFloat(value); ok {
				w.Channel, w.Band = channelOf(f)
			}
		case "signal":
			if f, ok := leadFloat(value); ok {
				w.RSSI = int(f)
				w.SignalPct = signalPct(w.RSSI)
			}
		case "rx bitrate":
			w.RxMbps, _ = leadFloat(value)
			w.Radio = radioOf(value)
		case "tx bitrate":
			w.TxMbps, _ = leadFloat(value)
			if w.Radio == "" {
				w.Radio = radioOf(value)
			}
		}
	}
	return w
}

// channelOf converte a frequencia (MHz) em canal e banda.
func channelOf(mhz float64) (int, string) {
	f := int(mhz)
	switch {
	case f == 2484:
		return 14, "2,4 GHz"
	case f >= 2412 && f < 2484:
		return (f - 2407) / 5, "2,4 GHz"
	case f >= 5150 && f < 5925:
		return (f - 5000) / 5, "5 GHz"
	case f >= 5925 && f <= 7125:
		return (f - 5950) / 5, "6 GHz"
	}
	return 0, ""
}

// radioOf deduz o padrao pelo tipo de MCS informado na taxa.
func radioOf(rate string) string {
	switch {
	case strings.Contains(rate, "EHT-"):
		return "802.11be"
	case strings.Contains(rate, "HE-"):
		return "802.11ax"
	case strings.Contains(rate, "VHT-"):
		return "802.11ac"
	case strings.Contains(rate, "MCS"):
		return "802.11n"
	}
	return ""
}

// signalPct converte dBm na qualidade de 0 a 100% (a mesma escala linear do Windows: -100 a -50 dBm).
func signalPct(dbm int) int {
	return min(100, max(0, 2*(dbm+100)))
}

// parseProcWireless le o nivel do sinal (dBm) em /proc/net/wireless.
func parseProcWireless(out, iface string) (int, bool) {
	for line := range strings.SplitSeq(out, "\n") {
		name, rest, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok || name != iface {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 3 {
			return 0, false
		}
		f, err := strconv.ParseFloat(strings.TrimSuffix(fields[2], "."), 64)
		if err != nil || f >= 0 {
			return 0, false
		}
		return int(f), true
	}
	return 0, false
}

// parseProcRoute devolve o gateway da rota padrao (de menor metrica) em /proc/net/route.
func parseProcRoute(out, iface string) string {
	best, bestMetric := "", -1
	for line := range strings.SplitSeq(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 8 || f[1] != "00000000" || (iface != "" && f[0] != iface) {
			continue
		}
		gw, err := strconv.ParseUint(f[2], 16, 32)
		if err != nil || gw == 0 {
			continue
		}
		metric, _ := strconv.Atoi(f[6])
		if bestMetric >= 0 && metric >= bestMetric {
			continue
		}
		ip := net.IPv4(byte(gw), byte(gw>>8), byte(gw>>16), byte(gw>>24))
		best, bestMetric = ip.String(), metric
	}
	return best
}

// parseResolvConf lista os nameservers.
func parseResolvConf(out string) []string {
	var servers []string
	for line := range strings.SplitSeq(out, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0] == "nameserver" {
			servers = append(servers, f[1])
		}
	}
	return cleanIPs(servers)
}

// parseRouteGetDefault le "route -n get default" (macOS).
func parseRouteGetDefault(out string) (gateway, iface string) {
	for line := range strings.SplitSeq(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "gateway":
			gateway = strings.TrimSpace(value)
		case "interface":
			iface = strings.TrimSpace(value)
		}
	}
	return gateway, iface
}

// parseHardwarePorts le "networksetup -listallhardwareports" (macOS): dispositivo -> nome da porta.
func parseHardwarePorts(out string) map[string]string {
	ports := map[string]string{}
	port := ""
	for line := range strings.SplitSeq(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Hardware Port":
			port = strings.TrimSpace(value)
		case "Device":
			if port != "" {
				ports[strings.TrimSpace(value)] = port
			}
		}
	}
	return ports
}

// portType classifica a porta de hardware do macOS.
func portType(port string) string {
	l := strings.ToLower(port)
	switch {
	case strings.Contains(l, "wi-fi") || strings.Contains(l, "airport"):
		return "wifi"
	case strings.Contains(l, "ethernet") || strings.Contains(l, "lan"):
		return "ethernet"
	case l == "":
		return ""
	}
	return "other"
}

var mediaRe = regexp.MustCompile(`(?i)\((\d+)(g?)base`)

// parseIfconfigMedia le a velocidade negociada em "media: autoselect (1000baseT <full-duplex>)".
func parseIfconfigMedia(out string) float64 {
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "media:") {
			continue
		}
		m := mediaRe.FindStringSubmatch(line)
		if m == nil {
			return 0
		}
		v, _ := strconv.ParseFloat(m[1], 64)
		if m[2] != "" {
			v *= 1000
		}
		return v
	}
	return 0
}

// parseSystemProfiler le "system_profiler SPAirPortDataType -json" (macOS).
func parseSystemProfiler(out, iface string) *WiFi {
	var doc struct {
		Data []struct {
			Interfaces []struct {
				Name    string `json:"_name"`
				Current *struct {
					Name    string          `json:"_name"`
					Channel json.RawMessage `json:"spairport_network_channel"`
					PHY     string          `json:"spairport_network_phymode"`
					Rate    json.RawMessage `json:"spairport_network_rate"`
					Signal  string          `json:"spairport_signal_noise"`
				} `json:"spairport_current_network_information"`
			} `json:"spairport_airport_interfaces"`
		} `json:"SPAirPortDataType"`
	}
	if json.Unmarshal([]byte(out), &doc) != nil {
		return nil
	}
	for _, d := range doc.Data {
		for _, it := range d.Interfaces {
			if it.Current == nil || (iface != "" && it.Name != iface) {
				continue
			}
			c := it.Current
			w := &WiFi{SSID: c.Name, Radio: c.PHY}
			channel := strings.Trim(string(c.Channel), `"`)
			if n, ok := leadFloat(channel); ok {
				w.Channel = int(n)
			}
			switch {
			case strings.Contains(channel, "2GHz"):
				w.Band = "2,4 GHz"
			case strings.Contains(channel, "5GHz"):
				w.Band = "5 GHz"
			case strings.Contains(channel, "6GHz"):
				w.Band = "6 GHz"
			}
			if r, ok := leadFloat(strings.Trim(string(c.Rate), `"`)); ok {
				w.TxMbps = r
			}
			// "-55 dBm / -92 dBm": sinal e ruido.
			signal, noise, _ := strings.Cut(c.Signal, "/")
			if f, ok := leadFloat(signal); ok {
				w.RSSI = int(f)
				w.SignalPct = signalPct(w.RSSI)
			}
			if f, ok := leadFloat(noise); ok {
				w.Noise = int(f)
			}
			return w
		}
	}
	return nil
}

func firstIPv4(ips []string) string {
	for _, s := range ips {
		if ip := net.ParseIP(strings.TrimSpace(s)); ip != nil && ip.To4() != nil {
			return ip.String()
		}
	}
	if len(ips) > 0 {
		return strings.TrimSpace(ips[0])
	}
	return ""
}

// cleanIPs mantem so enderecos validos, sem repeticao.
func cleanIPs(ips []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range ips {
		ip := net.ParseIP(strings.TrimSpace(s))
		if ip == nil || seen[ip.String()] {
			continue
		}
		seen[ip.String()] = true
		out = append(out, ip.String())
	}
	return out
}
