using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

/// <summary>
/// EYES real medindo de verdade contra a Cloudflare: so com EYES_SPEEDTEST_LIVE definida (depende da internet). EYES_SPEEDTEST_LIVE=full
/// usa o teste completo; EYES_SPEEDTEST_PDF e EYES_SPEEDTEST_DETAIL gravam o PDF e o JSON do relatorio para conferir.
/// </summary>
public sealed class EyesLiveFactAttribute : FactAttribute
{
    public EyesLiveFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("EYES_SPEEDTEST_LIVE")))
        {
            Skip = "Teste de velocidade real: defina EYES_SPEEDTEST_LIVE=1 (usa a internet)";
        }
        else if (EyesBinary.Path is null)
        {
            Skip = "EYES indisponivel: defina EYES_BIN ou instale o Go para compilar agent/";
        }
    }
}

[Collection(ApiCollection.Name)]
public sealed class EyesSpeedTestE2ETests(ApiFixture fixture)
{
    [EyesLiveFact]
    public async Task Eyes_RunsTheSpeedTest_AndTheApiBuildsTheReport()
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/clients", new { name = "Cliente EYES velocidade", siteName = "Matriz" });
        var siteId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sites")[0].GetProperty("id").GetInt32();
        var installer = await admin.PostAsJsonAsync("/api/agents/installer", new { siteId, agentType = "workstation", plat = "linux", expiresHours = 1 });
        var parts = (await installer.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("command").GetString()!.Split(' ');
        await using var proxy = await ApiProxy.StartAsync(fixture);
        await using var eyes = await EyesProcess.StartAsync(proxy.Url, fixture.NatsUrl, siteId, parts[Array.IndexOf(parts, "--auth") + 1]);

        var watch = Stopwatch.StartNew();
        int? pk = null;
        while (pk is null && watch.Elapsed < TimeSpan.FromSeconds(60))
        {
            var items = (await admin.GetFromJsonAsync<JsonElement>($"/api/agents?siteId={siteId}")).GetProperty("items");
            if (items.GetArrayLength() == 1 && items[0].GetProperty("version").GetString() == EyesBinary.Version)
            {
                pk = items[0].GetProperty("id").GetInt32();
            }
            else
            {
                await Task.Delay(500);
            }
        }
        Assert.True(pk is not null, $"EYES nao registrou. Log:\n{eyes.Log}");

        HttpResponseMessage? start = null;
        while (watch.Elapsed < TimeSpan.FromSeconds(90))
        {
            // Logo depois do registro o agente pode ainda nao ter assinado o NATS.
            start = await admin.PostAsJsonAsync($"/api/agents/{pk}/speedtests", new { mode = Environment.GetEnvironmentVariable("EYES_SPEEDTEST_LIVE") == "full" ? "full" : "quick", planDownloadMbps = 1000 });
            if (start.StatusCode == HttpStatusCode.Created)
            {
                break;
            }
            await Task.Delay(1000);
        }
        Assert.Equal(HttpStatusCode.Created, start!.StatusCode);
        var testId = (await start.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        JsonElement detail = default;
        var phases = new HashSet<string>();
        var poll = Stopwatch.StartNew();
        while (poll.Elapsed < TimeSpan.FromMinutes(4))
        {
            detail = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/speedtests/{testId}");
            var test = detail.GetProperty("test");
            if (test.GetProperty("phase").GetString() is { } phase)
            {
                phases.Add(phase);
            }
            if (test.GetProperty("status").GetString() is "completed" or "failed")
            {
                break;
            }
            await Task.Delay(500);
        }
        var summary = detail.GetProperty("test");
        Assert.True(summary.GetProperty("status").GetString() == "completed", $"Teste: {summary}\nLog do EYES:\n{eyes.Log}");
        Assert.Contains("download", phases);
        Assert.True(summary.GetProperty("downloadMbps").GetDouble() > 0);
        Assert.True(summary.GetProperty("uploadMbps").GetDouble() > 0);
        var report = detail.GetProperty("report");
        Assert.False(string.IsNullOrEmpty(report.GetProperty("network").GetProperty("localIp").GetString()));
        Assert.False(string.IsNullOrEmpty(report.GetProperty("connection").GetProperty("publicIp").GetString()));
        Assert.Contains(report.GetProperty("latency").GetProperty("targets").EnumerateArray(), t => t.GetProperty("kind").GetString() == "server");
        Assert.True(detail.GetProperty("analysis").GetProperty("planDownloadPct").GetDouble() > 0);

        var pdf = await admin.GetAsync($"/api/agents/{pk}/speedtests/{testId}/pdf");
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        if (Environment.GetEnvironmentVariable("EYES_SPEEDTEST_PDF") is { Length: > 0 } output)
        {
            await File.WriteAllBytesAsync(output, await pdf.Content.ReadAsByteArrayAsync());
        }
        if (Environment.GetEnvironmentVariable("EYES_SPEEDTEST_DETAIL") is { Length: > 0 } json)
        {
            await File.WriteAllTextAsync(json, detail.GetRawText());
        }
    }
}
