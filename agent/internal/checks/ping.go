package checks

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"github.com/pauloacruz/cybereyes/agent/internal/execx"
)

const pingCount = 4

// pingResult e o resultado de um ping (enviados, recebidos e tempos).
type pingResult struct {
	Addr     string
	IP       string
	Sent     int
	Recv     int
	Loss     float64
	Min, Avg time.Duration
	Max      time.Duration
}

// Funcoes substituiveis nos testes.
var (
	icmpPing   = probePing
	systemPing = commandPing
)

// pingCheck envia pingCount pacotes ICMP. Falha ("failing") com 100% de perda ou host invalido.
func pingCheck(ctx context.Context, c Check) map[string]any {
	host := c.IP
	if host == "" || strings.HasPrefix(host, "-") || strings.ContainsAny(host, " \t\r\n;&|") {
		return map[string]any{"status": statusFailing, "output": fmt.Sprintf("Host invalido para ping: %q", host)}
	}
	timeout := min(max(c.Timeout, 3*time.Second), 30*time.Second)
	res, err := icmpPing(ctx, host, timeout)
	var rerr *resolveError
	if errors.As(err, &rerr) {
		return map[string]any{"status": statusFailing, "output": fmt.Sprintf("Falha ao resolver o host %s: %v", host, rerr.err)}
	}
	if err != nil {
		// Sem socket ICMP (permissao ou sistema): usa o comando ping do sistema.
		ok, out, cerr := systemPing(ctx, host, timeout)
		if cerr != nil {
			return map[string]any{"status": statusFailing, "output": fmt.Sprintf("Falha no ping para %s: %v", host, err)}
		}
		status := statusPassing
		if !ok {
			status = statusFailing
		}
		return map[string]any{"status": status, "output": out}
	}
	status := statusPassing
	if res.Recv == 0 {
		status = statusFailing
	}
	return map[string]any{"status": status, "output": formatPing(res)}
}

// resolveError e a falha de resolucao do nome (o ping do sistema nao ajudaria).
type resolveError struct{ err error }

func (e *resolveError) Error() string { return e.err.Error() }

func formatPing(r pingResult) string {
	var b strings.Builder
	addr := r.Addr
	if r.IP != "" && r.IP != r.Addr {
		addr += " (" + r.IP + ")"
	}
	fmt.Fprintf(&b, "PING %s: %d pacotes enviados, %d recebidos, %.0f%% de perda", addr, r.Sent, r.Recv, r.Loss)
	if r.Recv > 0 {
		fmt.Fprintf(&b, "\nrtt min/med/max = %.1f/%.1f/%.1f ms", ms(r.Min), ms(r.Avg), ms(r.Max))
	}
	return b.String()
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

// probePing usa o pro-bing. Windows exige modo privilegiado; no Linux o socket raw exige root
// (sem root usa ICMP por UDP, que depende de net.ipv4.ping_group_range); no macOS o UDP funciona.
func probePing(ctx context.Context, host string, timeout time.Duration) (pingResult, error) {
	p := probing.New(host)
	p.ResolveTimeout = timeout
	if err := p.Resolve(); err != nil {
		return pingResult{}, &resolveError{err}
	}
	p.SetLogger(probing.NoopLogger{})
	p.Count = pingCount
	p.Interval = 500 * time.Millisecond
	p.Timeout = timeout
	switch runtime.GOOS {
	case "windows":
		p.SetPrivileged(true)
	case "linux":
		p.SetPrivileged(os.Geteuid() == 0)
	}
	if err := p.RunWithContext(ctx); err != nil {
		return pingResult{}, err
	}
	s := p.Statistics()
	r := pingResult{Addr: host, Sent: s.PacketsSent, Recv: s.PacketsRecv, Loss: s.PacketLoss, Min: s.MinRtt, Avg: s.AvgRtt, Max: s.MaxRtt}
	if s.IPAddr != nil {
		r.IP = s.IPAddr.String()
	}
	return r, nil
}

// commandPing roda o ping do sistema; passa se houve ao menos uma resposta.
func commandPing(ctx context.Context, host string, timeout time.Duration) (bool, string, error) {
	var spec execx.Spec
	switch runtime.GOOS {
	case "windows":
		spec = execx.Spec{Path: "ping", Args: []string{"-n", fmt.Sprint(pingCount), "-w", "1000", host}}
	case "darwin":
		spec = execx.Spec{Path: "/sbin/ping", Args: []string{"-c", fmt.Sprint(pingCount), "-t", fmt.Sprint(int(timeout.Seconds())), host}}
	default:
		spec = execx.Spec{Path: "ping", Args: []string{"-c", fmt.Sprint(pingCount), "-W", "2", host}}
	}
	spec.Timeout = timeout + 5*time.Second
	res := execx.Run(ctx, spec)
	if res.Err != nil {
		return false, "", res.Err
	}
	out := strings.TrimSpace(res.Combined())
	ok := res.ExitCode == 0
	if runtime.GOOS == "windows" {
		// O ping do Windows sai com 0 em "host de destino inacessivel"; so TTL indica resposta real.
		ok = ok && strings.Contains(strings.ToUpper(out), "TTL=")
	}
	return ok, out, nil
}
