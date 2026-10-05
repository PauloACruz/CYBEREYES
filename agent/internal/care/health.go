package care

import (
	"context"
	"fmt"
	"math"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"
)

// HealthReport e a resposta de wincare_health (CareService.CollectHealthAsync; front HealthReport).
type HealthReport struct {
	Score       int          `json:"score"`
	Grade       string       `json:"grade"`
	CollectedAt string       `json:"collectedAt"`
	Platform    string       `json:"platform"`
	Items       []HealthItem `json:"items"`
}

// HealthItem e um item verificado. status: ok, warning, critical ou unknown (nao conta na nota).
type HealthItem struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Category string `json:"category"`
	Status   string `json:"status"`
	Value    string `json:"value"`
	Detail   string `json:"detail"`
	Weight   int    `json:"weight"`
	Points   int    `json:"points"`
}

// Status e categorias dos itens.
const (
	hOK       = "ok"
	hWarning  = "warning"
	hCritical = "critical"
	hUnknown  = "unknown"

	catPerformance = "desempenho"
	catStorage     = "armazenamento"
	catStability   = "estabilidade"
	catSecurity    = "seguranca"
)

// healthDeadline limita a coleta inteira (o servidor espera ate 6 min).
const healthDeadline = 90 * time.Second

// probe coleta um ou mais itens. Sondas "first" rodam antes das demais, sozinhas (a amostra
// de CPU nao pode medir a carga das proprias sondas).
type probe struct {
	key, label, category string
	timeout              time.Duration
	first                bool
	fn                   func(ctx context.Context) []HealthItem
}

// CollectHealth roda as sondas da plataforma com tempo limite individual e monta o relatorio.
func CollectHealth(ctx context.Context) HealthReport {
	return collect(ctx, runtime.GOOS, platformProbes(), time.Now)
}

func collect(ctx context.Context, platform string, probes []probe, now func() time.Time) HealthReport {
	ctx, cancel := context.WithTimeout(ctx, healthDeadline)
	defer cancel()

	results := make([][]HealthItem, len(probes))
	run := func(i int) <-chan struct{} {
		done := make(chan struct{})
		go func() {
			defer close(done)
			p := probes[i]
			pctx, pcancel := context.WithTimeout(ctx, p.timeout)
			defer pcancel()
			ch := make(chan []HealthItem, 1)
			go func() {
				defer func() {
					if r := recover(); r != nil {
						ch <- []HealthItem{unknownItem(p, fmt.Sprintf("Falha na coleta: %v", r))}
					}
				}()
				ch <- p.fn(pctx)
			}()
			select {
			case items := <-ch:
				results[i] = items
			case <-pctx.Done():
				// A sonda que nao respeitou o prazo fica para tras; o relatorio sai sem ela.
				results[i] = []HealthItem{unknownItem(p, "Tempo esgotado na coleta")}
			}
		}()
		return done
	}
	for i, p := range probes {
		if p.first {
			<-run(i)
		}
	}
	var waits []<-chan struct{}
	for i, p := range probes {
		if !p.first {
			waits = append(waits, run(i))
		}
	}
	for _, w := range waits {
		<-w
	}

	rep := HealthReport{CollectedAt: now().UTC().Format(time.RFC3339), Platform: platform, Items: []HealthItem{}}
	for _, items := range results {
		for _, it := range items {
			rep.Items = append(rep.Items, finishItem(it))
		}
	}
	rep.Score, rep.Grade = score(rep.Items)
	return rep
}

// finishItem calcula os pontos pelo status: ok vale o peso, warning metade, critical zero;
// unknown (nao foi possivel avaliar) fica fora da conta.
func finishItem(it HealthItem) HealthItem {
	switch it.Status {
	case hOK:
		it.Points = it.Weight
	case hWarning:
		it.Points = it.Weight / 2
	case hCritical:
		it.Points = 0
	default:
		it.Status, it.Weight, it.Points = hUnknown, 0, 0
	}
	if it.Detail == "" && it.Status == hUnknown {
		it.Detail = "Nao foi possivel avaliar"
	}
	return it
}

