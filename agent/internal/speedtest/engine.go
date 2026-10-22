package speedtest

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/api"
	"github.com/pauloacruz/cybereyes/agent/internal/version"
)

// DefaultBaseURL e o servidor de teste da Cloudflare (o mesmo do speed.cloudflare.com).
const DefaultBaseURL = "https://speed.cloudflare.com"

// StageSpec e um degrau da medicao sequencial: Count requisicoes de Bytes.
type StageSpec struct {
	Bytes int64
	Count int
}

// Profile define quanto o teste mede. Os degraus seguem o metodo da Cloudflare: o tamanho sobe ate
// uma requisicao passar de FinishDuration, o que limita os dados gastos em links lentos.
type Profile struct {
	LatencySamples  int
	PingCount       int
	ServerSamples   int
	DownloadStages  []StageSpec
	UploadStages    []StageSpec
	FinishDuration  time.Duration
	StageBudget     time.Duration
	DirectionBudget time.Duration
	RequestLimit    time.Duration
	// Streams zero desliga a fase com varias conexoes (e a latencia sob carga).
	Streams       int
	StreamBytes   int64
	MultiDuration time.Duration
	RampUp        time.Duration
	Step          time.Duration
	ProbeEvery    time.Duration
}

// Profiles sao os perfis dos modos full e quick.
var Profiles = map[string]Profile{
	ModeFull: {
		LatencySamples: 20, PingCount: 10, ServerSamples: 10,
		DownloadStages:  []StageSpec{{100_000, 6}, {1_000_000, 6}, {10_000_000, 4}, {25_000_000, 3}, {100_000_000, 2}},
		UploadStages:    []StageSpec{{100_000, 6}, {1_000_000, 5}, {10_000_000, 4}, {25_000_000, 3}, {50_000_000, 2}},
		FinishDuration:  time.Second,
		StageBudget:     5 * time.Second,
		DirectionBudget: 14 * time.Second,
		RequestLimit:    8 * time.Second,
		Streams:         6, StreamBytes: 50_000_000,
		MultiDuration: 7 * time.Second, RampUp: 2 * time.Second, Step: 500 * time.Millisecond, ProbeEvery: 300 * time.Millisecond,
	},
	ModeQuick: {
		LatencySamples: 10, PingCount: 5, ServerSamples: 5,
		DownloadStages:  []StageSpec{{100_000, 4}, {1_000_000, 4}, {10_000_000, 3}, {25_000_000, 2}},
		UploadStages:    []StageSpec{{100_000, 4}, {1_000_000, 3}, {10_000_000, 2}},
		FinishDuration:  time.Second,
		StageBudget:     4 * time.Second,
		DirectionBudget: 8 * time.Second,
		RequestLimit:    6 * time.Second,
	},
}

// Config monta o motor.
type Config struct {
	Mode string
	// Proxy do agente (vazio: o do ambiente). O trafego do teste passa por ele, como o resto do EYES.
	Proxy string
	// BaseURL troca o servidor de teste (testes automatizados).
	BaseURL string
	// ServerURL e o servidor Cybereyes, medido por HTTP com as opcoes do agente.
	ServerURL     string
	ServerOptions api.Options
	// Progress recebe o andamento, sempre da goroutine do Run.
	Progress func(phase string, pct int, liveMbps float64)
	// Profile substitui o perfil do modo (testes automatizados).
	Profile *Profile
	// Network e Ping substituem a coleta da rede local e o ICMP (testes automatizados).
	Network func(ctx context.Context) (Network, []string)
	Ping    func(ctx context.Context, host string, count int) PingTarget
}

// Engine executa um teste.
type Engine struct {
	cfg    Config
	p      Profile
	base   string
	host   string
	client *http.Client // transferencias sequenciais e latencia ociosa
	probe  *http.Client // latencia durante a carga, numa conexao propria
	warn   []string
	used   atomic.Int64
}

