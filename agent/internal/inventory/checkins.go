package inventory

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/env"
	"github.com/pauloacruz/cybereyes/agent/internal/sysinfo"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// Corpos dos check-ins. Todos levam agent_id: sem ele o servidor descarta a mensagem.

type helloBody struct {
	AgentID string `json:"agent_id"`
	Version string `json:"version"`
}

type agentInfoBody struct {
	AgentID         string `json:"agent_id"`
	Hostname        string `json:"hostname,omitempty"`
	OperatingSystem string `json:"operating_system"`
	Plat            string `json:"plat"`
	// TotalRAM em GB; omitido quando desconhecido (o servidor arredonda para cima).
	TotalRAM float64 `json:"total_ram,omitempty"`
	// BootTime em segundos Unix.
	BootTime         int64  `json:"boot_time,omitempty"`
	NeedsReboot      bool   `json:"needs_reboot"`
	LoggedInUsername string `json:"logged_in_username"`
	Goarch           string `json:"goarch"`
}

type diskItem struct {
	Device  string  `json:"device"`
	Fstype  string  `json:"fstype"`
	Total   string  `json:"total"`
	Used    string  `json:"used"`
	Free    string  `json:"free"`
	Percent float64 `json:"percent"`
	// Source e o dispositivo de origem no Unix ("/dev/sda1"); device e o ponto de montagem.
	Source string `json:"source,omitempty"`
}

type disksBody struct {
	AgentID string     `json:"agent_id"`
	Disks   []diskItem `json:"disks"`
}

type winSvcBody struct {
	AgentID  string            `json:"agent_id"`
	Services []sysinfo.Service `json:"services"`
}

type publicIPBody struct {
	AgentID  string `json:"agent_id"`
	PublicIP string `json:"public_ip"`
}

type wmiBody struct {
	AgentID string         `json:"agent_id"`
	WMI     map[string]any `json:"wmi"`
}

func (m *module) buildHello(context.Context) (any, error) {
	return helloBody{AgentID: m.e.Cfg.AgentID, Version: version.Version}, nil
}

func (m *module) buildAgentInfo(ctx context.Context) (any, error) {
	return agentInfoBody{
		AgentID:          m.e.Cfg.AgentID,
		Hostname:         sysinfo.Hostname(),
		OperatingSystem:  sysinfo.OSName(),
		Plat:             runtime.GOOS,
		TotalRAM:         sysinfo.TotalRAMGB(),
		BootTime:         sysinfo.BootTime(),
		NeedsReboot:      sysinfo.NeedsReboot(ctx),
		LoggedInUsername: sysinfo.LoggedInUser(ctx),
		Goarch:           runtime.GOARCH,
	}, nil
}

func (m *module) buildDisks(ctx context.Context) (any, error) {
	list, err := sysinfo.Disks(ctx)
	if err != nil {
		return nil, err
	}
	return disksBody{AgentID: m.e.Cfg.AgentID, Disks: diskItems(list)}, nil
}

func diskItems(list []sysinfo.DiskUsage) []diskItem {
	out := make([]diskItem, 0, len(list))
	for _, d := range list {
		out = append(out, diskItem{
			Device:  d.Device,
			Fstype:  d.Fstype,
			Total:   sysinfo.FormatBytes(d.Total),
			Used:    sysinfo.FormatBytes(d.Used),
			Free:    sysinfo.FormatBytes(d.Free),
			Percent: d.Percent(),
			Source:  d.Source,
		})
	}
	return out
}

func (m *module) buildWinSvc(ctx context.Context) (any, error) {
	list, err := sysinfo.Services(ctx)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []sysinfo.Service{}
	}
	return winSvcBody{AgentID: m.e.Cfg.AgentID, Services: list}, nil
}

func (m *module) buildWMI(ctx context.Context) (any, error) {
	w := collectHardware(ctx)
	if len(w) == 0 {
		return nil, errors.New("nenhuma informacao de hardware coletada")
	}
	return wmiBody{AgentID: m.e.Cfg.AgentID, WMI: w}, nil
}

func (m *module) buildPublicIP(ctx context.Context) (any, error) {
	ip, err := m.publicIP(ctx)
	if err != nil {
		return nil, err
	}
	return publicIPBody{AgentID: m.e.Cfg.AgentID, PublicIP: ip}, nil
}

// publicIPServices devolvem o IP de origem em texto puro; os primeiros so respondem por IPv4.
var publicIPServices = []string{
	"https://ipv4.icanhazip.com",
	"https://api.ipify.org",
	"https://icanhazip.com",
	"https://ifconfig.me/ip",
}

func newIPClient(e *env.Env) *http.Client {
	tr, err := api.NewTransport(api.Options{Proxy: e.Cfg.Proxy})
	if err != nil {
		tr, _ = api.NewTransport(api.Options{})
	}
	return &http.Client{Transport: tr, Timeout: 8 * time.Second}
}

// publicIP consulta os servicos em ordem e devolve o primeiro IP publico valido.
func (m *module) publicIP(ctx context.Context) (string, error) {
	var last error
	for _, u := range publicIPServices {
		if ctx.Err() != nil {
			break
		}
		ip, err := fetchIP(ctx, m.ip, u)
		if err == nil {
			return ip, nil
		}
		last = err
	}
	if last == nil {
		last = ctx.Err()
	}
	return "", fmt.Errorf("IP publico indisponivel: %w", last)
}

func fetchIP(ctx context.Context, c *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "EYES/"+version.Version)
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		return "", err
	}
	ip := parsePublicIP(string(data))
	if ip == "" {
		return "", fmt.Errorf("%s: resposta nao e um IP publico", url)
	}
	return ip, nil
}

// parsePublicIP valida a resposta: precisa ser um IP roteavel (nao privado, loopback ou link-local).
func parsePublicIP(s string) string {
	ip := net.ParseIP(strings.TrimSpace(s))
	if ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast() {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	return ip.String()
}
