using System.Globalization;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Shapes.Charts;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using Cybereyes.Api.Reports;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Rmm.SpeedTest;

/// <summary>Relatorio completo de um teste de velocidade em PDF (A4 retrato).</summary>
public static class SpeedTestPdf
{
    private const double WidthCm = 18;
    private static readonly CultureInfo PtBr = ReportCulture.PtBr;
    private static readonly Color Accent = Color.FromRgb(31, 94, 167);
    private static readonly Color HeaderShade = Color.FromRgb(230, 238, 247);
    private static readonly Color Stripe = Color.FromRgb(248, 249, 251);

    public static byte[] Render(SpeedTestDetailDto detail, TimeZoneInfo zone)
    {
        var report = detail.Report ?? throw new ArgumentException("Teste sem relatorio", nameof(detail));
        var analysis = detail.Analysis ?? SpeedTestAnalyzer.Analyze(report, detail.Test.PlanDownloadMbps, detail.Test.PlanUploadMbps);
        EmbeddedFontResolver.Install();
        var doc = new Document();
        doc.Info.Title = $"Teste de velocidade - {detail.Agent.Hostname}";
        doc.Styles[StyleNames.Normal]!.Font.Name = "DejaVu Sans";
        doc.Styles[StyleNames.Normal]!.Font.Size = 8.5;

        var section = doc.AddSection();
        section.PageSetup = doc.DefaultPageSetup.Clone();
        section.PageSetup.PageWidth = Unit.FromCentimeter(21);
        section.PageSetup.PageHeight = Unit.FromCentimeter(29.7);
        section.PageSetup.LeftMargin = Unit.FromCentimeter(1.5);
        section.PageSetup.RightMargin = Unit.FromCentimeter(1.5);
        section.PageSetup.TopMargin = Unit.FromCentimeter(1.4);
        section.PageSetup.BottomMargin = Unit.FromCentimeter(1.6);

        var when = TimeZoneInfo.ConvertTime(detail.Test.CreatedAt, zone);
        var footer = section.Footers.Primary.AddParagraph();
        footer.Format.Alignment = ParagraphAlignment.Right;
        footer.Format.Font.Size = 7;
        footer.Format.Font.Color = Colors.DimGray;
        footer.AddText($"Cybereyes - teste de velocidade de {detail.Agent.Hostname} em {when.ToString("dd/MM/yyyy HH:mm", PtBr)} - página ");
        footer.AddPageField();
        footer.AddText(" de ");
        footer.AddNumPagesField();

        var title = section.AddParagraph("Relatório de teste de velocidade");
        title.Format.Font.Size = 17;
        title.Format.Font.Bold = true;
        title.Format.Font.Color = Accent;
        var subtitle = section.AddParagraph($"{detail.Agent.Hostname}  |  {detail.Agent.ClientName} / {detail.Agent.SiteName}");
        subtitle.Format.Font.Size = 11;
        subtitle.Format.SpaceAfter = Unit.FromPoint(2);
        var duration = report.StartedAt is { } s && report.FinishedAt is { } f ? $"{Math.Round((f - s).TotalSeconds)} s" : "-";
        Muted(section, $"Realizado em {when.ToString("dd/MM/yyyy HH:mm", PtBr)} ({zone.Id}) por {detail.Test.RequestedBy}  |  " +
            $"Teste {(detail.Test.Mode == SpeedTestMode.Quick ? "rápido" : "completo")}  |  Duração {duration}  |  " +
            $"Dados usados {Bytes(report.BytesUsed)}  |  EYES {detail.Agent.Version}");

        QualityBanner(section, analysis);
        Tiles(section, report, analysis);
        if (analysis.PlanDownloadPct is not null || analysis.PlanUploadPct is not null)
        {
            Muted(section, "Plano contratado: " + string.Join("  |  ", new[]
            {
                detail.Test.PlanDownloadMbps is { } pd ? $"download {SpeedTestAnalyzer.Mbps(pd)} ({SpeedTestAnalyzer.Pct(analysis.PlanDownloadPct)} entregue)" : null,
                detail.Test.PlanUploadMbps is { } pu ? $"upload {SpeedTestAnalyzer.Mbps(pu)} ({SpeedTestAnalyzer.Pct(analysis.PlanUploadPct)} entregue)" : null,
            }.Where(x => x is not null)));
        }

        Heading(section, "Diagnóstico");
        Findings(section, analysis.Findings);

        Heading(section, "Adequação por uso");
        Table(section, ["Uso", "Avaliação", "Detalhe"], [5.2, 2.2, 10.6],
            analysis.Usage.Select(u => new[] { u.Label, Rating(u.Rating), u.Detail }), rightFrom: 99);

        Heading(section, "Conexão com a internet");
        var c = report.Connection;
        KeyValues(section,
        [
            ("IP público", c.PublicIp),
            ("Provedor (ASN)", c.Asn > 0 ? $"AS{c.Asn}" : string.Empty),
            ("Localização", string.Join(", ", new[] { c.City, c.Region, c.Country }.Where(x => x.Length > 0))),
            ("Servidor de teste", $"{report.Server.Provider} {report.Server.Colo} ({report.Server.Host})".Trim()),
            ("Primeira conexão", $"DNS {SpeedTestAnalyzer.Ms(report.Server.DnsMs)}, TCP {SpeedTestAnalyzer.Ms(report.Server.ConnectMs)}, TLS {SpeedTestAnalyzer.Ms(report.Server.TlsMs)}"),
            ("RTT do TCP (servidor)", report.Server.TcpRttMs > 0 ? SpeedTestAnalyzer.Ms(report.Server.TcpRttMs) : string.Empty),
            ("Proxy", c.Proxy ? "Sim, o tráfego passou pelo proxy do agente" : "Não"),
        ]);

        Heading(section, "Rede local");
        var n = report.Network;
        var rows = new List<(string, string)>
        {
            ("Interface", string.Join(" - ", new[] { n.Interface, n.Description }.Where(x => x.Length > 0))),
            ("Tipo", n.Type switch { "wifi" => "Wi-Fi", "ethernet" => "Cabo (Ethernet)", "other" => "Outra (VPN, virtual ou móvel)", _ => "-" }),
            ("IP local / MAC", $"{n.LocalIp} / {n.Mac}"),
            ("Velocidade do link", n.LinkMbps > 0 ? SpeedTestAnalyzer.Mbps(n.LinkMbps) : string.Empty),
            ("MTU", n.Mtu > 0 ? n.Mtu.ToString(PtBr) : string.Empty),
            ("Gateway", n.Gateway),
            ("Servidores DNS", string.Join(", ", n.DnsServers)),
        };
        if (n.Wifi is { } w)
        {
            rows.Add(("Rede Wi-Fi", string.Join(" - ", new[] { w.Ssid, w.Bssid }.Where(x => x.Length > 0))));
            rows.Add(("Sinal", string.Join(", ", new[]
            {
                w.SignalPct > 0 ? $"{w.SignalPct}%" : null, w.RssiDbm < 0 ? $"{w.RssiDbm} dBm" : null, w.NoiseDbm < 0 ? $"ruído {w.NoiseDbm} dBm" : null,
            }.Where(x => x is not null))));
            rows.Add(("Canal / banda / padrão", string.Join(" / ", new[] { w.Channel > 0 ? w.Channel.ToString(PtBr) : null, w.Band, w.Radio }
                .Where(x => !string.IsNullOrEmpty(x)))));
            rows.Add(("Taxa do Wi-Fi", $"recepção {SpeedTestAnalyzer.Mbps(w.RxMbps)}, transmissão {SpeedTestAnalyzer.Mbps(w.TxMbps)}"));
        }
        KeyValues(section, rows);

        Heading(section, "Latência e perda de pacotes");
        var idle = report.Latency.Idle;
        var latencyRows = new List<string[]>
        {
            new[] { "Servidor de teste (ociosa)", report.Server.Host, "HTTP", $"{idle.Samples}", "-", Ms(idle.MinMs), Ms(idle.MedianMs), Ms(idle.MaxMs), Ms(idle.JitterMs) },
        };
        latencyRows.AddRange(report.Latency.Targets.Select(t => t.Error.Length > 0 && t.Received == 0
            ? new[] { t.Name, t.Host, t.Method.ToUpperInvariant(), $"{t.Received}/{t.Sent}", "-", "-", "-", "-", "Falhou: " + t.Error }
            : new[] { t.Name, t.Host, t.Method.ToUpperInvariant(), $"{t.Received}/{t.Sent}", SpeedTestAnalyzer.Pct(t.LossPct), Ms(t.Stats.MinMs),
                Ms(t.Stats.MedianMs), Ms(t.Stats.MaxMs), Ms(t.Stats.JitterMs) }));
        Table(section, ["Destino", "Endereço", "Método", "Resp.", "Perda", "Mín.", "Mediana", "Máx.", "Jitter"],
            [3.2, 3.9, 1.3, 1.3, 1.3, 1.6, 1.8, 1.6, 2.0], latencyRows, rightFrom: 3, fontSize: 7.5);

        if (report.Dns.Count > 0)
        {
            Heading(section, "Resolução de nomes (DNS do sistema)");
            Table(section, ["Nome", "Tempo", "Resultado"], [6, 2.2, 9.8],
                report.Dns.Select(d => new[] { d.Host, d.Error.Length > 0 ? "-" : Ms(d.Ms), d.Error.Length > 0 ? "Falhou: " + d.Error : string.Join(", ", d.Addresses) }),
                rightFrom: 1, rightTo: 1);
        }

        Direction(section, "Download", report.Download, analysis.DownloadBloat, idle);
        Direction(section, "Upload", report.Upload, analysis.UploadBloat, idle);

        var note = section.AddParagraph("Medido pelo agente EYES na própria máquina contra a infraestrutura de teste da Cloudflare (speed.cloudflare.com), " +
            "com uma conexão em tamanhos crescentes e, no teste completo, várias conexões simultâneas. A latência dos usos é a ociosa; a sob carga " +
            "entra na nota de bufferbloat (escala A+ a F). Wi-Fi, outros dispositivos usando a rede e o horário influenciam o resultado.");
        note.Format.Font.Size = 7;
        note.Format.Font.Color = Colors.DimGray;
        note.Format.SpaceBefore = Unit.FromPoint(10);

        var renderer = new PdfDocumentRenderer { Document = doc };
        renderer.RenderDocument();
        using var output = new MemoryStream();
        renderer.PdfDocument.Save(output, false);
        return output.ToArray();
    }