// NewEngine prepara o motor do modo pedido.
func NewEngine(cfg Config) *Engine {
	p, ok := Profiles[cfg.Mode]
	if !ok {
		cfg.Mode = ModeFull
		p = Profiles[ModeFull]
	}
	if cfg.Profile != nil {
		p = *cfg.Profile
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.Progress == nil {
		cfg.Progress = func(string, int, float64) {}
	}
	if cfg.Network == nil {
		cfg.Network = collectNetwork
	}
	if cfg.Ping == nil {
		cfg.Ping = icmpPing
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	host := base
	if u, err := url.Parse(base); err == nil {
		host = u.Hostname()
	}
	return &Engine{cfg: cfg, p: p, base: base, host: host, client: newClient(cfg.Proxy), probe: newClient(cfg.Proxy)}
}

// newClient usa HTTP/1.1 (uma conexao TCP por fluxo, como os testes de velocidade medem) e sem
// compressao (o servidor manda zeros, que comprimiriam e falseariam a banda).
func newClient(proxy string) *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.DisableCompression = true
	tr.ForceAttemptHTTP2 = false
	tr.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
	tr.MaxIdleConnsPerHost = 16
	tr.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if proxy != "" {
		if u, err := url.Parse(proxy); err == nil {
			tr.Proxy = http.ProxyURL(u)
		}
	}
	return &http.Client{Transport: tr}
}

// Run mede tudo e devolve o relatorio. Erro so quando o servidor de teste nao responde: o resto
// (ICMP, Wi-Fi, DNS) entra como aviso no relatorio.
func (e *Engine) Run(ctx context.Context) (*Report, error) {
	defer e.client.CloseIdleConnections()
	defer e.probe.CloseIdleConnections()
	rep := &Report{Mode: e.cfg.Mode, StartedAt: time.Now().UTC(), Server: TestServer{Provider: "Cloudflare", Host: e.host}}
	rep.Connection.Proxy = e.cfg.Proxy != "" || proxyFromEnv(e.base)
	finish := func() *Report {
		rep.FinishedAt = time.Now().UTC()
		rep.BytesUsed = e.used.Load()
		rep.Warnings = e.warn
		return rep
	}

	e.cfg.Progress(PhaseNetwork, 2, 0)
	network, warnings := e.cfg.Network(ctx)
	rep.Network = network
	e.warn = append(e.warn, warnings...)

	e.cfg.Progress(PhaseLatency, 10, 0)
	if err := e.idleLatency(ctx, rep); err != nil {
		return finish(), fmt.Errorf("Sem resposta do servidor de teste %s: %w", e.host, err)
	}
	rep.Latency.Targets = e.targets(ctx, rep.Network.Gateway)
	rep.DNS = e.lookups(ctx)

	rep.Download = e.direction(ctx, PhaseDownload, 25, 60)
	rep.Upload = e.direction(ctx, PhaseUpload, 60, 95)
	if ctx.Err() != nil {
		return finish(), fmt.Errorf("Teste interrompido: %w", ctx.Err())
	}
	if rep.Download.Mbps == 0 && rep.Upload.Mbps == 0 {
		return finish(), fmt.Errorf("Nenhuma transferência concluída: %s", firstNonEmpty(rep.Download.Error, rep.Upload.Error, "erro desconhecido"))
	}
	e.cfg.Progress(PhaseFinishing, 97, 0)
	return finish(), nil
}

// idleLatency mede a latencia ociosa (a primeira amostra abre a conexao e e descartada) e le os
// dados da conexao que o servidor de teste devolve nos cabecalhos.
func (e *Engine) idleLatency(ctx context.Context, rep *Report) error {
	var samples []float64
	var lastErr error
	for i := 0; i <= e.p.LatencySamples; i++ {
		res, err := e.ping(ctx, e.client, i == 0)
		if err != nil {
			lastErr = err
			if ctx.Err() != nil {
				break
			}
			continue
		}
		if i == 0 {
			readMeta(res.header, rep)
			rep.Server.DNSMs, rep.Server.ConnectMs, rep.Server.TLSMs = round2(res.dnsMs), round2(res.connectMs), round2(res.tlsMs)
			continue
		}
		if l4 := parseL4(res.header); l4.rtt > 0 {
			rep.Server.TCPRttMs = round2(l4.rtt)
		}
		samples = append(samples, res.latencyMs)
		e.cfg.Progress(PhaseLatency, 10+8*i/max(1, e.p.LatencySamples), 0)
	}
	if len(samples) == 0 {
		if lastErr == nil {
			lastErr = errors.New("sem amostras")
		}
		return lastErr
	}
	rep.Latency.Idle = summarize(samples)
	return nil
}

type pingResult struct {
	latencyMs               float64
	dnsMs, connectMs, tlsMs float64
	header                  http.Header
}

// ping faz GET __down?bytes=0. Latencia = primeiro byte da resposta - fim do pedido - tempo de servidor.
func (e *Engine) ping(ctx context.Context, c *http.Client, setup bool) (pingResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var res pingResult
	var tt traceTimes
	trace := tt.trace(false)
	if setup {
		var dnsStart, connStart, tlsStart time.Time
		trace.DNSStart = func(httptrace.DNSStartInfo) { tt.set(&dnsStart) }
		trace.DNSDone = func(httptrace.DNSDoneInfo) { tt.span(&res.dnsMs, &dnsStart) }
		trace.ConnectStart = func(string, string) { tt.set(&connStart) }
		trace.ConnectDone = func(string, string, error) { tt.span(&res.connectMs, &connStart) }
		trace.TLSHandshakeStart = func() { tt.set(&tlsStart) }
		trace.TLSHandshakeDone = func(tls.ConnectionState, error) { tt.span(&res.tlsMs, &tlsStart) }
	}
	req, err := e.request(httptrace.WithClientTrace(ctx, trace), http.MethodGet, "/__down?bytes=0", nil, 0)
	if err != nil {
		return res, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return res, err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return res, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	tt.mu.Lock()
	ttfb := tt.first.Sub(tt.start)
	tt.mu.Unlock()
	res.latencyMs = msOf(ttfb) - serverTime(resp.Header)
	if res.latencyMs <= 0 {
		res.latencyMs = msOf(ttfb)
	}
	res.header = resp.Header
	return res, nil
}

func (e *Engine) request(ctx context.Context, method, path string, body io.Reader, size int64) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, e.base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", version.Name+"/"+version.Version+" speedtest")
	req.Header.Set("Cache-Control", "no-store")
	if body != nil {
		req.ContentLength = size
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	return req, nil
}

// direction mede download ou upload: degraus sequenciais e, no modo completo, varias conexoes.
func (e *Engine) direction(ctx context.Context, phase string, from, to int) Direction {
	upload := phase == PhaseUpload
	stages := e.p.DownloadStages
	if upload {
		stages = e.p.UploadStages
	}
	start := time.Now()
	expected := e.p.DirectionBudget + e.p.MultiDuration
	progress := func(live float64) {
		pct := from + int(float64(to-from)*min(1, float64(time.Since(start))/float64(expected)))
		e.cfg.Progress(phase, pct, live)
	}
	progress(0)

	var d Direction
	var all, short, sustained []float64
	var bytes int64
	deadline := start.Add(e.p.DirectionBudget)
	for _, st := range stages {
		var speeds, durations []float64
		stageStart := time.Now()
		finished := false
		for i := 0; i < st.Count && ctx.Err() == nil && time.Now().Before(deadline); i++ {
			n, dur, err := e.transfer(ctx, upload, st.Bytes, nil)
			bytes += n
			if err != nil {
				d.Error = err.Error()
				finished = true
				break
			}
			speed := mbps(n, dur)
			speeds, durations = append(speeds, speed), append(durations, msOf(dur))
			// O metodo da Cloudflare descarta transferencias curtas demais para medir banda.
			if dur >= 10*time.Millisecond {
				all = append(all, speed)
			} else {
				short = append(short, speed)
			}
			progress(speed)
			if dur >= e.p.FinishDuration {
				finished = true
				sustained = append(sustained, speed)
			}
			if time.Since(stageStart) >= e.p.StageBudget {
				break
			}
		}
		if len(speeds) > 0 {
			d.Stages = append(d.Stages, Stage{Bytes: st.Bytes, Count: len(speeds), MedianMbps: round2(median(speeds)),
				MaxMbps: round2(maxOf(speeds)), MedianMs: round2(median(durations))})
		}
		if finished || ctx.Err() != nil || !time.Now().Before(deadline) {
			break
		}
	}
	if len(all) == 0 {
		// So transferencias de menos de 10 ms (rede local muito rapida): melhor que nada.
		all = short
	}
	switch {
	case len(sustained) > 0:
		// Transferencias de 1 s ou mais: buffers do sistema e da borda do servidor ja nao inflam a conta
		// (no upload, 1 MB chegou a medir quase o dobro da banda real).
		d.SingleMbps = round2(median(sustained))
		d.Error = ""
	case len(all) > 0:
		// Link rapido demais para passar de 1 s: o percentil 90 do metodo da Cloudflare.
		d.SingleMbps = round2(percentile(sortedCopy(all), 90))
		d.Error = ""
	}
	if !upload && len(all) > 0 {
		// A conexao sequencial continua aberta: o servidor conta as retransmissoes do download nela.
		if res, err := e.ping(ctx, e.client, false); err == nil {
			if l4 := parseL4(res.header); l4.sent > 0 {
				d.RetransPct = round2(float64(l4.retrans) / float64(l4.sent) * 100)
			}
		}
	}

	if e.p.Streams > 0 && ctx.Err() == nil && len(all) > 0 {
		multi, timeline, loaded, n := e.multi(ctx, upload, progress)
		bytes += n
		d.MultiMbps, d.Streams, d.Timeline, d.TimelineStepMs, d.Loaded = round2(multi), e.p.Streams, timeline, int(e.p.Step/time.Millisecond), loaded
	}
	d.Mbps = round2(max(d.SingleMbps, d.MultiMbps))
	d.Bytes = bytes
	d.DurationMs = round2(msOf(time.Since(start)))
	return d
}

// transfer baixa ou envia size bytes. A duracao vai do fim do pedido (download) ou do inicio do
// corpo (upload) ate o fim; uma transferencia cortada pelo limite de tempo conta o que passou ate ali.
// Qualquer outra falha devolve erro sem medicao.
func (e *Engine) transfer(ctx context.Context, upload bool, size int64, counter *atomic.Int64) (int64, time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, e.p.RequestLimit)
	defer cancel()
	var tt traceTimes
	tctx := httptrace.WithClientTrace(ctx, tt.trace(upload))
	cut := func(n int64, err error) (int64, time.Duration, error) {
		elapsed := tt.since()
		if n > 0 && elapsed > 0 && errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return n, elapsed, nil
		}
		return 0, 0, err
	}
	if upload {
		body := &payload{remaining: size, counter: counter, used: &e.used}
		req, err := e.request(tctx, http.MethodPost, "/__up", body, size)
		if err != nil {
			return 0, 0, err
		}
		resp, err := e.client.Do(req)
		sent := size - body.remaining
		if err != nil {
			return cut(sent, err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return 0, 0, fmt.Errorf("HTTP %d no upload", resp.StatusCode)
		}
		// O servidor informa quanto tempo levou recebendo o corpo (cfSpeedWorker): e a medida certa,
		// porque o lado do agente so ve o corpo entrando nos buffers do sistema.
		if worker := serverTime(resp.Header, "cfSpeedWorker"); worker > 0 {
			return sent, time.Duration(worker * float64(time.Millisecond)), nil
		}
		tt.mu.Lock()
		defer tt.mu.Unlock()
		return sent, tt.first.Sub(tt.start), nil
	}

	req, err := e.request(tctx, http.MethodGet, "/__down?bytes="+strconv.FormatInt(size, 10), nil, 0)
	if err != nil {
		return 0, 0, err
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("HTTP %d no download", resp.StatusCode)
	}
	n, err := io.CopyBuffer(&counting{counter: counter, used: &e.used}, resp.Body, make([]byte, 64<<10))
	if err != nil {
		return cut(n, err)
	}
	elapsed := tt.since()
	if adjusted := elapsed - time.Duration(serverTime(resp.Header)*float64(time.Millisecond)); adjusted > 0 {
		elapsed = adjusted
	}
	return n, elapsed, nil
}

// traceTimes guarda os instantes do httptrace (os ganchos rodam nas goroutines do transporte).
type traceTimes struct {
	mu           sync.Mutex
	start, first time.Time
}

// trace marca o inicio no fim do pedido (download) ou no fim dos cabecalhos (upload, antes do corpo).
func (t *traceTimes) trace(upload bool) *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		WroteHeaders: func() {
			if upload {
				t.set(&t.start)
			}
		},
		WroteRequest: func(httptrace.WroteRequestInfo) {
			if !upload {
				t.set(&t.start)
			}
		},
		GotFirstResponseByte: func() { t.set(&t.first) },
	}
}

