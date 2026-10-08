using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task RestrictedUser_SeesOnlyTheChosenClients()
    {
        var (admin, visivelPk, _, _, visivelId, _) = await RegisteredAgentAsync("Escopo visivel");
        var (_, ocultoPk, _, _, ocultoId, _) = await RegisteredAgentAsync("Escopo oculto");

        var role = await admin.PostAsJsonAsync("/api/roles", new
        {
            name = "Tecnico de escopo", isSuperuser = false,
            permissions = new[] { "clients.view", "clients.manage", "agents.view", "alerts.view", "tickets.view", "tickets.manage", "inventory.view", "inventory.manage" },
        });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;

        object NewUser(bool allClients, int[] clientIds) => new
        {
            username = "tecnico.escopo", email = "tecnico.escopo@exemplo.com", fullName = "Tecnico Escopo", password = "senha-do-tecnico-1",
            roleIds = new[] { roleId }, allClients, clientIds,
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/users", NewUser(false, []))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/users", NewUser(false, [int.MaxValue]))).StatusCode);
        var created = await admin.PostAsJsonAsync("/api/users", NewUser(false, [visivelId]));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var dto = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(dto.GetProperty("allClients").GetBoolean());
        Assert.Equal(visivelId, Assert.Single(dto.GetProperty("clients").EnumerateArray()).GetProperty("id").GetInt32());

        var ticketOculto = await (await admin.PostAsJsonAsync("/api/tickets", new { title = "Chamado oculto", agentId = ocultoPk })).Content.ReadFromJsonAsync<IdOnly>();
        await admin.PostAsJsonAsync("/api/tickets", new { title = "Chamado visivel", agentId = visivelPk });

        var tecnico = await fixture.SignedInClientAsync("tecnico.escopo", "senha-do-tecnico-1");

        var clients = await tecnico.GetFromJsonAsync<JsonElement>("/api/clients");
        Assert.Equal(visivelId, Assert.Single(clients.EnumerateArray()).GetProperty("id").GetInt32());

        var agents = (await tecnico.GetFromJsonAsync<JsonElement>("/api/agents?pageSize=200")).GetProperty("items").EnumerateArray()
            .Select(a => a.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(visivelPk, agents);
        Assert.DoesNotContain(ocultoPk, agents);
        Assert.Equal(HttpStatusCode.NotFound, (await tecnico.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);

        var tickets = (await tecnico.GetFromJsonAsync<JsonElement>("/api/tickets?pageSize=200")).GetProperty("items").EnumerateArray()
            .Select(t => t.GetProperty("title").GetString()).ToList();
        Assert.Contains("Chamado visivel", tickets);
        Assert.DoesNotContain("Chamado oculto", tickets);
        Assert.Equal(HttpStatusCode.NotFound, (await tecnico.GetAsync($"/api/tickets/{ticketOculto!.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await tecnico.GetAsync("/api/alerts?status=all")).StatusCode);
        Assert.NotEqual(HttpStatusCode.Created, (await tecnico.PostAsJsonAsync("/api/people", new { clientId = ocultoId, name = "Fora do escopo", active = true })).StatusCode);

        // Cliente criado por quem e restrito entra no proprio escopo; o nome de um cliente oculto continua reservado.
        Assert.Equal(HttpStatusCode.Conflict, (await tecnico.PostAsJsonAsync("/api/clients", new { name = "Escopo oculto", siteName = "Matriz" })).StatusCode);
        var novo = await (await tecnico.PostAsJsonAsync("/api/clients", new { name = "Escopo novo", siteName = "Matriz" })).Content.ReadFromJsonAsync<ClientBody>();
        var depois = (await tecnico.GetFromJsonAsync<JsonElement>("/api/clients")).EnumerateArray().Select(c => c.GetProperty("id").GetInt32()).ToList();
        Assert.Equal(new[] { visivelId, novo!.Id }.Order(), depois.Order());

        // Liberar todos os clientes desfaz a restricao na hora.
        var userId = dto.GetProperty("id").GetGuid();
        var updated = await admin.PutAsJsonAsync($"/api/users/{userId}", new
        {
            email = "tecnico.escopo@exemplo.com", fullName = "Tecnico Escopo", roleIds = new[] { roleId }, isActive = true, allClients = true, clientIds = Array.Empty<int>(),
        });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tecnico.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);
    }
}
