using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task ListAgents_SortsByColumnAndDirection()
    {
        var (admin, clientId, siteId) = await NewSiteAsync("Cliente ordenacao");
        var installer = await InstallerTokenAsync(admin, siteId);
        using (var http = AgentClient(installer))
        {
            foreach (var (host, plat) in new[] { ("bravo", "linux"), ("alfa", "windows"), ("charlie", "darwin") })
            {
                var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
                var r = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = host, site = siteId, monitoring_type = "server", plat });
                Assert.True(r.IsSuccessStatusCode);
            }
        }
        async Task<List<string>> Hosts(string query)
        {
            var page = await admin.GetFromJsonAsync<JsonElement>($"/api/agents?clientId={clientId}&{query}");
            return page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("hostname").GetString()!).ToList();
        }

        Assert.Equal(["alfa", "bravo", "charlie"], await Hosts(""));
        Assert.Equal(["charlie", "bravo", "alfa"], await Hosts("sortBy=hostname&sortDir=desc"));
        // Mesmo valor na coluna: desempate pelo hostname.
        Assert.Equal(["alfa", "bravo", "charlie"], await Hosts("sortBy=client&sortDir=desc"));
        Assert.Equal(3, (await Hosts("sortBy=lastSeen")).Count);
        // Paginas seguidas nao repetem nem pulam agentes.
        var first = await admin.GetFromJsonAsync<JsonElement>($"/api/agents?clientId={clientId}&sortBy=status&pageSize=2&page=1");
        var second = await admin.GetFromJsonAsync<JsonElement>($"/api/agents?clientId={clientId}&sortBy=status&pageSize=2&page=2");
        var all = first.GetProperty("items").EnumerateArray().Concat(second.GetProperty("items").EnumerateArray()).Select(i => i.GetProperty("hostname").GetString()).ToList();
        Assert.Equal(["alfa", "bravo", "charlie"], all.Order().ToList());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/agents?sortBy=senha")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/agents?sortDir=up")).StatusCode);
    }
}