func (t *traceTimes) set(at *time.Time) {
	t.mu.Lock()
	*at = time.Now()
	t.mu.Unlock()
}

func (t *traceTimes) span(ms *float64, from *time.Time) {
	t.mu.Lock()
	*ms = msOf(time.Since(*from))
	t.mu.Unlock()
}

func (t *traceTimes) since() time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.start.IsZero() {
		return 0
	}
	return time.Since(t.start)
}

// multi ocupa a banda com varias conexoes por MultiDuration, mede a vazao a cada Step e, numa
// conexao a parte, a latencia sob carga. A vazao final descarta o RampUp (partida lenta do TCP).
// Cada ponto da linha do tempo cobre dois Steps: no upload o agente conta o que entra nos buffers do
// sistema, que enchem e esvaziam aos saltos, e um ponto por Step sairia serrilhado.
func (e *Engine) multi(ctx context.Context, upload bool, progress func(float64)) (float64, []float64, Stats, int64) {
	mctx, cancel := context.WithTimeout(ctx, e.p.MultiDuration)
	defer cancel()
	var counter atomic.Int64
	var wg sync.WaitGroup
	for range e.p.Streams {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for mctx.Err() == nil {
				if _, _, err := e.transfer(mctx, upload, e.p.StreamBytes, &counter); err != nil && mctx.Err() == nil {
					// Falha passageira numa conexao: espera um pouco e abre outra.
					sleepCtx(mctx, 200*time.Millisecond)
				}
			}
		}()
	}
	var loadedMu sync.Mutex
	var loaded []float64
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(e.p.ProbeEvery)
		defer t.Stop()
		for {
			select {
			case <-mctx.Done():
				return
			case <-t.C:
				if res, err := e.ping(mctx, e.probe, false); err == nil {
					loadedMu.Lock()
					loaded = append(loaded, res.latencyMs)
					loadedMu.Unlock()
				}
			}
		}
	}()

	start := time.Now()
	var timeline []float64
	var windowBytes int64
	windowSteps := 0
	prev, prevDelta := int64(0), int64(-1)
	tick := time.NewTicker(e.p.Step)
	defer tick.Stop()
