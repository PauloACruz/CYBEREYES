using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using NATS.Client.Core;
using WinCare.Api.Rmm.Nats;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    private const string Catalog = """
        {"version":"1","modules":[{"key":"maintenance","label":"Manutencao","platforms":["linux"],"tasks":[
          {"key":"clean_tmp","label":"Limpar temporarios","group":"Limpeza","default":true,"platforms":["linux"],"selfService":true,"reboot":false,"dangerous":false,"params":[]},
          {"key":"journal_vacuum","label":"Reduzir journal","group":"Limpeza","default":false,"platforms":["linux"],"selfService":false,"reboot":false,"dangerous":false,"params":[]}]}]}
        """;

    private async Task<(HttpClient Admin, int Pk, string AgentId, string Token, FakeAgent Agent)> WinCareAgentAsync(string client,
        Func<IReadOnlyDictionary<string, object?>, object?> reply)
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = AgentClient(installer);
        var body = await (await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = "wc-host", site = siteId, monitoring_type = "workstation", plat = "linux" }))
            .Content.ReadFromJsonAsync<NewAgentBody>();
        var nats = await ConnectAsAgentAsync(agentId, body!.Token);
        return (admin, body.Pk, agentId, body.Token, new FakeAgent(nats, agentId, reply));
    }

    private static string? Payload(IReadOnlyDictionary<string, object?> request, string key) =>
        request.TryGetValue("payload", out var p) && p is IReadOnlyDictionary<string, object?> map ? map.GetString(key) : null;

    private static async Task PublishEventAsync(NatsConnection nats, string agentId, string runId, object evt) =>
        await nats.PublishAsync($"{agentId}.cmdoutput.{runId}", MsgPack.Serialize(JsonSerializer.Serialize(evt)), serializer: NatsRawSerializer<byte[]>.Default);

    private static async Task<JsonElement> WaitRunAsync(HttpClient admin, string runId, Func<JsonElement, bool> done)
    {
        for (var i = 0; i < 50; i++)
        {
            var run = await admin.GetFromJsonAsync<JsonElement>($"/api/wincare/runs/{runId}");
            if (done(run))
            {
                return run;
            }
            await Task.Delay(200);
        }
        throw new TimeoutException("A execucao nao chegou ao estado esperado");
    }

    [Fact]
    public async Task WinCareRun_StreamsAgentEvents_InOrder_AndFinishes()
    {
        string? runId = null;
        var (admin, pk, agentId, _, agent) = await WinCareAgentAsync("Cliente wincare", r => r.GetString("func") switch
        {
            "wincare_catalog" => Catalog,
            "wincare_run" => (runId = Payload(r, "run_id")) is not null && Payload(r, "tasks") == "clean_tmp" ? "started" : "error: unknown task",
            _ => null,
        });
        await using var _ = agent;

        var catalog = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/wincare/catalog");
        Assert.Equal("maintenance", catalog.GetProperty("modules")[0].GetProperty("key").GetString());

        var started = await admin.PostAsJsonAsync($"/api/agents/{pk}/wincare/runs", new { module = "maintenance", tasks = new[] { "clean_tmp" } });
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        Assert.Matches("^wc-[0-9a-f]{32}$", runId);
        var busy = await admin.PostAsJsonAsync($"/api/agents/{pk}/wincare/runs", new { module = "maintenance", tasks = new[] { "clean_tmp" } });
        Assert.Equal("AGENT_BUSY", (await busy.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        // Eventos chegam fora de ordem e um repetido; a API guarda uma vez e devolve em ordem de seq.
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 2, time = "2026-10-01T10:00:01Z", type = "progress", value = 50 });
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 1, time = "2026-10-01T10:00:00Z", type = "task", key = "clean_tmp", status = "running" });
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 3, time = "2026-10-01T10:00:02Z", type = "log", level = "SUCCESS", message = "120 arquivos removidos" });
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 3, time = "2026-10-01T10:00:02Z", type = "log", level = "SUCCESS", message = "120 arquivos removidos" });
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 4, time = "2026-10-01T10:00:03Z", type = "task", key = "clean_tmp", status = "ok" });
        await PublishEventAsync(agent.Nats, agentId, runId!, new { seq = 5, time = "2026-10-01T10:00:04Z", type = "done", status = "ok", durationMs = 4000, rebootRequired = true });

        var run = await WaitRunAsync(admin, runId!, r => r.GetProperty("status").GetString() == "ok");
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, run.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("seq").GetInt32()));
        Assert.Equal("ok", run.GetProperty("taskStatus").GetProperty("clean_tmp").GetString());
        Assert.Equal(100, run.GetProperty("progress").GetInt32());
        Assert.True(run.GetProperty("rebootRequired").GetBoolean());

        var bad = await admin.PostAsJsonAsync($"/api/agents/{pk}/wincare/runs", new { module = "maintenance", tasks = new[] { "nao_existe" } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task HealthCheck_IsCollectedFromAgent_AndStored()
    {
        const string report = """{"score":83,"grade":"bom","collectedAt":"2026-10-01T10:00:00Z","platform":"linux","items":[{"key":"cpu","label":"Uso de CPU","category":"desempenho","status":"ok","value":"5%","detail":"","weight":10,"points":10}]}""";
        var (admin, pk, _, _, agent) = await WinCareAgentAsync("Cliente saude", r => r.GetString("func") == "wincare_health" ? report : null);
        await using var _ = agent;

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/agents/{pk}/health")).StatusCode);
        var collected = await (await admin.PostAsync($"/api/agents/{pk}/health", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(83, collected.GetProperty("score").GetInt32());
        var stored = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/health");
        Assert.Equal("bom", stored.GetProperty("grade").GetString());
    }

    [Fact]
    public async Task SelfService_OnlyRunsTasksReleasedByTechnician()
    {
        var (admin, _, _, token, agent) = await WinCareAgentAsync("Cliente autoatendimento", r => r.GetString("func") switch
        {
            "wincare_catalog" => Catalog,
            "wincare_run" => "started",
            _ => null,
        });
        await using var _ = agent;
        using var agentHttp = AgentClient(token);
        using var tray = await TrayClientAsync(agentHttp, "carla");

        Assert.False((await tray.GetFromJsonAsync<JsonElement>("/api/tray/self-service")).GetProperty("enabled").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/wincare/self-service",
            new { enabled = true, tasks = new[] { "maintenance.clean_tmp", "maintenance.journal_vacuum" } })).StatusCode);

        var options = await tray.GetFromJsonAsync<JsonElement>("/api/tray/self-service");
        var only = Assert.Single(options.GetProperty("tasks").EnumerateArray());
        Assert.Equal("clean_tmp", only.GetProperty("key").GetString());

        Assert.Equal(HttpStatusCode.Forbidden, (await tray.PostAsJsonAsync("/api/tray/self-service/run", new { module = "maintenance", key = "journal_vacuum" })).StatusCode);
        var run = await tray.PostAsJsonAsync("/api/tray/self-service/run", new { module = "maintenance", key = "clean_tmp" });
        Assert.Equal(HttpStatusCode.Accepted, run.StatusCode);
        var runId = (await run.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("runId").GetString();
        Assert.Equal("running", (await tray.GetFromJsonAsync<JsonElement>($"/api/tray/self-service/runs/{runId}")).GetProperty("status").GetString());

        await admin.PutAsJsonAsync("/api/wincare/self-service", new { enabled = false, tasks = Array.Empty<string>() });
    }
}
