package speedtest

import (
	"math"
	"slices"
	"time"
)

// Report e o relatorio enviado ao servidor. Tempos em milissegundos, velocidades em Mbit/s.
type Report struct {
	Mode       string      `json:"mode"`
	StartedAt  time.Time   `json:"started_at"`
	FinishedAt time.Time   `json:"finished_at"`
	Server     TestServer  `json:"server"`
	Connection Connection  `json:"connection"`
	Network    Network     `json:"network"`
	Latency    Latency     `json:"latency"`
	DNS        []DNSLookup `json:"dns"`
	Download   Direction   `json:"download"`
	Upload     Direction   `json:"upload"`
	BytesUsed  int64       `json:"bytes_used"`
	// Warnings lista o que nao pode ser medido (ICMP sem permissao, Wi-Fi sem detalhes...).
	Warnings []string `json:"warnings,omitempty"`
}

// TestServer e o servidor de teste e o custo da primeira conexao com ele.
type TestServer struct {
	Provider  string  `json:"provider"`
	Host      string  `json:"host"`
	Colo      string  `json:"colo,omitempty"`
	DNSMs     float64 `json:"dns_ms,omitempty"`
	ConnectMs float64 `json:"connect_ms,omitempty"`
	TLSMs     float64 `json:"tls_ms,omitempty"`
	// TCPRttMs e o RTT do TCP medido pelo proprio servidor de teste.
	TCPRttMs float64 `json:"tcp_rtt_ms,omitempty"`
}

// Connection e a saida para a internet vista pelo servidor de teste.
type Connection struct {
	PublicIP string `json:"public_ip,omitempty"`
	ASN      int    `json:"asn,omitempty"`
	City     string `json:"city,omitempty"`
	Region   string `json:"region,omitempty"`
	Country  string `json:"country,omitempty"`
	Timezone string `json:"timezone,omitempty"`
	// Proxy indica que o trafego passou pelo proxy configurado no agente.
	Proxy bool `json:"proxy,omitempty"`
}

// Network e a interface de rede usada para sair para a internet.
type Network struct {
	Interface   string   `json:"interface,omitempty"`
	Description string   `json:"description,omitempty"`
	Type        string   `json:"type,omitempty"` // ethernet, wifi ou other
	LocalIP     string   `json:"local_ip,omitempty"`
	MAC         string   `json:"mac,omitempty"`
	MTU         int      `json:"mtu,omitempty"`
	LinkMbps    float64  `json:"link_mbps,omitempty"`
	Gateway     string   `json:"gateway,omitempty"`
	DNSServers  []string `json:"dns_servers,omitempty"`
	WiFi        *WiFi    `json:"wifi,omitempty"`
}

// WiFi descreve a associacao atual da interface sem fio.
type WiFi struct {
	SSID      string  `json:"ssid,omitempty"`
	BSSID     string  `json:"bssid,omitempty"`
	SignalPct int     `json:"signal_pct,omitempty"`
	RSSI      int     `json:"rssi_dbm,omitempty"`
	Noise     int     `json:"noise_dbm,omitempty"`
	Channel   int     `json:"channel,omitempty"`
	Band      string  `json:"band,omitempty"`
	Radio     string  `json:"radio,omitempty"`
	RxMbps    float64 `json:"rx_mbps,omitempty"`
	TxMbps    float64 `json:"tx_mbps,omitempty"`
}

// Stats resume uma serie de tempos em milissegundos.
type Stats struct {
	Samples int     `json:"samples"`
	Min     float64 `json:"min_ms"`
	Median  float64 `json:"median_ms"`
	Avg     float64 `json:"avg_ms"`
	P90     float64 `json:"p90_ms"`
	Max     float64 `json:"max_ms"`
	Jitter  float64 `json:"jitter_ms"`
}

// Latency reune a latencia ociosa ao servidor de teste e a de cada destino.
type Latency struct {
	Idle    Stats        `json:"idle"`
	Targets []PingTarget `json:"targets"`
}

