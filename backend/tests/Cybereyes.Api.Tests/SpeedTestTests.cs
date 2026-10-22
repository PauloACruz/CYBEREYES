using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.SpeedTest;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private async Task<(HttpClient Admin, int Pk, string AgentId, string Token, FakeAgent Agent)> SpeedTestAgentAsync(string client, string version)
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = AgentClient(installer);
        var response = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = "estacao-velocidade", site = siteId, monitoring_type = "workstation", plat = "windows" });
        var body = await response.Content.ReadFromJsonAsync<NewAgentBody>();
        await SetAgentVersionAsync(body!.Pk, version);
        var nats = await ConnectAsAgentAsync(agentId, body.Token);
        return (admin, body.Pk, agentId, body.Token, new FakeAgent(nats, agentId, r => r.GetString("func") == SpeedTestEndpoints.Func ? "ok" : null));
    }

    private async Task SetAgentVersionAsync(int pk, string version)
    {
        using var scope = fixture.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        await db.Agents.Where(a => a.Id == pk).ExecuteUpdateAsync(set => set.SetProperty(a => a.Version, version));
    }

    /// <summary>Relatorio como o EYES envia (snake_case): Wi-Fi fraco, perda na rede local, bufferbloat e servidor distante.</summary>
    private static object AgentReport() => new
    {
        mode = "full", started_at = "2026-10-22T14:00:00Z", finished_at = "2026-10-22T14:00:42Z",
        server = new { provider = "Cloudflare", host = "speed.cloudflare.com", colo = "GRU", dns_ms = 1.2, connect_ms = 20.5, tls_ms = 41.0, tcp_rtt_ms = 24.0 },
        connection = new { public_ip = "189.54.138.55", asn = 28573, city = "São Caetano do Sul", country = "BR", timezone = "America/Sao_Paulo", campo_novo = "ignorado" },
        network = new
        {
            @interface = "Wi-Fi", description = "Intel(R) Wi-Fi 6 AX201", type = "wifi", local_ip = "192.168.1.20", mac = "A0:B1:C2:D3:E4:F5", mtu = 1500, link_mbps = 144.4,
            gateway = "192.168.1.1", dns_servers = new[] { "192.168.1.1" },
            wifi = new { ssid = "Escritorio", bssid = "11:22:33:44:55:66", signal_pct = 35, rssi_dbm = -78, channel = 6, band = "2,4 GHz", radio = "802.11n", rx_mbps = 144.4, tx_mbps = 130 },
        },
        latency = new
        {
            idle = new { samples = 20, min_ms = 18.1, median_ms = 24.0, avg_ms = 25.2, p90_ms = 31.0, max_ms = 40.2, jitter_ms = 4.1 },
            targets = new object[]
            {
                new { kind = "gateway", name = "Gateway da rede local", host = "192.168.1.1", method = "icmp", sent = 10, received = 9, loss_pct = 10.0,
                    stats = new { samples = 9, min_ms = 2.0, median_ms = 35.0, avg_ms = 30.0, p90_ms = 60.0, max_ms = 80.0, jitter_ms = 20.0 } },
                new { kind = "internet", name = "Cloudflare DNS", host = "1.1.1.1", method = "icmp", sent = 10, received = 10, loss_pct = 0.0,
                    stats = new { samples = 10, min_ms = 20.0, median_ms = 25.0, avg_ms = 25.0, p90_ms = 28.0, max_ms = 30.0, jitter_ms = 3.0 } },
                new { kind = "internet", name = "Google DNS", host = "8.8.8.8", method = "icmp", sent = 10, received = 10, loss_pct = 0.0,
                    stats = new { samples = 10, min_ms = 21.0, median_ms = 26.0, avg_ms = 26.0, p90_ms = 29.0, max_ms = 31.0, jitter_ms = 3.0 } },
                new { kind = "server", name = "Servidor Cybereyes", host = "cyber.exemplo.com.br", method = "http", sent = 10, received = 10, loss_pct = 0.0,
                    stats = new { samples = 10, min_ms = 160.0, median_ms = 170.0, avg_ms = 172.0, p90_ms = 190.0, max_ms = 200.0, jitter_ms = 12.0 } },
            },
        },
        dns = new object[] { new { host = "www.google.com", ms = 57.2, addresses = new[] { "142.251.154.119" } } },
        download = new
        {
            mbps = 95.4, single_mbps = 80.1, multi_mbps = 95.4, streams = 6,
            stages = new object[] { new { bytes = 1_000_000, count = 6, median_mbps = 70.2, max_mbps = 80.1, median_ms = 114.0 } },
            timeline = new[] { 40.0, 90.0, 95.0, 96.0 }, timeline_step_ms = 500,
            loaded = new { samples = 18, min_ms = 120.0, median_ms = 300.0, avg_ms = 310.0, p90_ms = 400.0, max_ms = 450.0, jitter_ms = 30.0 },
            retrans_pct = 0.4, bytes = 120_000_000, duration_ms = 21000.0,
        },
        upload = new
        {
            mbps = 1.4, single_mbps = 1.4, stages = Array.Empty<object>(),
            loaded = new { samples = 0, min_ms = 0.0, median_ms = 0.0, avg_ms = 0.0, p90_ms = 0.0, max_ms = 0.0, jitter_ms = 0.0 },
            bytes = 2_000_000, duration_ms = 15000.0,
        },
        bytes_used = 122_000_000,
        warnings = new[] { "Nao foi possivel ler os detalhes do Wi-Fi (netsh wlan)" },
    };

    [Fact]
    public async Task SpeedTest_RunsOnAgent_TracksProgress_AndBuildsTheReport()
    {
        var (admin, pk, agentId, token, agent) = await SpeedTestAgentAsync("Cliente velocidade", "3.3.0");
        await using var _ = agent;

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "full" })).StatusCode);
        await SetAgentVersionAsync(pk, "3.4.0");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "turbo" })).StatusCode);

        var started = await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "full", planDownloadMbps = 300, planUploadMbps = 20 });
        Assert.Equal(HttpStatusCode.Created, started.StatusCode);
        var test = await started.Content.ReadFromJsonAsync<JsonElement>();
        var testId = test.GetProperty("id").GetInt64();
        Assert.Equal("pending", test.GetProperty("status").GetString());
        var sent = await WaitForFuncAsync(agent, SpeedTestEndpoints.Func);
        Assert.Equal(testId, Convert.ToInt64(sent["speedtest_pk"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("full", sent.GetString("mode"));
        // Um teste por vez: o segundo dividiria a banda com o primeiro.
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "quick" })).StatusCode);

        using var http = AgentClient(token);
        var path = $"/api/v4/{agentId}/{testId}/speedtest/";
        Assert.Equal(HttpStatusCode.OK, (await http.PatchAsJsonAsync(path, new { status = "running", phase = "download", progress = 40, live_mbps = 85.34 })).StatusCode);
        await http.PatchAsJsonAsync(path, new { status = "running", phase = "download", progress = 30, live_mbps = 90 });
        var running = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests/{testId}");
        Assert.Equal("running", running.GetProperty("test").GetProperty("status").GetString());
        Assert.Equal("download", running.GetProperty("test").GetProperty("phase").GetString());
        Assert.Equal(40, running.GetProperty("test").GetProperty("progress").GetInt32());
        Assert.Equal(JsonValueKind.Null, running.GetProperty("report").ValueKind);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.GetAsync($"/api/agents/{pk}/speedtests/{testId}/pdf")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await http.PatchAsJsonAsync(path, new { status = "completed", progress = 100, report = AgentReport() })).StatusCode);
        var done = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests/{testId}");
        var summary = done.GetProperty("test");
        Assert.Equal("completed", summary.GetProperty("status").GetString());
        Assert.Equal(100, summary.GetProperty("progress").GetInt32());
        Assert.Equal(95.4, summary.GetProperty("downloadMbps").GetDouble());
        Assert.Equal(1.4, summary.GetProperty("uploadMbps").GetDouble());
        Assert.Equal(24.0, summary.GetProperty("latencyMs").GetDouble());
        Assert.Equal(0.0, summary.GetProperty("lossPct").GetDouble());
        Assert.Equal("estacao-velocidade", done.GetProperty("agent").GetProperty("hostname").GetString());

        var report = done.GetProperty("report");
        Assert.Equal("São Caetano do Sul", report.GetProperty("connection").GetProperty("city").GetString());
        Assert.False(report.GetProperty("connection").TryGetProperty("campoNovo", out var _));
        Assert.Equal(35, report.GetProperty("network").GetProperty("wifi").GetProperty("signalPct").GetInt32());
        Assert.Equal(4, report.GetProperty("latency").GetProperty("targets").GetArrayLength());

        var analysis = done.GetProperty("analysis");
        Assert.Equal("D", analysis.GetProperty("bloatGrade").GetString());
        Assert.Equal(276.0, analysis.GetProperty("downloadBloat").GetProperty("addedMs").GetDouble());
        Assert.Equal(31.8, analysis.GetProperty("planDownloadPct").GetDouble());
        Assert.Equal(170.0, analysis.GetProperty("serverLatencyMs").GetDouble());
        Assert.Equal("fair", analysis.GetProperty("quality").GetString());
        var findings = analysis.GetProperty("findings").EnumerateArray().Select(f => (Severity: f.GetProperty("severity").GetString(), Title: f.GetProperty("title").GetString()!)).ToList();
        Assert.Contains(findings, f => f.Severity == "warning" && f.Title.StartsWith("Sinal de Wi-Fi fraco", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Severity == "critical" && f.Title.StartsWith("Perda de pacotes na rede local", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Severity == "critical" && f.Title.StartsWith("Bufferbloat", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Severity == "warning" && f.Title.StartsWith("Latência alta até o servidor Cybereyes", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Severity == "warning" && f.Title.StartsWith("Upload baixo", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Severity == "critical" && f.Title.StartsWith("Download entregue abaixo do contratado", StringComparison.Ordinal));
        Assert.Contains(findings, f => f.Title == "Wi-Fi em 2,4 GHz");
        Assert.Contains(findings, f => f.Title == "Medição incompleta");
        Assert.Equal("critical", findings[0].Severity);
        var usage = analysis.GetProperty("usage").EnumerateArray().ToDictionary(u => u.GetProperty("key").GetString()!, u => u.GetProperty("rating").GetString());
        Assert.Equal("great", usage["streaming"]);
        Assert.Equal("poor", usage["video_calls"]);
        Assert.Equal("poor", usage["remote_access"]);

        // Depois do resultado, andamento atrasado do agente nao reabre o teste.
        await http.PatchAsJsonAsync(path, new { status = "running", phase = "upload", progress = 70 });
        Assert.Equal("completed", (await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests/{testId}")).GetProperty("test").GetProperty("status").GetString());

        var list = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests");
        Assert.Equal(testId, Assert.Single(list.EnumerateArray()).GetProperty("id").GetInt64());

        var pdf = await admin.GetAsync($"/api/agents/{pk}/speedtests/{testId}/pdf");
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("teste-velocidade-estacao-velocidade-", pdf.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);
        var bytes = await pdf.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));

        var procedure = await InDbAsync(db => db.AgentProcedures.IgnoreQueryFilters().SingleAsync(p => p.AgentId == pk && p.Kind == ProcedureKind.SpeedTest));
        Assert.Equal(ProcedureStatus.Ok, procedure.Status);
        Assert.Contains("Download 95,4 Mbit/s", procedure.Detail, StringComparison.Ordinal);
        Assert.Contains("estacao-velocidade: teste de velocidade completo", await admin.GetStringAsync("/api/audit?pageSize=200"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task SpeedTest_FailsRightAway_WhenTheAgentIsOffline_AndExpiresWithoutNews()
    {
        var (admin, pk, agentId, token, agent) = await SpeedTestAgentAsync("Cliente velocidade offline", "3.4.0");
        var online = await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "quick" });
        Assert.Equal(HttpStatusCode.Created, online.StatusCode);
        var stuckId = (await online.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        using (var http = AgentClient(token))
        {
            await http.PatchAsJsonAsync($"/api/v4/{agentId}/{stuckId}/speedtest/", new { status = "running", phase = "latency", progress = 12 });
        }
        await agent.DisposeAsync();

        // Sem noticia do agente por mais de 2 minutos, o teste e dado como perdido e libera um novo.
        await InDbAsync(db => db.AgentSpeedTests.Where(t => t.Id == stuckId)
            .ExecuteUpdateAsync(set => set.SetProperty(t => t.UpdatedAt, DateTimeOffset.UtcNow.AddMinutes(-3))));
        var expired = Assert.Single((await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests")).EnumerateArray());
        Assert.Equal("failed", expired.GetProperty("status").GetString());
        Assert.Contains("parou de informar", expired.GetProperty("error").GetString(), StringComparison.Ordinal);

        // Maquina offline (ninguem assina o assunto do agente): o console sabe na hora.
        var offline = await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = "quick" });
        Assert.Equal(HttpStatusCode.Conflict, offline.StatusCode);
        Assert.Contains("offline", (await offline.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString(), StringComparison.Ordinal);
        var tests = (await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests")).EnumerateArray().ToList();
        Assert.Equal(2, tests.Count);
        Assert.All(tests, t => Assert.Equal("failed", t.GetProperty("status").GetString()));
    }

    [Fact]
    public void SpeedTestAnalyzer_HealthyWiredConnection_HasNoProblems()
    {
        var stats = new SpeedTestStats { Samples = 20, MinMs = 8, MedianMs = 10, AvgMs = 10, P90Ms = 12, MaxMs = 14, JitterMs = 1.2 };
        var report = new SpeedTestReport
        {
            Network = new SpeedTestNetwork { Type = "ethernet", LinkMbps = 1000, Gateway = "10.0.0.1" },
            Latency = new SpeedTestLatency
            {
                Idle = stats,
                Targets =
                [
                    new SpeedTestTarget { Kind = "gateway", Sent = 10, Received = 10, Stats = stats with { MedianMs = 0.6 } },
                    new SpeedTestTarget { Kind = "internet", Sent = 10, Received = 10, Stats = stats },
                    new SpeedTestTarget { Kind = "server", Method = "http", Sent = 10, Received = 10, Stats = stats with { MedianMs = 22 } },
                ],
            },
            Download = new SpeedTestDirection { Mbps = 480, Loaded = stats with { MedianMs = 14 } },
            Upload = new SpeedTestDirection { Mbps = 240, Loaded = stats with { MedianMs = 25 } },
        };
        var a = SpeedTestAnalyzer.Analyze(report, 500, 250);
        Assert.Equal("excellent", a.Quality);
        Assert.Equal("A", a.BloatGrade);
        Assert.Equal("ok", Assert.Single(a.Findings).Severity);
        Assert.All(a.Usage, u => Assert.Equal("great", u.Rating));
        Assert.Equal(96.0, a.PlanDownloadPct);

        // A mesma maquina num cabo de 100 Mbit/s: o link vira o gargalo.
        var slowLink = report with { Network = report.Network with { LinkMbps = 100 }, Download = report.Download with { Mbps = 94 } };
        var finding = Assert.Single(SpeedTestAnalyzer.Analyze(slowLink, null, null).Findings);
        Assert.Equal("warning", finding.Severity);
        Assert.StartsWith("Placa de rede conectada a 100 Mbit/s", finding.Title, StringComparison.Ordinal);
    }
}