loop:
	for {
		select {
		case <-mctx.Done():
			break loop
		case now := <-tick.C:
			cur := counter.Load()
			delta := cur - prev
			prev = cur
			speed := mbps(delta, e.p.Step)
			if prevDelta >= 0 {
				speed = mbps(delta+prevDelta, 2*e.p.Step)
			}
			prevDelta = delta
			timeline = append(timeline, round2(speed))
			if now.Sub(start) > e.p.RampUp {
				windowBytes += delta
				windowSteps++
			}
			progress(speed)
		}
	}
	cancel()
	wg.Wait()
	result := mbps(windowBytes, time.Duration(windowSteps)*e.p.Step)
	loadedMu.Lock()
	defer loadedMu.Unlock()
	return result, timeline, summarize(loaded), counter.Load()
}

// targets mede o gateway e os DNS publicos por ICMP e o servidor Cybereyes por HTTP, em paralelo.
func (e *Engine) targets(ctx context.Context, gateway string) []PingTarget {
	type job struct {
		kind, name, host string
	}
	jobs := []job{}
	if gateway != "" {
		jobs = append(jobs, job{"gateway", "Gateway da rede local", gateway})
	}
	jobs = append(jobs, job{"internet", "Cloudflare DNS", "1.1.1.1"}, job{"internet", "Google DNS", "8.8.8.8"})
	out := make([]PingTarget, len(jobs)+1)
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Go(func() {
			t := e.cfg.Ping(ctx, j.host, e.p.PingCount)
			t.Kind, t.Name, t.Host, t.Method = j.kind, j.name, j.host, "icmp"
			out[i] = t
		})
	}
	wg.Go(func() { out[len(jobs)] = e.serverLatency(ctx) })
	wg.Wait()
	icmpFailed := 0
	for _, t := range out[:len(jobs)] {
		if t.Error != "" {
			icmpFailed++
		}
	}
	if icmpFailed == len(jobs) {
		e.warn = append(e.warn, "Ping (ICMP) indisponível nesta máquina: perda de pacotes e latência da rede local não foram medidas")
	}
	e.cfg.Progress(PhaseLatency, 22, 0)
	return out
}

