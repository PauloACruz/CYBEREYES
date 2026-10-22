package speedtest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pauloacruz/cybereyes/agent/internal/rpc"
)

// fakeServer imita o servidor de teste da Cloudflare: __down devolve zeros e os cabecalhos de meta,
// __up le o corpo e informa o tempo de recebimento em cfSpeedWorker; "/" faz o papel do Cybereyes.
func fakeServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__down":
			n, _ := strconv.Atoi(r.URL.Query().Get("bytes"))
			h := w.Header()
			h.Set("cf-meta-ip", "200.100.50.25")
			h.Set("asn", "28573")
			h.Set("city", "S%C3%A3o%20Paulo")
			h.Set("country", "BR")
			h.Set("colo", "GRU")
			h.Set("timezone", "America/Sao_Paulo")
			h.Add("Server-Timing", "cfSpeedEdge;dur=1, cfSpeedWorker;dur=1")
			h.Add("Server-Timing", `cfL4;desc="?proto=TCP&rtt=12500&min_rtt=12000&sent=1000&recv=50&lost=0&retrans=5"`)
			h.Set("Content-Length", strconv.Itoa(n))
			buf := make([]byte, 32<<10)
			for n > 0 {
				k := min(n, len(buf))
				if _, err := w.Write(buf[:k]); err != nil {
					return
				}
				n -= k
			}
		case "/__up":
			start := time.Now()
			n, _ := io.Copy(io.Discard, r.Body)
			w.Header().Set("cf-meta-upload-bytes", strconv.FormatInt(n, 10))
			w.Header().Set("Server-Timing", fmt.Sprintf("cfSpeedEdge;dur=1, cfSpeedWorker;dur=%.3f", msOf(time.Since(start))+1))
		case "/":
			_, _ = w.Write([]byte("<html></html>"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func tinyProfile() *Profile {
	return &Profile{
		LatencySamples: 3, PingCount: 2, ServerSamples: 2,
		DownloadStages:  []StageSpec{{1_000, 2}, {200_000, 2}},
		UploadStages:    []StageSpec{{1_000, 2}, {200_000, 2}},
		FinishDuration:  time.Second,
		StageBudget:     2 * time.Second,
		DirectionBudget: 3 * time.Second,
		RequestLimit:    2 * time.Second,
		Streams:         2, StreamBytes: 300_000,
		MultiDuration: 800 * time.Millisecond, RampUp: 100 * time.Millisecond, Step: 100 * time.Millisecond, ProbeEvery: 50 * time.Millisecond,
	}
}

func fakeEngine(srv *httptest.Server, progress func(string, int, float64)) *Engine {
	return NewEngine(Config{
		Mode: ModeFull, BaseURL: srv.URL, ServerURL: srv.URL, Profile: tinyProfile(), Progress: progress,
		Network: func(context.Context) (Network, []string) {
			return Network{Interface: "eth0", Type: "ethernet", LocalIP: "192.168.0.10", Gateway: "192.168.0.1", LinkMbps: 1000}, nil
		},
		Ping: func(_ context.Context, host string, count int) PingTarget {
			if host == "8.8.8.8" {
				return PingTarget{Error: "sem permissao"}
			}
			return PingTarget{Sent: count, Received: count, Stats: summarize([]float64{1, 2})}
		},
	})
}

func TestEngineMeasuresEverything(t *testing.T) {
	srv := fakeServer(t)
	var phases []string
	rep, err := fakeEngine(srv, func(phase string, pct int, _ float64) {
		if len(phases) == 0 || phases[len(phases)-1] != phase {
			phases = append(phases, phase)
		}
		if pct < 0 || pct > 100 {
			t.Errorf("andamento fora da faixa: %d", pct)
		}
	}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{PhaseNetwork, PhaseLatency, PhaseDownload, PhaseUpload, PhaseFinishing}; strings.Join(phases, ",") != strings.Join(want, ",") {
		t.Errorf("fases = %v, quero %v", phases, want)
	}
	if rep.Connection.PublicIP != "200.100.50.25" || rep.Connection.City != "São Paulo" || rep.Connection.ASN != 28573 || rep.Server.Colo != "GRU" {
		t.Errorf("conexao = %+v, servidor = %+v", rep.Connection, rep.Server)
	}
	if rep.Server.TCPRttMs != 12.5 {
		t.Errorf("RTT do TCP = %v", rep.Server.TCPRttMs)
	}
	if rep.Latency.Idle.Samples != 3 {
		t.Errorf("amostras de latencia = %d (a primeira, que abre a conexao, nao conta)", rep.Latency.Idle.Samples)
	}
	kinds := map[string]PingTarget{}
	for _, tg := range rep.Latency.Targets {
		kinds[tg.Host] = tg
	}
	if kinds["192.168.0.1"].Kind != "gateway" || kinds["1.1.1.1"].Kind != "internet" || kinds["8.8.8.8"].Error == "" {
		t.Errorf("destinos = %+v", rep.Latency.Targets)
	}
	if s := kinds["127.0.0.1"]; s.Kind != "server" || s.Method != "http" || s.Received != 2 || s.Error != "" {
		t.Errorf("servidor Cybereyes = %+v", s)
	}
	for _, d := range []Direction{rep.Download, rep.Upload} {
		if d.Mbps <= 0 || d.SingleMbps <= 0 || d.MultiMbps <= 0 || d.Streams != 2 || len(d.Stages) != 2 || len(d.Timeline) == 0 || d.Loaded.Samples == 0 {
			t.Errorf("direcao incompleta: %+v", d)
		}
	}
	if rep.Download.RetransPct != 0.5 {
		t.Errorf("retransmissao = %v, quero 0.5 (5 de 1000)", rep.Download.RetransPct)
	}
	if rep.BytesUsed < rep.Download.Bytes+rep.Upload.Bytes {
		t.Errorf("bytes usados = %d, menos que download %d + upload %d", rep.BytesUsed, rep.Download.Bytes, rep.Upload.Bytes)
	}
	if len(rep.DNS) == 0 || rep.FinishedAt.Before(rep.StartedAt) {
		t.Errorf("dns = %+v, inicio %v, fim %v", rep.DNS, rep.StartedAt, rep.FinishedAt)
	}
}

func TestEngineFailsWithoutTestServer(t *testing.T) {
	srv := fakeServer(t)
	srv.Close()
	rep, err := fakeEngine(srv, nil).Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Sem resposta do servidor de teste") {
		t.Fatalf("erro = %v", err)
	}
	if rep == nil || rep.Network.Interface != "eth0" {
		t.Errorf("o relatorio parcial deve trazer a rede local: %+v", rep)
	}
}

// fakeRest guarda os PATCHes enviados ao servidor.
type fakeRest struct {
	mu      sync.Mutex
	paths   []string
	updates []update
}

func (f *fakeRest) Patch(_ context.Context, path string, body, _ any) error {
	b, _ := json.Marshal(body)
	var u update
	_ = json.Unmarshal(b, &u)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.paths = append(f.paths, path)
	f.updates = append(f.updates, u)
	return nil
}

func TestCommandRunsAndReports(t *testing.T) {
	srv := fakeServer(t)
	rest := &fakeRest{}
	var modes []string
	w := &worker{
		api: rest, agentID: "agente/1", log: slog.New(slog.DiscardHandler),
		spawn: func(_ string, fn func(ctx context.Context)) { fn(context.Background()) },
		newEngine: func(mode string, progress func(string, int, float64)) *Engine {
			modes = append(modes, mode)
			return fakeEngine(srv, progress)
		},
	}
	reg := rpc.NewRegistry(slog.New(slog.DiscardHandler))
	w.register(reg)

	if got := reg.Dispatch(context.Background(), rpc.Request{"func": "speedtest"}); got != "error: speedtest_pk invalido" {
		t.Errorf("sem pk = %v", got)
	}
	if got := reg.Dispatch(context.Background(), rpc.Request{"func": "speedtest", "speedtest_pk": 42, "mode": "qualquer"}); got != "ok" {
		t.Fatalf("resposta = %v", got)
	}
	if len(modes) != 1 || modes[0] != ModeFull {
		t.Errorf("modo desconhecido deve virar full: %v", modes)
	}
	if len(rest.updates) < 3 {
		t.Fatalf("esperava andamento e resultado, veio %d envios", len(rest.updates))
	}
	if rest.paths[0] != "/api/v4/agente%2F1/42/speedtest/" {
		t.Errorf("rota = %s", rest.paths[0])
	}
	if first := rest.updates[0]; first.Status != "running" || first.Phase != PhaseNetwork {
		t.Errorf("primeiro envio = %+v", first)
	}
	last := rest.updates[len(rest.updates)-1]
	if last.Status != "completed" || last.Progress != 100 || last.Report == nil || last.Report.Download.Mbps <= 0 {
		t.Errorf("resultado = %+v", last)
	}

	// Com um teste em andamento, o segundo pedido falha na hora em vez de dividir a banda.
	w.mu.Lock()
	reg.Dispatch(context.Background(), rpc.Request{"func": "speedtest", "speedtest_pk": 43, "mode": ModeQuick})
	w.mu.Unlock()
	if got := rest.updates[len(rest.updates)-1]; got.Status != "failed" || !strings.Contains(got.Error, "em andamento") {
		t.Errorf("teste simultaneo = %+v", got)
	}
}

func TestSummarize(t *testing.T) {
	s := summarize([]float64{10, 30, 20, 40})
	if s.Samples != 4 || s.Min != 10 || s.Max != 40 || s.Median != 25 || s.Avg != 25 || s.P90 != 37 {
		t.Errorf("stats = %+v", s)
	}
	// Diferencas seguidas: 20, 10, 20.
	if s.Jitter != 16.67 {
		t.Errorf("jitter = %v", s.Jitter)
	}
	if (summarize(nil) != Stats{}) {
		t.Error("serie vazia deve dar zeros")
	}
}

func TestServerTimingAndL4(t *testing.T) {
	h := http.Header{}
	h.Add("Server-Timing", "cfSpeedEdge;dur=3, cfSpeedWorker;dur=22")
	h.Add("Server-Timing", `cfL4;desc="?proto=TCP&rtt=54376&min_rtt=54275&sent=200&recv=7&lost=0&retrans=3&x=0"`)
	if got := serverTime(h); got != 25 {
		t.Errorf("tempo de servidor = %v", got)
	}
	if got := serverTime(h, "cfSpeedWorker"); got != 22 {
		t.Errorf("tempo do worker = %v", got)
	}
	l := parseL4(h)
	if l.rtt != 54.376 || l.sent != 200 || l.retrans != 3 {
		t.Errorf("cfL4 = %+v", l)
	}
	old := http.Header{"Server-Timing": {"cfRequestDuration;dur=7.5"}}
	if got := serverTime(old); got != 7.5 {
		t.Errorf("formato antigo = %v", got)
	}
}

func TestReadMetaFallsBackToRay(t *testing.T) {
	var rep Report
	readMeta(http.Header{"Cf-Ray": {"a4e94ee82c22f245-GIG"}, "Cf-Meta-Ip": {"10.1.1.1"}}, &rep)
	if rep.Server.Colo != "GIG" || rep.Connection.PublicIP != "10.1.1.1" {
		t.Errorf("meta = %+v %+v", rep.Server, rep.Connection)
	}
}