    private static void QualityBanner(Section section, SpeedTestAnalysis a)
    {
        var (label, color) = a.Quality switch
        {
            "excellent" => ("Excelente", Color.FromRgb(46, 125, 50)),
            "good" => ("Boa", Color.FromRgb(56, 142, 60)),
            "fair" => ("Regular", Color.FromRgb(230, 126, 0)),
            _ => ("Ruim", Color.FromRgb(198, 40, 40)),
        };
        var table = section.AddTable();
        table.AddColumn(Unit.FromCentimeter(WidthCm));
        var row = table.AddRow();
        row.Shading.Color = color;
        row.TopPadding = 5;
        row.BottomPadding = 5;
        var p = row.Cells[0].AddParagraph();
        p.Format.Alignment = ParagraphAlignment.Center;
        p.AddFormattedText($"Qualidade geral da conexão: {label}", new Font { Size = 12, Bold = true, Color = Colors.White });
        table.Format.SpaceAfter = Unit.FromPoint(4);
        section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(2);
    }

    private static void Tiles(Section section, SpeedTestReport r, SpeedTestAnalysis a)
    {
        var tiles = new (string Label, string Value, string Note)[]
        {
            ("Download", SpeedTestAnalyzer.Mbps(r.Download.Mbps), r.Download.MultiMbps > 0 ? $"1 conexão {Mb(r.Download.SingleMbps)} | {r.Download.Streams} conexões {Mb(r.Download.MultiMbps)}" : "uma conexão"),
            ("Upload", SpeedTestAnalyzer.Mbps(r.Upload.Mbps), r.Upload.MultiMbps > 0 ? $"1 conexão {Mb(r.Upload.SingleMbps)} | {r.Upload.Streams} conexões {Mb(r.Upload.MultiMbps)}" : "uma conexão"),
            ("Latência", SpeedTestAnalyzer.Ms(a.LatencyMs), "mediana, conexão ociosa"),
            ("Jitter", SpeedTestAnalyzer.Ms(a.JitterMs), "variação entre amostras"),
            ("Perda de pacotes", a.LossPct is null ? "não medida" : SpeedTestAnalyzer.Pct(a.LossPct), "ICMP até 1.1.1.1 e 8.8.8.8"),
            ("Bufferbloat", a.BloatGrade ?? "não medido", a.BloatGrade is null ? "só no teste completo" : $"latência sob carga +{Ms(Math.Max(a.DownloadBloat?.AddedMs ?? 0, a.UploadBloat?.AddedMs ?? 0))}"),
        };
        var table = section.AddTable();
        table.Borders.Width = 0.5;
        table.Borders.Color = Colors.LightGray;
        for (var i = 0; i < 3; i++)
        {
            table.AddColumn(Unit.FromCentimeter(WidthCm / 3));
        }
        foreach (var chunk in tiles.Chunk(3))
        {
            var row = table.AddRow();
            row.TopPadding = 4;
            row.BottomPadding = 4;
            for (var i = 0; i < chunk.Length; i++)
            {
                var p = row.Cells[i].AddParagraph();
                p.AddFormattedText(chunk[i].Label + "\n", new Font { Size = 7.5, Color = Colors.DimGray });
                p.AddFormattedText(chunk[i].Value + "\n", new Font { Size = 14, Bold = true });
                p.AddFormattedText(chunk[i].Note, new Font { Size = 6.5, Color = Colors.DimGray });
            }
        }
        section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(4);
    }