// serverLatency mede o servidor Cybereyes por HTTP (o que importa para o acesso remoto e os comandos).
func (e *Engine) serverLatency(ctx context.Context) PingTarget {
	t := PingTarget{Kind: "server", Name: "Servidor Cybereyes", Method: "http"}
	if e.cfg.ServerURL == "" {
		t.Error = "endereço do servidor desconhecido"
		return t
	}
	u, err := url.Parse(e.cfg.ServerURL)
	if err != nil {
		t.Error = err.Error()
		return t
	}
	t.Host = u.Hostname()
	tr, err := api.NewTransport(e.cfg.ServerOptions)
	if err != nil {
		t.Error = err.Error()
		return t
	}
	c := &http.Client{Transport: tr, Timeout: 5 * time.Second}
	defer c.CloseIdleConnections()
	var samples []float64
	for i := 0; i <= e.p.ServerSamples && ctx.Err() == nil; i++ {
		if i > 0 {
			t.Sent++
		}
		var tt traceTimes
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, tt.trace(false)), http.MethodGet, strings.TrimRight(e.cfg.ServerURL, "/")+"/", nil)
		if err != nil {
			t.Error = err.Error()
			break
		}
		resp, err := c.Do(req)
		if err != nil {
			t.Error = err.Error()
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		// A primeira abre a conexao (DNS, TCP e TLS) e nao entra na conta.
		if i > 0 {
			t.Received++
			tt.mu.Lock()
			samples = append(samples, msOf(tt.first.Sub(tt.start)))
			tt.mu.Unlock()
		}
	}
	if t.Sent > 0 {
		t.LossPct = round2(float64(t.Sent-t.Received) / float64(t.Sent) * 100)
	}
	if t.Received > 0 {
		t.Error = ""
	}
	t.Stats = summarize(samples)
	return t
}

