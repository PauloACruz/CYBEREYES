using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using NATS.Client.Core;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed partial class AgentTests(ApiFixture fixture)
{
    private static readonly string AgentVersion = "2.11.0";

    private async Task<(HttpClient Admin, int ClientId, int SiteId)> NewSiteAsync(string name)
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/clients", new { name, siteName = "Matriz" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var client = await created.Content.ReadFromJsonAsync<ClientBody>();
        return (admin, client!.Id, client.Sites[0].Id);
    }

    private static async Task<string> InstallerTokenAsync(HttpClient admin, int siteId)
    {
        var response = await admin.PostAsJsonAsync("/api/agents/installer", new { siteId, agentType = "auto", plat = "linux", expiresHours = 1 });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<InstallerBody>();
        var parts = body!.Command.Split(' ');
        return parts[Array.IndexOf(parts, "--auth") + 1];
    }

    private async Task<(string AgentId, int Pk, string Token)> RegisterAgentAsync(string installerToken, int siteId, string hostname)
    {
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = fixture.NewClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", installerToken);
        var response = await http.PostAsJsonAsync("/api/v3/newagent/", new
        {
            agent_id = agentId, hostname, site = siteId, monitoring_type = "workstation", mesh_node_id = "", description = "", goarch = "amd64", plat = "linux",
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<NewAgentBody>();
        return (agentId, body!.Pk, body.Token);
    }

    private HttpClient AgentClient(string token)
    {
        var http = fixture.NewClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", token);
        return http;
    }

    private async Task<NatsConnection> ConnectAsAgentAsync(string agentId, string token)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (true)
        {
            var nats = new NatsConnection(new NatsOpts
            {
                Url = fixture.NatsUrl,
                AuthOpts = new NatsAuthOpts { Username = agentId, Password = token },
                MaxReconnectRetry = 0,
            });
            try
            {
                await nats.ConnectAsync();
                return nats;
            }
            catch (NatsException) when (DateTime.UtcNow < deadline)
            {
                await nats.DisposeAsync();
                await Task.Delay(500);
            }
        }
    }

    [Fact]
    public async Task InstallerToken_ValidatesAndRegistersAgent_LikeTheGoAgentExpects()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente registro");
        var installer = await InstallerTokenAsync(admin, siteId);

        using (var http = AgentClient(installer))
        {
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/v3/installer/")).StatusCode);
            var version = await http.PostAsJsonAsync("/api/v3/installer/", new { version = AgentVersion });
            Assert.Equal("\"ok\"", await version.Content.ReadAsStringAsync());
            var old = await http.PostAsJsonAsync("/api/v3/installer/", new { version = "2.0.0" });
            Assert.Equal(HttpStatusCode.BadRequest, old.StatusCode);
        }
        using (var invalid = AgentClient(new string('0', 64)))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await invalid.GetAsync("/api/v3/installer/")).StatusCode);
        }

        var (agentId, pk, token) = await RegisterAgentAsync(installer, siteId, "estacao-01");
        Assert.Equal(40, token.Length);

        using var agent = AgentClient(token);
        using var config = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/config/"));
        foreach (var key in new[] { "checkin_hello", "checkin_agentinfo", "checkin_winsvc", "checkin_pubip", "checkin_disks", "checkin_sw", "checkin_wmi", "checkin_syncmesh" })
        {
            Assert.True(config.RootElement.GetProperty(key).GetInt32() > 0, key);
        }
        using var checks = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/checkrunner/"));
        Assert.Equal(pk, checks.RootElement.GetProperty("agent").GetInt32());
        Assert.True(checks.RootElement.GetProperty("check_interval").GetInt32() > 0);

        Assert.Equal(HttpStatusCode.Forbidden, (await agent.GetAsync("/api/users")).StatusCode);

        var duplicate = await AgentClient(installer).PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = "x", site = siteId });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task NatsCheckin_UpdatesAgent_AndPingReachesAgent()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente nats");
        var (agentId, pk, token) = await RegisterAgentAsync(await InstallerTokenAsync(admin, siteId), siteId, "estacao-nats");

        await using var nats = await ConnectAsAgentAsync(agentId, token);

        await nats.PublishAsync(agentId, MsgPack.Serialize(new Dictionary<string, object?> { ["agent_id"] = agentId, ["version"] = AgentVersion }),
            serializer: NatsRawSerializer<byte[]>.Default, replyTo: "agent-hello");
        await nats.PublishAsync(agentId, MsgPack.Serialize(new Dictionary<string, object?>
        {
            ["agent_id"] = agentId, ["logged_in_username"] = "maria", ["hostname"] = "estacao-nats", ["operating_system"] = "Ubuntu 24.04",
            ["plat"] = "linux", ["total_ram"] = 16.0, ["boot_time"] = 1_700_000_000L, ["needs_reboot"] = false, ["goarch"] = "amd64",
        }), serializer: NatsRawSerializer<byte[]>.Default, replyTo: "agent-agentinfo");
        await nats.PublishAsync(agentId, MsgPack.Serialize(new Dictionary<string, object?>
        {
            ["agent_id"] = agentId,
            ["disks"] = new object[] { new Dictionary<string, object?> { ["device"] = "/dev/sda1", ["fstype"] = "ext4", ["total"] = "100 GB", ["used"] = "40 GB", ["free"] = "60 GB", ["percent"] = 40 } },
        }), serializer: NatsRawSerializer<byte[]>.Default, replyTo: "agent-disks");

        AgentBody? detail = null;
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < TimeSpan.FromSeconds(15))
        {
            detail = await admin.GetFromJsonAsync<AgentBody>($"/api/agents/{pk}");
            if (detail!.Version == AgentVersion && detail.LastLoggedInUser == "maria" && detail.Disks.ValueKind == JsonValueKind.Array)
            {
                break;
            }
            await Task.Delay(300);
        }
        Assert.Equal(AgentVersion, detail!.Version);
        Assert.Equal("Ubuntu 24.04", detail.OperatingSystem);
        Assert.Equal(16, detail.TotalRam);
        Assert.Equal("/dev/sda1", detail.Disks[0].GetProperty("device").GetString());
        Assert.Equal("online", detail.Status);

        var responder = Task.Run(async () =>
        {
            await foreach (var msg in nats.SubscribeAsync(agentId, serializer: NatsRawSerializer<byte[]>.Default))
            {
                var request = MsgPack.DeserializeMap(msg.Data!);
                if (request?.GetString("func") == "ping")
                {
                    await msg.ReplyAsync(MsgPack.Serialize("pong"), serializer: NatsRawSerializer<byte[]>.Default);
                    return;
                }
            }
        });
        await Task.Delay(500);
        var ping = await admin.PostAsync($"/api/agents/{pk}/ping", null);
        Assert.Equal("online", (await ping.Content.ReadFromJsonAsync<StatusBody>())!.Status);
        await responder.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task LinuxInstallScript_IsValidBash_AndDetectsGraphicalEnvironment()
    {
        var script = await fixture.NewClient().GetStringAsync("/api/install/linux.sh");

        Assert.Contains("API_URL=\"https://rmm.exemplo.com\"", script, StringComparison.Ordinal);
        Assert.Contains("has_gui", script, StringComparison.Ordinal);
        Assert.Contains("AGENT_TYPE=\"workstation\"; else AGENT_TYPE=\"server\"", script, StringComparison.Ordinal);
        Assert.Equal(0, await BashSyntaxCheckAsync(script));
    }

    [Fact]
    public async Task Deployment_ServesScriptWithToken_UntilDeleted()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente implantacao");
        var created = await admin.PostAsJsonAsync("/api/deployments", new { siteId, agentType = "auto", expiresAt = DateTimeOffset.UtcNow.AddDays(7) });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var deployment = await created.Content.ReadFromJsonAsync<DeploymentBody>();

        var anonymous = fixture.NewClient();
        var script = await anonymous.GetStringAsync($"/api/deploy/{deployment!.Uid}/linux");
        Assert.Contains($"SITE_ID=\"{siteId}\"", script, StringComparison.Ordinal);
        Assert.Equal(0, await BashSyntaxCheckAsync(script));

        var token = script.Split('\n').Single(l => l.StartsWith("TOKEN=", StringComparison.Ordinal))[7..^1];
        using (var installer = AgentClient(token))
        {
            Assert.Equal(HttpStatusCode.OK, (await installer.GetAsync("/api/v3/installer/")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/deployments/{deployment.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/deploy/{deployment.Uid}/linux")).StatusCode);
        using var revoked = AgentClient(token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await revoked.GetAsync("/api/v3/installer/")).StatusCode);
    }

    [Fact]
    public async Task ClientWithAgents_CannotBeDeleted()
    {
        var (admin, clientId, siteId) = await NewSiteAsync("Cliente com agente");
        await RegisterAgentAsync(await InstallerTokenAsync(admin, siteId), siteId, "servidor-01");

        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/clients/{clientId}")).StatusCode);
        var list = await admin.GetFromJsonAsync<PagedAgents>($"/api/agents?clientId={clientId}");
        Assert.Equal("servidor-01", Assert.Single(list!.Items).Hostname);
    }

    private static async Task<int> BashSyntaxCheckAsync(string script)
    {
        var path = Path.GetTempFileName();
        await File.WriteAllTextAsync(path, script);
        using var process = Process.Start("bash", ["-n", path]);
        await process.WaitForExitAsync();
        File.Delete(path);
        return process.ExitCode;
    }

    private sealed record SiteBody(int Id, string Name);
    private sealed record ClientBody(int Id, string Name, List<SiteBody> Sites);
    private sealed record InstallerBody(string Command);
    private sealed record NewAgentBody(int Pk, string Token);
    private sealed record StatusBody(string Status);
    private sealed record DeploymentBody(int Id, Guid Uid);
    private sealed record AgentItem(int Id, string Hostname);
    private sealed record PagedAgents(List<AgentItem> Items, int Total);
    private sealed record AgentBody(int Id, string Version, string? OperatingSystem, int? TotalRam, string? LastLoggedInUser, string Status, JsonElement Disks);
}