    private static void Findings(Section section, List<SpeedTestFinding> findings)
    {
        var table = section.AddTable();
        table.AddColumn(Unit.FromCentimeter(0.5));
        table.AddColumn(Unit.FromCentimeter(WidthCm - 0.5));
        foreach (var f in findings)
        {
            var row = table.AddRow();
            row.TopPadding = 2;
            row.BottomPadding = 3;
            row.Borders.Bottom.Width = 0.5;
            row.Borders.Bottom.Color = Colors.White;
            row.Cells[0].Shading.Color = f.Severity switch
            {
                "critical" => Color.FromRgb(198, 40, 40),
                "warning" => Color.FromRgb(230, 126, 0),
                "info" => Color.FromRgb(31, 94, 167),
                _ => Color.FromRgb(46, 125, 50),
            };
            var p = row.Cells[1].AddParagraph();
            p.Format.LeftIndent = Unit.FromPoint(4);
            p.AddFormattedText(f.Title, TextFormat.Bold);
            p.AddText("\n" + f.Detail);
        }
    }

    private static void Direction(Section section, string name, SpeedTestDirection d, SpeedTestBloat? bloat, SpeedTestStats idle)
    {
        Heading(section, name);
        if (d.Mbps <= 0)
        {
            Muted(section, d.Error.Length > 0 ? $"Não medido: {d.Error}" : "Não medido.");
            return;
        }
        var rows = new List<(string, string)>
        {
            ("Resultado", SpeedTestAnalyzer.Mbps(d.Mbps)),
            ("Uma conexão", $"{SpeedTestAnalyzer.Mbps(d.SingleMbps)} (transferências de tamanho crescente)"),
        };
        if (d.MultiMbps > 0)
        {
            rows.Add(($"{d.Streams} conexões simultâneas", SpeedTestAnalyzer.Mbps(d.MultiMbps)));
        }
        if (d.Loaded.Samples > 0)
        {
            rows.Add(("Latência sob carga", $"mediana {Ms(d.Loaded.MedianMs)}, máxima {Ms(d.Loaded.MaxMs)} (ociosa {Ms(idle.MedianMs)})" +
                (bloat is null ? string.Empty : $", nota {bloat.Grade}")));
        }
        if (d.RetransPct > 0)
        {
            rows.Add(("Retransmissões TCP", SpeedTestAnalyzer.Pct(d.RetransPct)));
        }
        rows.Add(("Dados transferidos", $"{Bytes(d.Bytes)} em {Math.Round(d.DurationMs / 1000)} s"));
        KeyValues(section, rows);
        if (d.Stages.Count > 0)
        {
            section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(3);
            Table(section, ["Tamanho da transferência", "Repetições", "Velocidade mediana", "Velocidade máxima", "Tempo mediano"], [4.6, 2.6, 3.8, 3.6, 3.4],
                d.Stages.Select(s => new[] { Bytes(s.Bytes), s.Count.ToString(PtBr), SpeedTestAnalyzer.Mbps(s.MedianMbps), SpeedTestAnalyzer.Mbps(s.MaxMbps), Ms(s.MedianMs) }),
                rightFrom: 1);
        }
        if (d.Timeline.Count >= 2)
        {
            Chart(section, name, d.Timeline, d.TimelineStepMs);
        }
    }