// lookups mede a resolucao de nomes pelo resolvedor do sistema.
func (e *Engine) lookups(ctx context.Context) []DNSLookup {
	hosts := []string{e.host, "www.google.com", "www.microsoft.com"}
	if u, err := url.Parse(e.cfg.ServerURL); err == nil && u.Hostname() != "" && net.ParseIP(u.Hostname()) == nil {
		hosts = append(hosts, u.Hostname())
	}
	out := make([]DNSLookup, 0, len(hosts))
	for _, h := range hosts {
		if net.ParseIP(h) != nil {
			continue
		}
		lctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		start := time.Now()
		addrs, err := net.DefaultResolver.LookupHost(lctx, h)
		cancel()
		l := DNSLookup{Host: h, Ms: round2(msOf(time.Since(start)))}
		if err != nil {
			l.Error = err.Error()
		} else {
			l.Addresses = addrs[:min(3, len(addrs))]
		}
		out = append(out, l)
	}
	e.cfg.Progress(PhaseLatency, 24, 0)
	return out
}

// readMeta le os dados da conexao que o servidor de teste devolve em cada resposta.
func readMeta(h http.Header, rep *Report) {
	rep.Connection.PublicIP = firstNonEmpty(h.Get("cf-meta-ip"), h.Get("ip"))
	rep.Connection.ASN, _ = strconv.Atoi(firstNonEmpty(h.Get("cf-meta-asn"), h.Get("asn")))
	rep.Connection.City = unescape(firstNonEmpty(h.Get("cf-meta-city"), h.Get("city")))
	rep.Connection.Region = unescape(firstNonEmpty(h.Get("cf-meta-region"), h.Get("region")))
	rep.Connection.Country = firstNonEmpty(h.Get("cf-meta-country"), h.Get("country"))
	rep.Connection.Timezone = firstNonEmpty(h.Get("cf-meta-timezone"), h.Get("timezone"))
	rep.Server.Colo = firstNonEmpty(h.Get("cf-meta-colo"), h.Get("colo"))
	if rep.Server.Colo == "" {
		// CF-RAY termina com o codigo do datacenter: a4e94ee82c22f245-GRU.
		if _, colo, ok := strings.Cut(h.Get("cf-ray"), "-"); ok {
			rep.Server.Colo = colo
		}
	}
}