// score = soma(points) / soma(weight) x 100, arredondado para inteiro (o servidor le com GetValue<int>).
func score(items []HealthItem) (int, string) {
	var p, w int
	for _, it := range items {
		p += it.Points
		w += it.Weight
	}
	if w == 0 {
		return 0, "critico"
	}
	s := int(math.Round(float64(p) * 100 / float64(w)))
	s = max(0, min(100, s))
	return s, gradeFor(s)
}

func gradeFor(s int) string {
	switch {
	case s >= 90:
		return "otimo"
	case s >= 75:
		return "bom"
	case s >= 50:
		return "atencao"
	}
	return "critico"
}

func unknownItem(p probe, detail string) HealthItem {
	return HealthItem{Key: p.key, Label: p.label, Category: p.category, Status: hUnknown, Detail: detail}
}

// --- Itens comuns aos tres sistemas -------------------------------------------------

func cpuLoadItem(load5 float64, cpus int) HealthItem {
	it := HealthItem{Key: "cpu", Label: "Carga de CPU", Category: catPerformance, Weight: 10}
	cpus = max(cpus, 1)
	ratio := load5 / float64(cpus)
	it.Value = fmt.Sprintf("%.2f (%d nucleos)", load5, cpus)
	it.Detail = "Carga media de 5 minutos por nucleo: " + fmt.Sprintf("%.2f", ratio)
	switch {
	case ratio < 1:
		it.Status = hOK
	case ratio < 2:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	return it
}

func cpuUsageItem(pct float64) HealthItem {
	it := HealthItem{Key: "cpu", Label: "Uso de CPU", Category: catPerformance, Weight: 10}
	it.Value = fmt.Sprintf("%.0f%%", pct)
	it.Detail = "Amostra de 2 segundos"
	switch {
	case pct < 80:
		it.Status = hOK
	case pct < 95:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	return it
}

func memoryItem(total, avail uint64) HealthItem {
	it := HealthItem{Key: "memory", Label: "Memoria", Category: catPerformance, Weight: 10}
	if total == 0 {
		it.Status = hUnknown
		return it
	}
	avail = min(avail, total)
	used := float64(total-avail) * 100 / float64(total)
	it.Value = fmt.Sprintf("%.0f%% em uso", used)
	it.Detail = fmt.Sprintf("%s livres de %s", humanBytes(avail), humanBytes(total))
	switch {
	case used < 85:
		it.Status = hOK
	case used < 95:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	return it
}

// diskItem avalia o espaco livre de um volume: ok com 15% livres (ou 50 GB), warning com 5%.
func diskItem(mount string, total, free uint64, system bool) HealthItem {
	it := HealthItem{Key: "disk:" + mount, Label: "Espaco livre em " + mount, Category: catStorage, Weight: 5}
	if system {
		it.Weight = 15
	}
	if total == 0 {
		it.Status = hUnknown
		return it
	}
	free = min(free, total)
	pct := float64(free) * 100 / float64(total)
	it.Value = fmt.Sprintf("%.0f%% livre", pct)
	it.Detail = fmt.Sprintf("%s livres de %s", humanBytes(free), humanBytes(total))
	const big = 50 << 30
	switch {
	case pct >= 15 || free >= big:
		it.Status = hOK
	case pct >= 5:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	return it
}

func uptimeItem(up time.Duration) HealthItem {
	it := HealthItem{Key: "uptime", Label: "Tempo ligado", Category: catStability, Weight: 5, Value: humanUptime(up)}
	if up >= 30*24*time.Hour {
		it.Status = hWarning
		it.Detail = "Ligado ha mais de 30 dias sem reiniciar"
	} else {
		it.Status = hOK
	}
	return it
}

func rebootItem(reasons []string) HealthItem {
	it := HealthItem{Key: "pending_reboot", Label: "Reinicio pendente", Category: catStability, Weight: 10}
	if len(reasons) == 0 {
		it.Status, it.Value = hOK, "Nao"
		return it
	}
	it.Status, it.Value, it.Detail = hWarning, "Sim", strings.Join(reasons, "; ")
	return it
}

// servicesItem: 0 ok, 1 ou 2 warning, 3 ou mais critical.
func servicesItem(label string, failed []string) HealthItem {
	it := HealthItem{Key: "services", Label: label, Category: catStability, Weight: 10}
	sort.Strings(failed)
	it.Value = fmt.Sprintf("%d", len(failed))
	switch {
	case len(failed) == 0:
		it.Status = hOK
	case len(failed) <= 2:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	it.Detail = joinLimited(failed, 10)
	return it
}

// errorsItem: erros de sistema nas ultimas 24 h (ate 10 ok, ate 100 warning).
func errorsItem(count int, bySource map[string]int, critical int) HealthItem {
	it := HealthItem{Key: "system_errors", Label: "Erros de sistema (24 h)", Category: catStability, Weight: 10, Value: fmt.Sprintf("%d", count)}
	switch {
	case count <= 10:
		it.Status = hOK
	case count <= 100:
		it.Status = hWarning
	default:
		it.Status = hCritical
	}
	if critical > 0 && it.Status == hOK {
		it.Status = hWarning
	}
	type kv struct {
		k string
		v int
	}
	var top []kv
	for k, v := range bySource {
		top = append(top, kv{k, v})
	}
	sort.Slice(top, func(i, j int) bool {
		if top[i].v != top[j].v {
			return top[i].v > top[j].v
		}
		return top[i].k < top[j].k
	})
	var parts []string
	if critical > 0 {
		parts = append(parts, fmt.Sprintf("%d critico(s)", critical))
	}
	for i, e := range top {
		if i == 3 {
			break
		}
		parts = append(parts, fmt.Sprintf("%s: %d", e.k, e.v))
	}
	it.Detail = strings.Join(parts, "; ")
	return it
}

// updatesItem: sem pendencias ok; com atualizacoes de seguranca critical; demais warning.
func updatesItem(total, security int, detail string) HealthItem {
	it := HealthItem{Key: "updates", Label: "Atualizacoes pendentes", Category: catSecurity, Weight: 15, Detail: detail}
	switch {
	case total == 0:
		it.Status, it.Value = hOK, "Nenhuma"
	case security > 0:
		it.Status, it.Value = hCritical, fmt.Sprintf("%d (%d de seguranca)", total, security)
	default:
		it.Status, it.Value = hWarning, fmt.Sprintf("%d", total)
	}
	return it
}

// --- Utilitarios ------------------------------------------------------------------

// runCmd executa um comando com o prazo do contexto e devolve stdout, stderr e o codigo de saida.
func runCmd(ctx context.Context, env []string, name string, args ...string) (string, string, int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if env != nil {
		cmd.Env = append(cmd.Environ(), env...)
	}
	cmd.WaitDelay = 2 * time.Second
	var out, errb strings.Builder
	cmd.Stdout = &limitedWriter{w: &out, n: 4 << 20}
	cmd.Stderr = &limitedWriter{w: &errb, n: 1 << 20}
	prepareProbe(cmd)
	err := cmd.Run()
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	if ctx.Err() != nil {
		return out.String(), errb.String(), code, ctx.Err()
	}
	if _, ok := err.(*exec.ExitError); ok {
		err = nil
	}
	return out.String(), errb.String(), code, err
}

type limitedWriter struct {
	w *strings.Builder
	n int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if room := l.n - l.w.Len(); room > 0 {
		if len(p) > room {
			l.w.Write(p[:room])
		} else {
			l.w.Write(p)
		}
	}
	return len(p), nil
}

func humanBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit && exp < 4; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTP"[exp])
}

func humanUptime(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	switch {
	case days > 0:
		return fmt.Sprintf("%d dia(s) e %d h", days, hours)
	case hours > 0:
		return fmt.Sprintf("%d h e %d min", hours, int(d.Minutes())%60)
	}
	return fmt.Sprintf("%d min", int(d.Minutes()))
}

func joinLimited(list []string, n int) string {
	if len(list) <= n {
		return strings.Join(list, ", ")
	}
	return strings.Join(list[:n], ", ") + fmt.Sprintf(" e mais %d", len(list)-n)
}
