package speedtest

import (
	"reflect"
	"testing"
)

const netshEN = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    GUID                   : 4f1c0a5e-1111-2222-3333-444455556666
    Physical address       : a0:b1:c2:d3:e4:f5
    Interface type         : Primary
    State                  : connected
    SSID                   : Escritorio
    AP BSSID               : 11:22:33:44:55:66
    Band                   : 5 GHz
    Channel                : 36
    Network type           : Infrastructure
    Radio type             : 802.11ax
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Connection mode        : Auto Connect
    Receive rate (Mbps)    : 1201
    Transmit rate (Mbps)   : 960
    Signal                 : 92%
    Rssi                   : -48
    Profile                : Escritorio

    Hosted network status  : Not available
`

const netshPT = "Há 2 interfaces no sistema:\r\n\r\n" +
	"    Nome                   : Wi-Fi USB\r\n" +
	"    Descrição              : TP-Link Wireless USB Adapter\r\n" +
	"    Estado                 : desconectado\r\n" +
	"\r\n" +
	"    Nome                   : Wi-Fi\r\n" +
	"    Descrição              : Realtek 8821CE Wireless LAN 802.11ac PCI-E NIC\r\n" +
	"    Estado                 : conectado\r\n" +
	"    SSID                   : Recepção 2G\r\n" +
	"    BSSID                  : aa:bb:cc:dd:ee:ff\r\n" +
	"    Tipo de rede           : Infraestrutura\r\n" +
	"    Tipo de rádio          : 802.11n\r\n" +
	"    Autenticação           : WPA2-Personal\r\n" +
	"    Canal                  : 6\r\n" +
	"    Banda                  : 2.4 GHz\r\n" +
	"    Taxa de recepção (Mbps)  : 72,2\r\n" +
	"    Taxa de transmissão (Mbps) : 65\r\n" +
	"    Sinal                  : 41%\r\n" +
	"    Perfil                 : Recepção 2G\r\n"

func TestParseNetsh(t *testing.T) {
	en := parseNetsh(netshEN, "Wi-Fi")
	want := &WiFi{SSID: "Escritorio", BSSID: "11:22:33:44:55:66", SignalPct: 92, RSSI: -48, Channel: 36, Band: "5 GHz", Radio: "802.11ax", RxMbps: 1201, TxMbps: 960}
	if !reflect.DeepEqual(en, want) {
		t.Errorf("ingles = %+v", en)
	}
	pt := parseNetsh(netshPT, "Wi-Fi")
	want = &WiFi{SSID: "Recepção 2G", BSSID: "AA:BB:CC:DD:EE:FF", SignalPct: 41, Channel: 6, Band: "2,4 GHz", Radio: "802.11n", RxMbps: 72.2, TxMbps: 65}
	if !reflect.DeepEqual(pt, want) {
		t.Errorf("portugues = %+v", pt)
	}
	// Sem o nome do adaptador, vale o primeiro bloco conectado a uma rede.
	if w := parseNetsh(netshPT, ""); w == nil || w.SSID != "Recepção 2G" {
		t.Errorf("sem nome = %+v", w)
	}
	if parseNetsh("O serviço de Configuração Automática de WLAN (wlansvc) não está em execução.", "Wi-Fi") != nil {
		t.Error("sem Wi-Fi deve dar nil")
	}
}

func TestParseIwLink(t *testing.T) {
	out := `Connected to 8e:ba:5f:99:7a:8d (on wlp0s20f3)
	SSID: LifeLaboral
	freq: 5200.0
	RX: 123456 bytes (789 packets)
	TX: 98765 bytes (432 packets)
	signal: -35 dBm
	rx bitrate: 1200.9 MBit/s 80MHz HE-MCS 11 HE-NSS 2 HE-GI 0 HE-DCM 0
	tx bitrate: 1080.6 MBit/s 80MHz HE-MCS 10 HE-NSS 2 HE-GI 0 HE-DCM 0
	bss flags: short-slot-time
	dtim period: 1
	beacon int: 100`
	want := &WiFi{SSID: "LifeLaboral", BSSID: "8E:BA:5F:99:7A:8D", SignalPct: 100, RSSI: -35, Channel: 40, Band: "5 GHz", Radio: "802.11ax", RxMbps: 1200.9, TxMbps: 1080.6}
	if got := parseIwLink(out); !reflect.DeepEqual(got, want) {
		t.Errorf("iw = %+v", got)
	}
	if parseIwLink("Not connected.") != nil {
		t.Error("desconectado deve dar nil")
	}
}

func TestChannelAndSignal(t *testing.T) {
	cases := []struct {
		mhz     float64
		channel int
		band    string
	}{{2412, 1, "2,4 GHz"}, {2484, 14, "2,4 GHz"}, {5180, 36, "5 GHz"}, {5955, 1, "6 GHz"}, {900, 0, ""}}
	for _, c := range cases {
		if ch, band := channelOf(c.mhz); ch != c.channel || band != c.band {
			t.Errorf("%v MHz = %d %q", c.mhz, ch, band)
		}
	}
	if signalPct(-50) != 100 || signalPct(-75) != 50 || signalPct(-110) != 0 {
		t.Error("escala do sinal")
	}
}

func TestParseLinuxFiles(t *testing.T) {
	route := "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n" +
		"docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n" +
		"eth0\t00000000\t0102A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n" +
		"wlan0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n"
	if gw := parseProcRoute(route, ""); gw != "192.168.1.1" {
		t.Errorf("rota de menor metrica = %s", gw)
	}
	if gw := parseProcRoute(route, "eth0"); gw != "192.168.2.1" {
		t.Errorf("rota da eth0 = %s", gw)
	}
	wireless := "Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE\n" +
		" face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22\n" +
		"wlp0s20f3: 0000   70.  -40.  -256        0      0      0      0     12        0\n"
	if rssi, ok := parseProcWireless(wireless, "wlp0s20f3"); !ok || rssi != -40 {
		t.Errorf("/proc/net/wireless = %d %v", rssi, ok)
	}
	resolv := "# gerado\nnameserver 192.168.1.1\nnameserver 2804:14c::1\nnameserver lixo\nsearch lan\nnameserver 192.168.1.1\n"
	if got := parseResolvConf(resolv); !reflect.DeepEqual(got, []string{"192.168.1.1", "2804:14c::1"}) {
		t.Errorf("resolv.conf = %v", got)
	}
}

func TestParseMacOutputs(t *testing.T) {
	gw, iface := parseRouteGetDefault("   route to: default\ndestination: default\n       mask: default\n    gateway: 10.0.0.1\n  interface: en0\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>\n")
	if gw != "10.0.0.1" || iface != "en0" {
		t.Errorf("route = %s %s", gw, iface)
	}
	ports := parseHardwarePorts("\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa:bb:cc:dd:ee:ff\n\nHardware Port: Thunderbolt Ethernet Slot 1\nDevice: en5\nEthernet Address: 11:22:33:44:55:66\n")
	if ports["en0"] != "Wi-Fi" || portType(ports["en0"]) != "wifi" || portType(ports["en5"]) != "ethernet" {
		t.Errorf("portas = %v", ports)
	}
	if v := parseIfconfigMedia("en5: flags=8863<UP>\n\tmedia: autoselect (1000baseT <full-duplex>)\n\tstatus: active"); v != 1000 {
		t.Errorf("1000baseT = %v", v)
	}
	if v := parseIfconfigMedia("\tmedia: autoselect (10Gbase-T <full-duplex>)"); v != 10000 {
		t.Errorf("10Gbase-T = %v", v)
	}
	sp := `{"SPAirPortDataType":[{"spairport_airport_interfaces":[{"_name":"awdl0"},{"_name":"en0",
		"spairport_current_network_information":{"_name":"Casa","spairport_network_channel":"149 (5GHz, 80MHz)",
		"spairport_network_phymode":"802.11ac","spairport_network_rate":867,"spairport_signal_noise":"-58 dBm / -92 dBm"}}]}]}`
	want := &WiFi{SSID: "Casa", SignalPct: 84, RSSI: -58, Noise: -92, Channel: 149, Band: "5 GHz", Radio: "802.11ac", TxMbps: 867}
	if got := parseSystemProfiler(sp, "en0"); !reflect.DeepEqual(got, want) {
		t.Errorf("system_profiler = %+v", got)
	}
}

func TestWinAdapter(t *testing.T) {
	out := "\ufeff" + `{"name":"Ethernet","description":"Intel(R) Ethernet Connection I219-V","mac":"A0-B1-C2-D3-E4-F5","media":"802.3",` +
		`"rx_bps":1000000000,"tx_bps":1000000000,"gateway":["fe80::1","192.168.10.1"],"dns":["192.168.10.1","8.8.8.8","8.8.8.8"]}`
	a, err := parseWinAdapter(out)
	if err != nil {
		t.Fatal(err)
	}
	var n Network
	applyWinAdapter(&n, a)
	want := Network{Interface: "Ethernet", Description: "Intel(R) Ethernet Connection I219-V", Type: "ethernet", MAC: "A0:B1:C2:D3:E4:F5",
		LinkMbps: 1000, Gateway: "192.168.10.1", DNSServers: []string{"192.168.10.1", "8.8.8.8"}}
	if !reflect.DeepEqual(n, want) {
		t.Errorf("rede = %+v", n)
	}
	a, _ = parseWinAdapter(`{"name":"Wi-Fi","media":"Native 802.11","rx_bps":866700000,"gateway":[],"dns":[]}`)
	applyWinAdapter(&n, a)
	if n.Type != "wifi" || n.LinkMbps != 866.7 || n.Gateway != "" {
		t.Errorf("wifi = %+v", n)
	}
	// Adaptador do Hyper-V: midia "Unspecified" fica sem tipo para collectNetwork deduzir pelo nome.
	var virt Network
	a, _ = parseWinAdapter(`{"name":"Ethernet 3","media":"Unspecified","rx_bps":100000000000}`)
	applyWinAdapter(&virt, a)
	if virt.Type != "" || guessType(virt.Interface) != "ethernet" || virt.LinkMbps != 100000 {
		t.Errorf("hyper-v = %+v", virt)
	}
	if _, err := parseWinAdapter("Get-NetAdapter : erro"); err == nil {
		t.Error("saida sem JSON deve dar erro")
	}
}

func TestGuessType(t *testing.T) {
	for name, want := range map[string]string{"wlan0": "wifi", "Wi-Fi": "wifi", "eth0": "ethernet", "enp3s0": "ethernet", "tun0": "other", "": ""} {
		if got := guessType(name); got != want {
			t.Errorf("%q = %q, quero %q", name, got, want)
		}
	}
}
