using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task SoftwareCatalog_SearchesChocolateyAndWinget()
    {
        var admin = await fixture.AdminClientAsync();

        var choco = await admin.GetFromJsonAsync<JsonElement>("/api/software/catalog/choco?q=chrome");
        Assert.Equal("GoogleChrome", choco.GetProperty("items")[0].GetProperty("id").GetString());
        Assert.Equal(393971326, choco.GetProperty("items")[0].GetProperty("downloads").GetInt64());
        var before = PackageFeeds.ChocoRequests;
        await admin.GetFromJsonAsync<JsonElement>("/api/software/catalog/choco?q=CHROME");
        Assert.Equal(before, PackageFeeds.ChocoRequests); // mesmo termo: vem do cache

        var winget = await admin.GetFromJsonAsync<JsonElement>("/api/software/catalog/winget?q=chrome");
        var ids = winget.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()).ToList();
        Assert.Equal(["Google.Chrome", "Google.Chrome.Beta"], ids);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/software/catalog/winget?q=a")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/software/catalog/apt?q=chrome")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.NewClient().GetAsync("/api/software/catalog/choco?q=chrome")).StatusCode);
    }

    [Fact]
    public async Task InstallWithWinget_PublishesCommandAndFailedResultMarksAction()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente winget");
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        NewAgentBody body;
        using (var http = AgentClient(installer))
        {
            var created = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = "host-winget", site = siteId, monitoring_type = "workstation", plat = "windows" });
            body = (await created.Content.ReadFromJsonAsync<NewAgentBody>())!;
        }
        await using var agent = new FakeAgent(await ConnectAsAgentAsync(agentId, body.Token), agentId, _ => null);

        var bad = await admin.PostAsJsonAsync($"/api/agents/{body.Pk}/software/install", new { package = "Git.Git & calc", manager = "winget" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{body.Pk}/software/install", new { package = "git", manager = "apt" })).StatusCode);

        var ok = await admin.PostAsJsonAsync($"/api/agents/{body.Pk}/software/install", new { package = "Notepad++.Notepad++", manager = "winget" });
        Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
        var actionId = (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("pendingActionId").GetInt64();
        IReadOnlyDictionary<string, object?>? received = null;
        for (var i = 0; i < 50 && received is null; i++)
        {
            await Task.Delay(100);
            lock (agent.Received)
            {
                received = agent.Received.FirstOrDefault(r => r.GetString("func") == "installwithwinget");
            }
        }
        Assert.NotNull(received);
        Assert.Equal("Notepad++.Notepad++", received.GetString("winget_id"));

        using (var http = AgentClient(body.Token))
        {
            var patch = await http.PatchAsJsonAsync($"/api/v4/{agentId}/{actionId}/wingetresult/", new { results = "error: winget terminou com codigo 0x8A150014\n\nNo applicable installer found" });
            Assert.True(patch.IsSuccessStatusCode);
        }
        var actions = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{body.Pk}/pending-actions");
        var action = actions.EnumerateArray().Single(a => a.GetProperty("id").GetInt64() == actionId);
        Assert.Equal("wingetinstall", action.GetProperty("type").GetString());
        Assert.Equal("failed", action.GetProperty("status").GetString());
        using var details = JsonDocument.Parse(action.GetProperty("details").GetString()!);
        Assert.Equal("winget", details.RootElement.GetProperty("manager").GetString());
        Assert.Equal("Notepad++.Notepad++", details.RootElement.GetProperty("name").GetString());
    }
}
