using System.Globalization;

namespace Cybereyes.Api.Rmm.SpeedTest;

/// <summary>Achado do diagnostico. <c>Severity</c>: critical, warning, info ou ok.</summary>
public sealed record SpeedTestFinding(string Severity, string Title, string Detail);

/// <summary>Adequacao da conexao a um uso. <c>Rating</c>: great, good ou poor.</summary>
public sealed record SpeedTestUsage(string Key, string Label, string Rating, string Detail);

/// <summary>Quanto a latencia sobe com a banda ocupada e a nota (escala do teste de bufferbloat da Waveform).</summary>
public sealed record SpeedTestBloat(double LoadedMs, double AddedMs, string Grade);

/// <summary>Leitura do relatorio para o console e o PDF. <c>Quality</c>: excellent, good, fair ou poor.</summary>
public sealed record SpeedTestAnalysis(
    string Quality,
    double? LatencyMs,
    double? JitterMs,
    double? LossPct,
    double? ServerLatencyMs,
    SpeedTestBloat? DownloadBloat,
    SpeedTestBloat? UploadBloat,
    string? BloatGrade,
    double? PlanDownloadPct,
    double? PlanUploadPct,
    List<SpeedTestUsage> Usage,
    List<SpeedTestFinding> Findings);

/// <summary>
/// Analisa o relatorio: os limites seguem as recomendacoes publicas dos servicos (Teams/Meet/Zoom para chamadas em HD, Netflix
/// e YouTube para 4K, 50 ms para jogos) e a escala de bufferbloat da Waveform. A latencia dos usos e a ociosa; a sob carga
/// entra na nota de bufferbloat e no diagnostico.
/// </summary>
public static class SpeedTestAnalyzer
{
    private static readonly CultureInfo PtBr = Reports.ReportCulture.PtBr;
    private static readonly string[] Order = ["critical", "warning", "info", "ok"];

