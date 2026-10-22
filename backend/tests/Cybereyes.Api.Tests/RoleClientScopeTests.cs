using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static async Task<Guid> NewRoleAsync(HttpClient admin, string name, string[] permissions, int[]? clientIds = null)
    {
        var created = await admin.PostAsJsonAsync("/api/roles", new
        {
            name, isSuperuser = false, permissions, allClients = clientIds is null, clientIds = clientIds ?? [],
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
    }

    private static async Task<List<int>> VisibleClientsAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement>("/api/clients")).EnumerateArray().Select(c => c.GetProperty("id").GetInt32()).Order().ToList();

    private static async Task<JsonElement> RoleAsync(HttpClient client, Guid roleId) =>
        (await client.GetFromJsonAsync<JsonElement>("/api/roles")).EnumerateArray().Single(r => r.GetProperty("id").GetGuid() == roleId);

    private static List<int> RoleClientIds(JsonElement role) =>
        role.GetProperty("clients").EnumerateArray().Select(c => c.GetProperty("id").GetInt32()).Order().ToList();

    [Fact]
    public async Task RestrictedRole_LimitsItsUsersToTheRoleClients()
    {
        var (admin, visivelPk, _, _, visivelId, _) = await RegisteredAgentAsync("Papel escopo visivel");
        var (_, ocultoPk, _, _, ocultoId, _) = await RegisteredAgentAsync("Papel escopo oculto");
        var permissions = new[] { "clients.view", "clients.manage", "agents.view", "tickets.view", "tickets.manage" };

        object RoleBody(bool? allClients, int[]? clientIds) => new { name = "Tecnico do papel", isSuperuser = false, permissions, allClients, clientIds };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/roles", RoleBody(false, []))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/roles", RoleBody(false, [int.MaxValue]))).StatusCode);
        var roleId = await NewRoleAsync(admin, "Tecnico do papel", permissions, [visivelId]);
        var role = await RoleAsync(admin, roleId);
        Assert.False(role.GetProperty("allClients").GetBoolean());
        Assert.Equal([visivelId], RoleClientIds(role));

        // Salvar o papel sem mexer nos clientes mantem a restricao.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/roles/{roleId}", RoleBody(null, null))).StatusCode);
        Assert.Equal([visivelId], RoleClientIds(await RoleAsync(admin, roleId)));

        var userId = await fixture.CreateUserAsync(admin, "tecnico.papel", "senha-do-tecnico-2", roleId);
        var user = await admin.GetFromJsonAsync<JsonElement>($"/api/users/{userId}");
        Assert.True(user.GetProperty("allClients").GetBoolean());
        Assert.True(user.GetProperty("rolesRestrictClients").GetBoolean());

        var tecnico = await fixture.SignedInClientAsync("tecnico.papel", "senha-do-tecnico-2");
        Assert.Equal([visivelId], await VisibleClientsAsync(tecnico));
        Assert.Equal(HttpStatusCode.OK, (await tecnico.GetAsync($"/api/agents/{visivelPk}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tecnico.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);

        // Cliente criado por quem o papel restringe entra no papel, e a auditoria diz isso.
        var novo = await (await tecnico.PostAsJsonAsync("/api/clients", new { name = "Papel escopo novo", siteName = "Matriz" })).Content.ReadFromJsonAsync<ClientBody>();
        Assert.Equal(new[] { visivelId, novo!.Id }.Order(), await VisibleClientsAsync(tecnico));
        Assert.Equal(new[] { visivelId, novo.Id }.Order(), RoleClientIds(await RoleAsync(admin, roleId)));
        Assert.Contains("Cliente Papel escopo novo criado e liberado nos papeis Tecnico do papel", await admin.GetStringAsync("/api/audit?pageSize=200"),
            StringComparison.Ordinal);

        // Usuario e papel restritos: vale o que os dois liberam.
        object UserBody(Guid[] roleIds, bool allClients, int[] clientIds) => new
        {
            email = "tecnico.papel@exemplo.com", fullName = "Usuario tecnico.papel", roleIds, isActive = true, allClients, clientIds,
        };
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/users/{userId}", UserBody([roleId], false, [ocultoId, novo.Id]))).StatusCode);
        Assert.Equal([novo.Id], await VisibleClientsAsync(tecnico));

        // Os papeis se somam: com um papel sem restricao, sobra so a restricao do usuario.
        var livreId = await NewRoleAsync(admin, "Leitor sem restricao", ["clients.view"]);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/users/{userId}", UserBody([roleId, livreId], false, [ocultoId, novo.Id]))).StatusCode);
        Assert.Equal(new[] { ocultoId, novo.Id }.Order(), await VisibleClientsAsync(tecnico));
        Assert.False((await admin.GetFromJsonAsync<JsonElement>($"/api/users/{userId}")).GetProperty("rolesRestrictClients").GetBoolean());

        // Liberar todos no papel desfaz a restricao dele na hora.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/users/{userId}", UserBody([roleId], true, []))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tecnico.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/roles/{roleId}", RoleBody(true, []))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tecnico.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);
        Assert.Empty(RoleClientIds(await RoleAsync(admin, roleId)));
    }

    [Fact]
    public async Task RestrictedEditor_CannotReleaseOtherClientsThroughRoles()
    {
        var (admin, _, _, _, visivelId, _) = await RegisteredAgentAsync("Gestor escopo visivel");
        var (_, ocultoPk, _, _, ocultoId, _) = await RegisteredAgentAsync("Gestor escopo oculto");
        var gestorRole = await NewRoleAsync(admin, "Gestor restrito", ["users.view", "users.manage", "roles.manage", "clients.view", "agents.view"], [visivelId]);
        var restritoRole = await NewRoleAsync(admin, "Tecnico restrito ao visivel", ["clients.view", "agents.view"], [visivelId]);
        var livreRole = await NewRoleAsync(admin, "Tecnico sem restricao de cliente", ["clients.view", "agents.view"]);
        var adminRole = (await admin.GetFromJsonAsync<JsonElement>("/api/roles")).EnumerateArray()
            .Single(r => r.GetProperty("isSuperuser").GetBoolean() && r.GetProperty("name").GetString() == "Administrador").GetProperty("id").GetGuid();
        await fixture.CreateUserAsync(admin, "gestor.restrito", "senha-do-gestor-1", gestorRole);
        var alvo = await fixture.CreateUserAsync(admin, "alvo.restrito", "senha-do-alvo-1", restritoRole);
        var gestor = await fixture.SignedInClientAsync("gestor.restrito", "senha-do-gestor-1");

        object Alvo(params Guid[] roleIds) => new { email = "alvo.restrito@exemplo.com", fullName = "Alvo", roleIds, isActive = true };
        Assert.Equal(HttpStatusCode.OK, (await gestor.PutAsJsonAsync($"/api/users/{alvo}", Alvo(restritoRole))).StatusCode);
        // O papel sem restricao, ou o de superusuario, liberaria ao alvo o cliente que o gestor nao ve.
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PutAsJsonAsync($"/api/users/{alvo}", Alvo(livreRole))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PutAsJsonAsync($"/api/users/{alvo}", Alvo(restritoRole, adminRole))).StatusCode);

        object NovoUsuario(string username, Guid roleId) => new
        {
            username, email = $"{username}@exemplo.com", fullName = username, password = "senha-do-novo-1", roleIds = new[] { roleId },
            allClients = false, clientIds = new[] { visivelId },
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PostAsJsonAsync("/api/users", NovoUsuario("novo.superusuario", adminRole))).StatusCode);
        // Com a restricao no proprio usuario, o papel sem restricao nao libera nada alem do que o gestor ve.
        Assert.Equal(HttpStatusCode.Created, (await gestor.PostAsJsonAsync("/api/users", NovoUsuario("novo.limitado", livreRole))).StatusCode);

        // Nos papeis, o gestor so repassa os clientes que ve e nao cria superusuario.
        Assert.Equal([visivelId], (await gestor.GetFromJsonAsync<JsonElement>("/api/roles/client-options")).EnumerateArray()
            .Select(c => c.GetProperty("id").GetInt32()).ToList());
        object Papel(bool isSuperuser, bool? allClients, int[]? clientIds) => new
        {
            name = "Tecnico restrito ao visivel", isSuperuser, permissions = new[] { "clients.view", "agents.view" }, allClients, clientIds,
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PutAsJsonAsync($"/api/roles/{restritoRole}", Papel(false, true, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PutAsJsonAsync($"/api/roles/{restritoRole}", Papel(false, false, [ocultoId]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PutAsJsonAsync($"/api/roles/{restritoRole}", Papel(true, null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PostAsJsonAsync("/api/roles", new { name = "Super do gestor", isSuperuser = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await gestor.PostAsJsonAsync("/api/roles", new { name = "Livre do gestor", isSuperuser = false })).StatusCode);

        // O cliente que o gestor nao ve continua no papel quando ele o edita, e nem aparece para ele.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/roles/{restritoRole}", Papel(false, false, [visivelId, ocultoId]))).StatusCode);
        Assert.Equal([visivelId], RoleClientIds(await RoleAsync(gestor, restritoRole)));
        Assert.Equal(HttpStatusCode.OK, (await gestor.PutAsJsonAsync($"/api/roles/{restritoRole}", Papel(false, false, [visivelId]))).StatusCode);
        Assert.Equal(new[] { visivelId, ocultoId }.Order(), RoleClientIds(await RoleAsync(admin, restritoRole)));
        var alvoClient = await fixture.SignedInClientAsync("alvo.restrito", "senha-do-alvo-1");
        Assert.Equal(HttpStatusCode.OK, (await alvoClient.GetAsync($"/api/agents/{ocultoPk}")).StatusCode);
    }

    [Fact]
    public async Task TicketRotation_SkipsTechniciansWhoseRoleHidesTheClient()
    {
        var (admin, pk, _, _, _, _) = await RegisteredAgentAsync("Cliente rodizio papel");
        var (_, _, _, _, otherClientId, _) = await RegisteredAgentAsync("Cliente rodizio papel outro");
        var queue = (await (await admin.PostAsJsonAsync("/api/ticket-queues", new { name = "Fila rodizio papel", isDefault = false }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var roleId = await NewRoleAsync(admin, "Tecnico rodizio do outro cliente", ["tickets.view", "tickets.manage"], [otherClientId]);
        var dora = await TechnicianAsync(admin, roleId, "dora.rodizio");
        try
        {
            Assert.Equal(HttpStatusCode.OK,
                (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, new { userId = dora, active = true, queueIds = new[] { queue } }))).StatusCode);
            Assert.Null(Assignee(await NewTicketAsync(admin, new { title = "Rodizio papel cliente oculto", agentId = pk, queueId = queue })));
            Assert.Equal(dora, Assignee(await NewTicketAsync(admin, new { title = "Rodizio papel sem maquina", queueId = queue })));
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true));
        }
    }
}
