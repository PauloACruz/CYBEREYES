// Package sysinfo reune consultas ao sistema reaproveitaveis pelos modulos do EYES:
// sistema operacional, memoria, hora de partida, reinicio pendente, usuario conectado,
// discos, IPs locais e servicos do Windows. Todas as consultas sao de melhor esforco:
// uma falha devolve valor vazio ou erro, nunca derruba o chamador.
package sysinfo

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"os"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

// NoUser e o valor de logged_in_username sem sessao interativa (contrato do servidor).
const NoUser = "None"

// ErrUnsupported indica consulta indisponivel neste sistema.
var ErrUnsupported = errors.New("consulta nao suportada neste sistema")

// Hostname devolve o nome da maquina (vazio se indisponivel).
func Hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(h)
}

// LoggedInUser devolve o usuario da sessao interativa (Windows: DOMINIO\usuario; Unix: usuario)
// ou NoUser quando ninguem esta conectado. Espera no maximo 10 segundos.
func LoggedInUser(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ch := make(chan string, 1)
	go func() {
		defer func() {
			if recover() != nil {
				ch <- ""
			}
		}()
		ch <- loggedInUser(ctx)
	}()
	select {
	case u := <-ch:
		if u = strings.TrimSpace(u); u != "" {
			return u
		}
	case <-ctx.Done():
	}
	return NoUser
}

// TotalRAMGB devolve a memoria total em GB (base 1024) com duas casas, ou 0 se indisponivel.
func TotalRAMGB() float64 {
	b, err := TotalRAM()
	if err != nil || b == 0 {
		return 0
	}
	return Round(float64(b)/(1<<30), 2)
}

// Round arredonda v para n casas decimais e troca NaN e infinito por 0
// (o servidor descarta a mensagem inteira com NaN).
func Round(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	p := math.Pow(10, float64(n))
	r := math.Round(v*p) / p
	if math.IsNaN(r) || math.IsInf(r, 0) {
		return 0
	}
	return r
}

// FormatBytes formata um tamanho legivel em base 1024 ("512 B", "12.3 MB", "100 GB").
func FormatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	units := []string{"KB", "MB", "GB", "TB", "PB", "EB"}
	v := float64(b)
	i := -1
	for v >= unit && i < len(units)-1 {
		v /= unit
		i++
	}
	s := fmt.Sprintf("%.1f", v)
	s = strings.TrimSuffix(s, ".0")
	return s + " " + units[i]
}

// FormatDecimalGB formata bytes em GB decimais inteiros, como o servidor faz com o WMI ("500 GB").
func FormatDecimalGB(b uint64) string {
	return fmt.Sprintf("%.0f GB", math.Round(float64(b)/1e9))
}

// serialPlaceholders sao valores de fabrica que nao identificam a maquina (mesma lista do servidor).
var serialPlaceholders = map[string]bool{
	"to be filled by o.e.m.": true, "default string": true, "system serial number": true, "0": true,
	"none": true, "n/a": true, "unknown": true, "not specified": true, "not applicable": true,
	"system manufacturer": true, "system product name": true, "o.e.m.": true, "oem": true,
	"to be filled by oem": true, "chassis serial number": true, "123456789": true, "0123456789": true,
}

// CleanValue apara o texto e devolve vazio para valores de fabrica sem significado.
func CleanValue(s string) string {
	s = strings.TrimSpace(strings.Trim(s, "\x00"))
	if serialPlaceholders[strings.ToLower(s)] {
		return ""
	}
	if strings.Trim(s, "0 -.") == "" {
		return ""
	}
	return s
}

// NIC e uma placa de rede com MAC (para o Wake-on-LAN pelo EYES, RFC-001) e enderecos em CIDR.
type NIC struct {
	Name string   `json:"name"`
	MAC  string   `json:"mac"`
	IPs  []string `json:"ips"`
}

// NICs devolve as placas fisicas ativas com MAC de 6 bytes, sem loopback nem interfaces virtuais de conteineres.
func NICs() []NIC {
	ifaces, err := net.Interfaces()
	if err != nil {
		return []NIC{}
	}
	out := []NIC{}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || !keepInterface(ifc.Name) || len(ifc.HardwareAddr) != 6 {
			continue
		}
		nic := NIC{Name: ifc.Name, MAC: strings.ToUpper(ifc.HardwareAddr.String()), IPs: []string{}}
		if addrs, err := ifc.Addrs(); err == nil {
			for _, a := range addrs {
				if ipn, ok := a.(*net.IPNet); ok && keepIP(ipn.IP) {
					nic.IPs = append(nic.IPs, ipn.String())
				}
			}
		}
		out = append(out, nic)
	}
	return out
}

// LocalIPs devolve os enderecos das interfaces ativas no formato CIDR ("10.0.0.5/24"),
// sem loopback, link-local nem interfaces virtuais de conteineres.
func LocalIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return []string{}
	}
	out := []string{}
	seen := map[string]bool{}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || !keepInterface(ifc.Name) {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || !keepIP(ipn.IP) {
				continue
			}
			s := ipn.String()
			if !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	return out
}

// virtualPrefixes sao interfaces criadas por conteineres e hipervisores locais.
var virtualPrefixes = []string{"docker", "veth", "br-", "virbr", "cni", "flannel", "cali", "vxlan", "kube", "lxcbr", "lxdbr", "podman", "tailscale", "zt", "utun", "awdl", "llw", "anpi", "bridge", "vmnet", "vboxnet"}

func keepInterface(name string) bool {
	n := strings.ToLower(name)
	for _, p := range virtualPrefixes {
		if strings.HasPrefix(n, p) {
			return false
		}
	}
	return true
}

func keepIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return true
}

// output executa um comando de consulta com tempo limite e devolve a saida padrao.
func output(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	res := execx.Run(ctx, execx.Spec{Path: name, Args: args, Timeout: timeout})
	if res.Err != nil {
		return "", res.Err
	}
	if res.TimedOut {
		return "", fmt.Errorf("%s: tempo limite excedido", name)
	}
	if res.ExitCode != 0 && res.Stdout == "" {
		return "", fmt.Errorf("%s: codigo de saida %d", name, res.ExitCode)
	}
	return res.Stdout, nil
}

// Output executa um comando de consulta com tempo limite (uso por outros pacotes de inventario).
func Output(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	return output(ctx, timeout, name, args...)
}
