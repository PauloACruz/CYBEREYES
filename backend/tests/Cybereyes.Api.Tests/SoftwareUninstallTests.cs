using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private async Task<(HttpClient Admin, int Pk, string AgentId, string Token, FakeAgent Agent)> WindowsAgentAsync(string client, string version)
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = AgentClient(installer);
        var response = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = "estacao-win", site = siteId, monitoring_type = "workstation", plat = "windows" });
        var body = await response.Content.ReadFromJsonAsync<NewAgentBody>();
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.Agents.Where(a => a.Id == body!.Pk).ExecuteUpdateAsync(set => set.SetProperty(a => a.Version, version));
        }
        var nats = await ConnectAsAgentAsync(agentId, body!.Token);
        return (admin, body.Pk, agentId, body.Token, new FakeAgent(nats, agentId, _ => null));
    }

    private static async Task<IReadOnlyDictionary<string, object?>> WaitForFuncAsync(FakeAgent agent, string func)
    {
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < TimeSpan.FromSeconds(10))
        {
            lock (agent.Received)
            {
                if (agent.Received.FirstOrDefault(r => r.GetString("func") == func) is { } found)
                {
                    return found;
                }
            }
            await Task.Delay(100);
        }
        throw new TimeoutException($"{func} nao chegou ao agente");
    }

    [Fact]
    public async Task SoftwareUninstall_RunsOnAgent_AndCleanupOnlyAcceptsFoundLeftovers()
    {
        var (admin, pk, agentId, token, agent) = await WindowsAgentAsync("Cliente desinstalacao", "3.3.0");
        await using var _ = agent;

        var invalidMode = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/uninstall", new { name = "Mozilla Firefox", mode = "turbo" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidMode.StatusCode);

        var started = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/uninstall", new
        {
            name = "Mozilla Firefox (x64 pt-BR)", version = "120.0", publisher = "Mozilla", key = @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Mozilla Firefox",
            mode = "advanced", runUninstaller = true, restorePoint = true,
        });
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        var actionId = (await started.Content.ReadFromJsonAsync<PendingActionIdBody>())!.PendingActionId;

        var sent = await WaitForFuncAsync(agent, "softwareuninstall");
        Assert.Equal("Mozilla Firefox (x64 pt-BR)", sent.GetString("name"));
        Assert.Equal("advanced", sent.GetString("mode"));
        Assert.True(sent.GetBool("run_uninstaller"));
        Assert.True(sent.GetBool("restore_point"));
        Assert.Equal(actionId, Convert.ToInt64(sent["pending_action_pk"], System.Globalization.CultureInfo.InvariantCulture));

        // O agente devolve as sobras; o servidor guarda so os campos conhecidos.
        using (var http = AgentClient(token))
        {
            var result = await http.PatchAsJsonAsync($"/api/v4/{agentId}/{actionId}/softwareresult/", new
            {
                ok = true, results = "Desinstalador concluido", scanned = true, ran_uninstaller = true, extra = "ignorado",
                leftovers = new object[]
                {
                    new { kind = "dir", path = @"C:\Program Files\Mozilla Firefox", detail = "2 KB", level = "high" },
                    new { kind = "value", path = @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", name = "Updater", level = "high" },
                    new { kind = "dir", path = @"C:\Users\joao\AppData\Local\Mozilla", level = "medium", user = true },
                    new { kind = "desconhecido", path = "x", level = "high" },
                },
            });
            Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        }
        var actions = await admin.GetFromJsonAsync<List<PendingActionBody>>($"/api/agents/{pk}/pending-actions");
        var done = Assert.Single(actions!, a => a.Id == actionId);
        Assert.Equal("completed", done.Status);
        using (var output = JsonDocument.Parse(done.Output!))
        {
            Assert.True(output.RootElement.GetProperty("ranUninstaller").GetBoolean());
            Assert.Equal(3, output.RootElement.GetProperty("leftovers").GetArrayLength());
            Assert.False(output.RootElement.TryGetProperty("extra", out JsonElement _));
        }

        var outside = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/cleanup", new
        {
            actionId, items = new[] { new { kind = "dir", path = @"C:\Windows\System32", name = (string?)null } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, outside.StatusCode);
        var empty = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/cleanup", new { actionId, items = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

        var cleanup = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/cleanup", new
        {
            actionId,
            items = new object[]
            {
                new { kind = "dir", path = @"c:\program files\mozilla firefox" },
                new { kind = "value", path = @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", name = "Updater" },
            },
        });
        Assert.Equal(HttpStatusCode.Accepted, cleanup.StatusCode);
        var cleanupId = (await cleanup.Content.ReadFromJsonAsync<PendingActionIdBody>())!.PendingActionId;
        var cleanupSent = await WaitForFuncAsync(agent, "softwarecleanup");
        var items = Assert.IsAssignableFrom<IEnumerable<object?>>(cleanupSent["items"]).Cast<IReadOnlyDictionary<string, object?>>().ToList();
        Assert.Equal(2, items.Count);
        // O caminho enviado e o que o agente encontrou, nao a grafia do pedido.
        Assert.Equal(@"C:\Program Files\Mozilla Firefox", items[0].GetString("path"));
        Assert.Equal("Updater", items[1].GetString("name"));

        using (var http = AgentClient(token))
        {
            await http.PatchAsJsonAsync($"/api/v4/{agentId}/{cleanupId}/softwareresult/", new { ok = false, results = "Falhou: pasta", removed = 1, failed = 1 });
        }
        actions = await admin.GetFromJsonAsync<List<PendingActionBody>>($"/api/agents/{pk}/pending-actions");
        Assert.Equal("failed", actions!.Single(a => a.Id == cleanupId).Status);
    }

    [Fact]
    public async Task SoftwareUninstall_RequiresWindowsAgentWithNewVersion()
    {
        var (admin, pk, _, _, agent) = await WindowsAgentAsync("Cliente desinstalacao antiga", "3.2.6");
        await using var _ = agent;
        var old = await admin.PostAsJsonAsync($"/api/agents/{pk}/software/uninstall", new { name = "App" });
        Assert.Equal(HttpStatusCode.BadRequest, old.StatusCode);
        Assert.Contains("3.3.0", await old.Content.ReadAsStringAsync());

        var (linuxAdmin, linuxPk, linuxAgent) = await FakeAgentAsync("Cliente desinstalacao linux", "linux", _ => null);
        await using var __ = linuxAgent;
        var linux = await linuxAdmin.PostAsJsonAsync($"/api/agents/{linuxPk}/software/uninstall", new { name = "App" });
        Assert.Equal(HttpStatusCode.BadRequest, linux.StatusCode);
    }

    private sealed record PendingActionIdBody(long PendingActionId);
    private sealed record PendingActionBody(long Id, string Type, string Details, string Status, string? Output);
}