    public static SpeedTestAnalysis Analyze(SpeedTestReport r, double? planDownload, double? planUpload)
    {
        var down = r.Download.Mbps;
        var up = r.Upload.Mbps;
        double? latency = r.Latency.Idle.Samples > 0 ? r.Latency.Idle.MedianMs : null;
        double? jitter = r.Latency.Idle.Samples > 0 ? r.Latency.Idle.JitterMs : null;
        var internet = r.Latency.Targets.Where(t => t.Kind == "internet" && t.Sent > 0 && t.Error.Length == 0).ToList();
        double? loss = internet.Count > 0 ? Math.Round(internet.Average(t => t.LossPct), 2) : null;
        var server = r.Latency.Targets.FirstOrDefault(t => t.Kind == "server" && t.Received > 0);
        double? serverLatency = server?.Stats.MedianMs;
        var gateway = r.Latency.Targets.FirstOrDefault(t => t.Kind == "gateway" && t.Sent > 0 && t.Error.Length == 0);

        var downBloat = Bloat(r.Download.Loaded, latency);
        var upBloat = Bloat(r.Upload.Loaded, latency);
        var worstBloat = new[] { downBloat, upBloat }.Where(b => b is not null).MaxBy(b => b!.AddedMs);
        double? planDown = planDownload is > 0 && down > 0 ? Math.Round(down / planDownload.Value * 100, 1) : null;
        double? planUp = planUpload is > 0 && up > 0 ? Math.Round(up / planUpload.Value * 100, 1) : null;

        var lat = latency ?? double.MaxValue;
        var jit = jitter ?? double.MaxValue;
        var los = loss ?? 0;
        var usage = new List<SpeedTestUsage>
        {
            Rate("browsing", "Navegação, e-mail e sistemas web",
                down >= 10 && lat <= 100 ? "great" : down >= 3 && lat <= 300 ? "good" : "poor",
                $"Download de {Mbps(down)} e latência de {Ms(latency)}"),
            Rate("video_calls", "Videochamadas (Teams, Meet, Zoom)",
                down >= 5 && up >= 3 && lat <= 100 && jit <= 30 && los <= 1 ? "great"
                : down >= 2.5 && up >= 1.5 && lat <= 200 && jit <= 50 && los <= 3 ? "good" : "poor",
                $"Chamada em HD pede cerca de 3 Mbit/s em cada sentido, latência abaixo de 100 ms e jitter abaixo de 30 ms; upload de {Mbps(up)}, jitter de {Ms(jitter)}"),
            Rate("streaming", "Streaming de vídeo",
                down >= 25 ? "great" : down >= 5 ? "good" : "poor",
                down >= 25 ? "Comporta vídeo em 4K (25 Mbit/s)" : down >= 5 ? "Comporta vídeo em HD (5 Mbit/s), não em 4K" : "Abaixo do necessário para vídeo em HD (5 Mbit/s)"),
            Rate("gaming", "Jogos online e aplicações em tempo real",
                lat <= 50 && jit <= 10 && los <= 0.5 ? "great" : lat <= 100 && jit <= 30 && los <= 2 ? "good" : "poor",
                $"Latência de {Ms(latency)}, jitter de {Ms(jitter)} e perda de {Pct(loss)}"),
            Rate("remote_access", "Acesso remoto pelo Cybereyes",
                (serverLatency ?? lat) <= 80 && up >= 5 ? "great" : (serverLatency ?? lat) <= 200 && up >= 1.5 ? "good" : "poor",
                $"Latência até o servidor Cybereyes de {Ms(serverLatency)} e upload (a tela sai desta máquina) de {Mbps(up)}"),
            Rate("cloud_backup", "Backup e envio de arquivos para a nuvem",
                up >= 20 ? "great" : up >= 5 ? "good" : "poor",
                $"Upload de {Mbps(up)}: 1 GB leva cerca de {Duration(up > 0 ? 8000 / up : null)}"),
        };

        var findings = Findings(r, latency, jitter, loss, serverLatency, gateway, worstBloat, planDown, planUp, planDownload, planUpload);
        var quality = down >= 50 && up >= 10 && lat <= 50 && los <= 0.5 && worstBloat?.Grade is null or "A+" or "A" or "B" ? "excellent"
            : down >= 10 && up >= 3 && lat <= 100 && los <= 1 ? "good"
            : down >= 3 && up >= 1 && lat <= 200 && los <= 3 ? "fair"
            : "poor";
        // Latencia que dispara com a banda ocupada ou perda forte na rede local derrubam o uso em tempo real: no maximo "regular".
        if (quality is "excellent" or "good" && (worstBloat?.Grade is "D" or "F" || gateway?.LossPct >= 5))
        {
            quality = "fair";
        }
        return new SpeedTestAnalysis(quality, latency, jitter, loss, serverLatency, downBloat, upBloat, worstBloat?.Grade, planDown, planUp, usage, findings);
    }

    private static SpeedTestUsage Rate(string key, string label, string rating, string detail) => new(key, label, rating, detail);

    private static SpeedTestBloat? Bloat(SpeedTestStats loaded, double? idle)
    {
        if (loaded.Samples == 0 || idle is null)
        {
            return null;
        }
        var added = Math.Max(0, Math.Round(loaded.MedianMs - idle.Value, 1));
        var grade = added switch { < 5 => "A+", < 30 => "A", < 60 => "B", < 200 => "C", < 400 => "D", _ => "F" };
        return new SpeedTestBloat(loaded.MedianMs, added, grade);
    }

