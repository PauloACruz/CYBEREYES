using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task MoveAgent_ToAnotherClient_TakesOpenTicketsAndAsset_ButNotClosedTickets()
    {
        var (admin, pk, _, _, fromClientId, fromSiteId) = await RegisteredAgentAsync("Cliente mudanca origem", monitoringType: "workstation");
        var (_, toClientId, toSiteId) = await NewSiteAsync("Cliente mudanca destino");

        var open = await (await admin.PostAsJsonAsync("/api/tickets", new { title = "Chamado aberto da maquina", agentId = pk })).Content.ReadFromJsonAsync<IdOnly>();
        var closed = await (await admin.PostAsJsonAsync("/api/tickets", new { title = "Chamado encerrado da maquina", agentId = pk })).Content.ReadFromJsonAsync<IdOnly>();
        await admin.PutAsJsonAsync($"/api/tickets/{closed!.Id}/status", new { status = "closed" });
        var assetId = await InDbAsync(async db =>
        {
            var asset = new Cybereyes.Core.Inventory.Asset { Name = "maquina", AgentId = pk, FromAgent = true, ClientId = fromClientId, SiteId = fromSiteId };
            db.Assets.Add(asset);
            await db.SaveChangesAsync();
            var person = new Cybereyes.Core.Inventory.Person { ClientId = fromClientId, Name = "Pessoa do cliente antigo" };
            db.People.Add(person);
            await db.SaveChangesAsync();
            db.AssetAssignments.Add(new Cybereyes.Core.Inventory.AssetAssignment { AssetId = asset.Id, PersonId = person.Id, AssignedBy = "teste" });
            await db.SaveChangesAsync();
            return asset.Id;
        });

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = int.MaxValue })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"/api/agents/{int.MaxValue}/site", new { siteId = toSiteId })).StatusCode);

        var moved = await admin.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = toSiteId });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var result = await moved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Cliente mudanca destino", result.GetProperty("clientName").GetString());
        Assert.Equal(1, result.GetProperty("movedTickets").GetInt32());
        Assert.True(result.GetProperty("clientChanged").GetBoolean());

        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}");
        Assert.Equal(toClientId, detail.GetProperty("clientId").GetInt32());
        Assert.Equal(toSiteId, detail.GetProperty("siteId").GetInt32());
        Assert.Equal(toClientId, (await InDbAsync(db => db.Tickets.Where(t => t.Id == open!.Id).Select(t => t.ClientId).SingleAsync())));
        Assert.Equal(fromClientId, (await InDbAsync(db => db.Tickets.Where(t => t.Id == closed.Id).Select(t => t.ClientId).SingleAsync())));
        var asset = await InDbAsync(db => db.Assets.Where(a => a.Id == assetId).Select(a => new { a.ClientId, a.SiteId }).SingleAsync());
        Assert.Equal(toClientId, asset.ClientId);
        Assert.Equal(toSiteId, asset.SiteId);
        Assert.False(await InDbAsync(db => db.AssetAssignments.AnyAsync(x => x.AssetId == assetId && x.UnassignedAt == null)));
        Assert.Contains("de Cliente mudanca origem / Matriz para Cliente mudanca destino / Matriz",
            await admin.GetStringAsync("/api/audit?pageSize=200"), StringComparison.Ordinal);

        // Mesmo site de novo: nada muda.
        var again = await (await admin.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = toSiteId })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, again.GetProperty("movedTickets").GetInt32());
        Assert.False(again.GetProperty("clientChanged").GetBoolean());
    }

    [Fact]
    public async Task MoveAgent_RefusesSnmpCollectorOfTheOldClient_AndNeedsManagePermission()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente mudanca coletor");
        var (_, _, otherSiteId) = await NewSiteAsync("Cliente mudanca coletor destino");
        var siteSameClient = await admin.PostAsJsonAsync($"/api/clients/{clientId}/sites", new { name = "Filial" });
        Assert.Equal(HttpStatusCode.Created, siteSameClient.StatusCode);
        var filialId = (await siteSameClient.Content.ReadFromJsonAsync<IdOnly>())!.Id;
        await InDbAsync(async db =>
        {
            db.SnmpDevices.Add(new Cybereyes.Core.Rmm.SnmpDevice { ClientId = clientId, CollectorAgentId = pk, Name = "Switch", Host = "10.0.0.2" });
            return await db.SaveChangesAsync();
        });

        var refused = await admin.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = otherSiteId });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("SNMP", (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString(), StringComparison.Ordinal);
        // No mesmo cliente o coletor continua valendo.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = filialId })).StatusCode);

        var role = await admin.PostAsJsonAsync("/api/roles", new
        {
            name = "Tecnico sem gerenciar agentes", isSuperuser = false, permissions = new[] { "agents.view", "agents.control", "clients.view" },
        });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        await fixture.CreateUserAsync(admin, "tec.sem.manage", "senha-tec-sem-manage-1", roleId);
        var tecnico = await fixture.SignedInClientAsync("tec.sem.manage", "senha-tec-sem-manage-1");
        Assert.Equal(HttpStatusCode.Forbidden, (await tecnico.PutAsJsonAsync($"/api/agents/{pk}/site", new { siteId = otherSiteId })).StatusCode);
    }
}