// PingTarget e a medicao de um destino: gateway (rede local), DNS publicos (internet) e o servidor Cybereyes.
type PingTarget struct {
	Kind     string  `json:"kind"` // gateway, internet ou server
	Name     string  `json:"name"`
	Host     string  `json:"host"`
	Method   string  `json:"method"` // icmp ou http
	Sent     int     `json:"sent"`
	Received int     `json:"received"`
	LossPct  float64 `json:"loss_pct"`
	Stats    Stats   `json:"stats"`
	Error    string  `json:"error,omitempty"`
}

// DNSLookup e o tempo de resolucao de um nome pelo resolvedor do sistema.
type DNSLookup struct {
	Host      string   `json:"host"`
	Ms        float64  `json:"ms"`
	Addresses []string `json:"addresses,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// Stage e um degrau da medicao sequencial (uma conexao, requisicoes de um tamanho).
type Stage struct {
	Bytes      int64   `json:"bytes"`
	Count      int     `json:"count"`
	MedianMbps float64 `json:"median_mbps"`
	MaxMbps    float64 `json:"max_mbps"`
	MedianMs   float64 `json:"median_ms"`
}

// Direction e o resultado de download ou upload.
type Direction struct {
	// Mbps e o resultado final: a melhor entre a medicao sequencial e a com varias conexoes.
	Mbps       float64 `json:"mbps"`
	SingleMbps float64 `json:"single_mbps"`
	MultiMbps  float64 `json:"multi_mbps,omitempty"`
	Streams    int     `json:"streams,omitempty"`
	Stages     []Stage `json:"stages"`
	// Timeline e a vazao (Mbit/s) a cada TimelineStepMs durante a fase com varias conexoes, cada ponto
	// na janela dos dois ultimos passos.
	Timeline       []float64 `json:"timeline,omitempty"`
	TimelineStepMs int       `json:"timeline_step_ms,omitempty"`
	// Loaded e a latencia medida enquanto a banda estava ocupada.
	Loaded Stats `json:"loaded"`
	// RetransPct e a taxa de retransmissao TCP vista pelo servidor de teste (so no download).
	RetransPct float64 `json:"retrans_pct,omitempty"`
	Bytes      int64   `json:"bytes"`
	DurationMs float64 `json:"duration_ms"`
	Error      string  `json:"error,omitempty"`
}

// summarize resume tempos em milissegundos na ordem medida (o jitter e a media das diferencas
// entre amostras seguidas, como no RFC 3550 sem suavizacao).
func summarize(ms []float64) Stats {
	if len(ms) == 0 {
		return Stats{}
	}
	var jitter, sum float64
	for i, v := range ms {
		sum += v
		if i > 0 {
			jitter += math.Abs(v - ms[i-1])
		}
	}
	if len(ms) > 1 {
		jitter /= float64(len(ms) - 1)
	}
	sorted := slices.Clone(ms)
	slices.Sort(sorted)
	return Stats{
		Samples: len(ms),
		Min:     round2(sorted[0]),
		Median:  round2(percentile(sorted, 50)),
		Avg:     round2(sum / float64(len(ms))),
		P90:     round2(percentile(sorted, 90)),
		Max:     round2(sorted[len(sorted)-1]),
		Jitter:  round2(jitter),
	}
}

// percentile usa interpolacao linear numa serie ja ordenada.
func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	pos := p / 100 * float64(len(sorted)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return sorted[lo]
	}
	return sorted[lo] + (sorted[hi]-sorted[lo])*(pos-float64(lo))
}

func median(v []float64) float64 {
	s := slices.Clone(v)
	slices.Sort(s)
	return percentile(s, 50)
}

func mbps(bytes int64, d time.Duration) float64 {
	if d <= 0 {
		return 0
	}
	return float64(bytes) * 8 / d.Seconds() / 1e6
}

func msOf(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
