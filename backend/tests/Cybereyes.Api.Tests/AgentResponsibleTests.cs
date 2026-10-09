using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task ListAgents_ShowsAndSearchesTheAssetResponsible()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente responsavel");
        var renata = await (await admin.PostAsJsonAsync("/api/people", new { clientId, name = "Renata Prado", active = true })).Content.ReadFromJsonAsync<IdOnly>();
        var assetId = (await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/asset")).GetProperty("assetId").GetInt32();
        await admin.PutAsJsonAsync($"/api/assets/{assetId}/responsible", new { personId = renata!.Id });

        var found = (await admin.GetFromJsonAsync<JsonElement>("/api/agents?search=renata&sortBy=responsible")).GetProperty("items").EnumerateArray().ToList();
        var item = Assert.Single(found);
        Assert.Equal(pk, item.GetProperty("id").GetInt32());
        Assert.Equal(renata.Id, item.GetProperty("responsible").GetProperty("id").GetInt32());
        Assert.Equal("Renata Prado", item.GetProperty("responsible").GetProperty("name").GetString());

        // Ao remover o responsavel, a coluna fica vazia e a busca pelo nome nao encontra mais o agente.
        await admin.PutAsJsonAsync($"/api/assets/{assetId}/responsible", new { personId = (int?)null });
        Assert.Empty((await admin.GetFromJsonAsync<JsonElement>("/api/agents?search=renata")).GetProperty("items").EnumerateArray());
        var mine = (await admin.GetFromJsonAsync<JsonElement>($"/api/agents?clientId={clientId}&sortBy=responsible&sortDir=desc")).GetProperty("items");
        Assert.Equal(JsonValueKind.Null, Assert.Single(mine.EnumerateArray()).GetProperty("responsible").ValueKind);
    }
}