    /// <summary>Vazao ao longo da fase com varias conexoes.</summary>
    private static void Chart(Section section, string name, List<double> timeline, int stepMs)
    {
        var chart = section.AddChart(ChartType.Line);
        chart.Width = Unit.FromCentimeter(WidthCm);
        chart.Height = Unit.FromCentimeter(4.2);
        chart.Format.Font.Size = 6.5;
        var series = chart.SeriesCollection.AddSeries();
        series.Name = $"{name} (Mbit/s)";
        series.Add(timeline.ToArray());
        series.LineFormat.Color = Accent;
        series.LineFormat.Width = 1.2;
        series.MarkerStyle = MarkerStyle.None;
        var x = chart.XValues.AddXSeries();
        var step = stepMs > 0 ? stepMs / 1000.0 : 0.5;
        x.Add(timeline.Select((_, i) => (i + 1) % 2 == 0 ? ((i + 1) * step).ToString("0.#", PtBr) + " s" : string.Empty).ToArray());
        chart.XAxis.MajorTickMark = TickMarkType.None;
        chart.YAxis.MajorTickMark = TickMarkType.Outside;
        chart.YAxis.HasMajorGridlines = true;
        chart.YAxis.MajorGridlines.LineFormat.Color = Colors.LightGray;
        chart.PlotArea.LineFormat.Color = Colors.LightGray;
        chart.TopArea.AddParagraph($"{name} ao longo do tempo, várias conexões (Mbit/s)").Format.Font.Size = 7;
        section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(2);
    }

