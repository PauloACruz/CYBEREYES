using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Remote;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Tests;

/// <summary>Wake-on-LAN pelo EYES (contrato do acesso remoto, secao 3).</summary>
public sealed partial class AgentTests
{
    private const string WindowsInventory = """
        {"network_config":[[{"MACAddress":"aa-bb-cc-dd-ee-01","IPEnabled":true,"IPAddress":["192.168.50.20","fe80::1"],"IPSubnet":["255.255.255.0","64"]}]]}
        """;

    private const string LinuxInventory = """{"nics":[{"name":"eth0","mac":"AA:BB:CC:DD:EE:02","ips":["192.168.50.30/24"]}]}""";

    [Fact]
    public void Wake_ReadsNicsFromWindowsAndUnixInventory()
    {
        var win = RemoteWake.Nics(WindowsInventory, "windows");
        var nic = Assert.Single(win);
        Assert.Equal("AA:BB:CC:DD:EE:01", nic.Mac);
        Assert.Equal(24, nic.Prefix);
        Assert.Equal("192.168.50.255", nic.Broadcast.ToString());

        var unix = Assert.Single(RemoteWake.Nics(LinuxInventory, "linux"));
        Assert.True(unix.SameNetwork(nic.Address));
        Assert.Empty(RemoteWake.Nics("nao e json", "linux"));
        Assert.Equal(22, RemoteWake.MaskPrefix("255.255.252.0"));
        Assert.Null(RemoteWake.MaskPrefix("255.0.255.0"));
    }

    [Fact]
    public async Task Wake_SendsThroughOnlineAgentOnSameNetwork()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente wol");
        var installer = await InstallerTokenAsync(admin, siteId);
        var (_, targetPk, _) = await RegisterAgentAsync(installer, siteId, "desligada");
        var (relayId, relayPk, relayToken) = await RegisterAgentAsync(installer, siteId, "vizinha");
        var nats = await ConnectAsAgentAsync(relayId, relayToken);
        await using var relay = new FakeAgent(nats, relayId, r => r.GetString("func") == "wol" ? "ok" : null);

        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.Agents.Where(a => a.Id == targetPk).ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Status, AgentStatus.Offline).SetProperty(a => a.Plat, "windows").SetProperty(a => a.WmiDetail, WindowsInventory));
            await db.Agents.Where(a => a.Id == relayPk).ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Status, AgentStatus.Online).SetProperty(a => a.Version, "3.1.0").SetProperty(a => a.Plat, "linux")
                .SetProperty(a => a.WmiDetail, LinuxInventory));
        }

        var response = await admin.PostAsync($"/api/agents/{targetPk}/wake", null);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("vizinha", body.GetProperty("via").GetString());

        IReadOnlyDictionary<string, object?> sent;
        lock (relay.Received)
        {
            sent = relay.Received.Single(r => r.GetString("func") == "wol");
        }
        var payload = (IReadOnlyDictionary<string, object?>)sent["payload"]!;
        Assert.Equal("[\"AA:BB:CC:DD:EE:01\"]", payload.GetString("macs"));
        Assert.Equal("[\"192.168.50.255\"]", payload.GetString("broadcast"));

        // Sem vizinho online na mesma rede: 409 com explicacao.
        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.Agents.Where(a => a.Id == relayPk).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AgentStatus.Offline));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/agents/{targetPk}/wake", null)).StatusCode);
    }
}