func unescape(s string) string {
	if u, err := url.QueryUnescape(s); err == nil {
		return u
	}
	return s
}

// processing sao as metricas do Server-Timing com o tempo de processamento do servidor de teste.
var processing = []string{"cfSpeedEdge", "cfSpeedWorker", "cfRequestDuration"}

// serverTime soma, em milissegundos, as metricas do Server-Timing pedidas (padrao: processing).
// No download o processamento vem antes do primeiro byte e nao cresce com o tamanho.
func serverTime(h http.Header, names ...string) float64 {
	if len(names) == 0 {
		names = processing
	}
	total := 0.0
	for _, v := range h.Values("Server-Timing") {
		for entry := range strings.SplitSeq(v, ",") {
			name, params, _ := strings.Cut(strings.TrimSpace(entry), ";")
			if !slices.Contains(names, name) {
				continue
			}
			for p := range strings.SplitSeq(params, ";") {
				if k, val, ok := strings.Cut(strings.TrimSpace(p), "="); ok && k == "dur" {
					if f, err := strconv.ParseFloat(val, 64); err == nil {
						total += f
					}
				}
			}
		}
	}
	return total
}

// l4 sao os contadores TCP que o servidor de teste devolve (Server-Timing cfL4).
type l4 struct {
	rtt           float64 // ms
	sent, retrans int
}

func parseL4(h http.Header) l4 {
	var out l4
	for _, v := range h.Values("Server-Timing") {
		_, desc, ok := strings.Cut(v, "cfL4;desc=")
		if !ok {
			continue
		}
		desc = strings.Trim(strings.SplitN(desc, ",", 2)[0], `"`)
		q, err := url.ParseQuery(strings.TrimPrefix(desc, "?"))
		if err != nil {
			continue
		}
		if us, err := strconv.ParseFloat(q.Get("rtt"), 64); err == nil {
			out.rtt = us / 1000
		}
		out.sent, _ = strconv.Atoi(q.Get("sent"))
		out.retrans, _ = strconv.Atoi(q.Get("retrans"))
	}
	return out
}

// payload e o corpo do upload: bytes aleatorios (um bloco repetido), contados conforme saem.
type payload struct {
	remaining int64
	counter   *atomic.Int64
	used      *atomic.Int64
}

var block = func() []byte {
	b := make([]byte, 64<<10)
	_, _ = rand.Read(b)
	return b
}()

func (p *payload) Read(b []byte) (int, error) {
	if p.remaining <= 0 {
		return 0, io.EOF
	}
	n := copy(b, block[:min(int64(len(block)), p.remaining)])
	p.remaining -= int64(n)
	if p.counter != nil {
		p.counter.Add(int64(n))
	}
	p.used.Add(int64(n))
	return n, nil
}

// counting conta os bytes baixados.
type counting struct {
	counter *atomic.Int64
	used    *atomic.Int64
}

func (c *counting) Write(b []byte) (int, error) {
	if c.counter != nil {
		c.counter.Add(int64(len(b)))
	}
	c.used.Add(int64(len(b)))
	return len(b), nil
}

func proxyFromEnv(base string) bool {
	req, err := http.NewRequest(http.MethodGet, base, nil)
	if err != nil {
		return false
	}
	u, err := http.ProxyFromEnvironment(req)
	return err == nil && u != nil
}

func sortedCopy(v []float64) []float64 {
	s := slices.Clone(v)
	slices.Sort(s)
	return s
}

func maxOf(v []float64) float64 {
	m := 0.0
	for _, x := range v {
		m = max(m, x)
	}
	return m
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