    private static void Heading(Section section, string text)
    {
        var p = section.AddParagraph(text);
        p.Format.Font.Size = 11;
        p.Format.Font.Bold = true;
        p.Format.Font.Color = Accent;
        p.Format.SpaceBefore = Unit.FromPoint(10);
        p.Format.SpaceAfter = Unit.FromPoint(4);
        p.Format.KeepWithNext = true;
    }

    private static void Muted(Section section, string text)
    {
        var p = section.AddParagraph(text);
        p.Format.Font.Size = 7.5;
        p.Format.Font.Color = Colors.DimGray;
        p.Format.SpaceAfter = Unit.FromPoint(6);
    }

    private static void KeyValues(Section section, IEnumerable<(string Key, string Value)> rows)
    {
        var table = section.AddTable();
        table.Borders.Width = 0.25;
        table.Borders.Color = Colors.LightGray;
        table.AddColumn(Unit.FromCentimeter(4.6));
        table.AddColumn(Unit.FromCentimeter(WidthCm - 4.6));
        foreach (var (key, value) in rows)
        {
            var row = table.AddRow();
            row.Cells[0].Shading.Color = Stripe;
            row.Cells[0].AddParagraph(key).Format.Font.Bold = true;
            row.Cells[1].AddParagraph(string.IsNullOrWhiteSpace(value) ? "-" : value);
        }
    }

    private static void Table(Section section, string[] headers, double[] widths, IEnumerable<string[]> rows, int rightFrom, int rightTo = int.MaxValue,
        double fontSize = 0)
    {
        var table = section.AddTable();
        if (fontSize > 0)
        {
            table.Format.Font.Size = fontSize;
        }
        table.Borders.Width = 0.25;
        table.Borders.Color = Colors.LightGray;
        foreach (var w in widths)
        {
            table.AddColumn(Unit.FromCentimeter(w));
        }
        var header = table.AddRow();
        header.HeadingFormat = true;
        header.Shading.Color = HeaderShade;
        header.Format.Font.Bold = true;
        for (var i = 0; i < headers.Length; i++)
        {
            header.Cells[i].AddParagraph(headers[i]);
        }
        var index = 0;
        foreach (var source in rows)
        {
            var row = table.AddRow();
            if (index++ % 2 == 1)
            {
                row.Shading.Color = Stripe;
            }
            for (var i = 0; i < headers.Length && i < source.Length; i++)
            {
                var p = row.Cells[i].AddParagraph(source[i]);
                if (i >= rightFrom && i <= rightTo)
                {
                    p.Format.Alignment = ParagraphAlignment.Right;
                }
            }
        }
    }

    private static string Rating(string rating) => rating switch { "great" => "Ótimo", "good" => "Bom", _ => "Ruim" };

    private static string Ms(double ms) => SpeedTestAnalyzer.Ms(ms);

    private static string Mb(double mbps) => mbps.ToString(mbps >= 100 ? "0" : "0.#", PtBr);

    private static string Bytes(long bytes) => bytes switch
    {
        >= 1_000_000_000 => $"{(bytes / 1e9).ToString("0.##", PtBr)} GB",
        >= 1_000_000 => $"{(bytes / 1e6).ToString("0.#", PtBr)} MB",
        >= 1_000 => $"{(bytes / 1e3).ToString("0", PtBr)} kB",
        _ => $"{bytes} B",
    };
}