    private static List<SpeedTestFinding> Findings(SpeedTestReport r, double? latency, double? jitter, double? loss, double? serverLatency,
        SpeedTestTarget? gateway, SpeedTestBloat? bloat, double? planDown, double? planUp, double? planDownload, double? planUpload)
    {
        var f = new List<SpeedTestFinding>();
        var net = r.Network;
        var down = r.Download.Mbps;
        var up = r.Upload.Mbps;

        if (net.Wifi is { } wifi)
        {
            var weak = wifi.SignalPct is > 0 and < 40 || wifi.RssiDbm < -75;
            var fair = wifi.SignalPct is > 0 and < 60 || wifi.RssiDbm < -67;
            var signal = wifi.SignalPct > 0 ? $"{wifi.SignalPct}%" : $"{wifi.RssiDbm} dBm";
            if (weak)
            {
                f.Add(new("warning", $"Sinal de Wi-Fi fraco ({signal})",
                    "A máquina está longe do roteador ou há barreiras no caminho. Aproxime a máquina, instale um repetidor/mesh ou use cabo."));
            }
            else if (fair)
            {
                f.Add(new("info", $"Sinal de Wi-Fi razoável ({signal})", "Funciona, mas a velocidade e a estabilidade caem com interferência ou distância."));
            }
            if (wifi.Band.StartsWith('2'))
            {
                f.Add(new("info", "Wi-Fi em 2,4 GHz",
                    "A faixa de 2,4 GHz é mais lenta e sofre mais interferência. Se o roteador oferecer 5 GHz, conecte a máquina nessa rede."));
            }
            if (wifi.RxMbps > 0 && down >= wifi.RxMbps * 0.6)
            {
                f.Add(new("warning", $"A conexão Wi-Fi limita a velocidade ({Mbps(wifi.RxMbps)})",
                    "O download chegou perto da taxa do Wi-Fi: a internet pode ser mais rápida do que o medido. Teste com cabo para confirmar."));
            }
        }
        else if (net.Type == "ethernet" && net.LinkMbps is > 0 and <= 100)
        {
            var limited = down >= net.LinkMbps * 0.8;
            f.Add(new(net.LinkMbps <= 10 || limited ? "warning" : "info", $"Placa de rede conectada a {Mbps(net.LinkMbps)}",
                (limited ? "O download bateu no limite do cabo. " : string.Empty) +
                "Placas e switches atuais negociam 1 Gbit/s: confira o cabo (Cat5e ou Cat6), o conector e a porta do switch."));
        }

        if (gateway is not null)
        {
            if (gateway.LossPct > 0)
            {
                f.Add(new(gateway.LossPct >= 5 ? "critical" : "warning", $"Perda de pacotes na rede local ({Pct(gateway.LossPct)})",
                    "Pacotes se perdem antes de sair do escritório: verifique o Wi-Fi, o cabo, o switch e o roteador."));
            }
            var limit = net.Type == "wifi" ? 20 : 5;
            if (gateway.Stats.MedianMs > limit)
            {
                f.Add(new("warning", $"Latência alta até o roteador ({Ms(gateway.Stats.MedianMs)})",
                    $"Na rede local o esperado é menos de {limit} ms. Rede congestionada, Wi-Fi com interferência ou roteador sobrecarregado."));
            }
        }

        if (loss is >= 1)
        {
            f.Add(new(loss >= 5 ? "critical" : "warning", $"Perda de pacotes na internet ({Pct(loss)})",
                "Chamadas cortam e páginas demoram. Se a rede local não perde pacotes, o problema está no provedor: abra um chamado com ele."));
        }
        if (r.Download.RetransPct >= 2)
        {
            f.Add(new("warning", $"Retransmissões TCP altas no download ({Pct(r.Download.RetransPct)})",
                "O servidor de teste precisou reenviar dados: sinal de perda ou congestionamento no caminho."));
        }
        if (jitter is > 30)
        {
            f.Add(new("warning", $"Latência instável (jitter de {Ms(jitter)})", "Variações acima de 30 ms prejudicam chamadas de voz e vídeo."));
        }
        if (latency is > 100)
        {
            f.Add(new("warning", $"Latência alta até a internet ({Ms(latency)})", "Acima de 100 ms a navegação e as chamadas ficam lentas."));
        }
        if (bloat is { Grade: "C" or "D" or "F" })
        {
            f.Add(new(bloat.Grade == "C" ? "warning" : "critical", $"Bufferbloat: a latência sobe {Ms(bloat.AddedMs)} com a banda ocupada (nota {bloat.Grade})",
                "Quando alguém baixa ou envia arquivos, chamadas e acesso remoto travam. Ative SQM ou QoS (fq_codel/CAKE) no roteador."));
        }
        if (serverLatency is > 150)
        {
            f.Add(new(serverLatency > 300 ? "critical" : "warning", $"Latência alta até o servidor Cybereyes ({Ms(serverLatency)})",
                "O acesso remoto e os comandos desta máquina vão responder devagar. Compare com a latência até a internet para saber se o atraso está na rota até o servidor."));
        }
        var serverTarget = r.Latency.Targets.FirstOrDefault(t => t.Kind == "server");
        if (serverTarget is { Received: 0, Error.Length: > 0 })
        {
            f.Add(new("warning", "O servidor Cybereyes não respondeu ao teste", serverTarget.Error));
        }
        if (up is > 0 and < 2)
        {
            f.Add(new("warning", $"Upload baixo ({Mbps(up)})", "Envio de anexos, backup em nuvem, videochamadas e o acesso remoto a esta máquina ficam lentos."));
        }

        var slowDns = r.Dns.Where(d => d.Error.Length == 0 && d.Ms > 150).ToList();
        if (slowDns.Count > 0)
        {
            f.Add(new("info", "Resolução de nomes lenta",
                $"{string.Join(", ", slowDns.Select(d => $"{d.Host} em {Ms(d.Ms)}"))}. Considere usar outro servidor DNS no roteador."));
        }
        var failedDns = r.Dns.Where(d => d.Error.Length > 0).ToList();
        if (failedDns.Count > 0)
        {
            f.Add(new("warning", "Falha ao resolver nomes", string.Join(", ", failedDns.Select(d => d.Host))));
        }

        if (planDown is < 80 && planDownload is { } pd)
        {
            f.Add(new(planDown < 50 ? "critical" : "warning", $"Download entregue abaixo do contratado ({Pct(planDown)} de {Mbps(pd)})",
                net.Type == "wifi" ? "Antes de reclamar com o provedor, repita o teste com cabo: o Wi-Fi pode ser o limite." : "Repita em outro horário e, se continuar, abra um chamado com o provedor."));
        }
        if (planUp is < 80 && planUpload is { } pu)
        {
            f.Add(new(planUp < 50 ? "critical" : "warning", $"Upload entregue abaixo do contratado ({Pct(planUp)} de {Mbps(pu)})",
                "Repita em outro horário e, se continuar, abra um chamado com o provedor."));
        }

        if (r.Connection.Proxy)
        {
            f.Add(new("info", "Teste feito pelo proxy", "O tráfego passou pelo proxy configurado: o resultado inclui o desempenho dele."));
        }
        if (r.Download.Error.Length > 0 && r.Download.Mbps == 0)
        {
            f.Add(new("critical", "O download não pôde ser medido", r.Download.Error));
        }
        if (r.Upload.Error.Length > 0 && r.Upload.Mbps == 0)
        {
            f.Add(new("critical", "O upload não pôde ser medido", r.Upload.Error));
        }
        f.AddRange(r.Warnings.Select(w => new SpeedTestFinding("info", "Medição incompleta", w)));

        if (!f.Any(x => x.Severity is "critical" or "warning"))
        {
            f.Insert(0, new("ok", "Nenhum problema encontrado", "Velocidade, latência e estabilidade dentro do esperado para o uso da máquina."));
        }
        return f.OrderBy(x => Array.IndexOf(Order, x.Severity)).ToList();
    }

    public static string Mbps(double? v) => v is null ? "-" : $"{v.Value.ToString(v.Value >= 100 ? "0" : "0.#", PtBr)} Mbit/s";

    public static string Ms(double? v) => v is null ? "-" : $"{v.Value.ToString(v.Value >= 100 ? "0" : "0.#", PtBr)} ms";

    public static string Pct(double? v) => v is null ? "-" : $"{v.Value.ToString("0.##", PtBr)}%";

    private static string Duration(double? seconds) => seconds switch
    {
        null => "-",
        < 60 => $"{Math.Ceiling(seconds.Value)} s",
        < 3600 => $"{Math.Ceiling(seconds.Value / 60)} min",
        _ => $"{(seconds.Value / 3600).ToString("0.#", PtBr)} h",
    };
}
