package speedtest

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// adapterScript descreve o adaptador do endereco de saida (ou, sem ele, o da rota para a internet).
const adapterScript = `$ErrorActionPreference = 'SilentlyContinue'
$a = Get-NetIPAddress -IPAddress '%s' | Select-Object -First 1
$idx = if ($a) { $a.InterfaceIndex } else { (Find-NetRoute -RemoteIPAddress 1.1.1.1 | Select-Object -First 1).InterfaceIndex }
$ad = Get-NetAdapter -InterfaceIndex $idx
$cfg = Get-NetIPConfiguration -InterfaceIndex $idx
[pscustomobject]@{
  name = [string]$ad.Name
  description = [string]$ad.InterfaceDescription
  mac = [string]$ad.MacAddress
  media = [string]$ad.PhysicalMediaType
  rx_bps = [int64]$ad.ReceiveLinkSpeed
  tx_bps = [int64]$ad.TransmitLinkSpeed
  gateway = @($cfg.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop })
  dns = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 | ForEach-Object { $_.ServerAddresses } | ForEach-Object { [string]$_ })
} | ConvertTo-Json -Compress`

func platformNetwork(ctx context.Context, n *Network) []string {
	var warn []string
	ip := "0.0.0.0"
	if parsed := net.ParseIP(n.LocalIP); parsed != nil {
		ip = parsed.String()
	}
	res := execx.Command(ctx, "powershell", fmt.Sprintf(adapterScript, ip), 25*time.Second, false)
	if a, err := parseWinAdapter(res.Stdout); err == nil {
		applyWinAdapter(n, a)
	} else {
		warn = append(warn, "Não foi possível ler o adaptador de rede pelo PowerShell")
	}
	if n.Type != "wifi" {
		return warn
	}
	out := execx.Command(ctx, "cmd", "netsh wlan show interfaces", 15*time.Second, false)
	if w := parseNetsh(out.Stdout, n.Interface); w != nil {
		n.WiFi = w
	} else {
		warn = append(warn, "Não foi possível ler os detalhes do Wi-Fi (netsh wlan)")
	}
	return warn
}
