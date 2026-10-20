using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static object Rotation(bool enabled, params object[] members) => new { enabled, members };

    private async Task<Guid> TechnicianAsync(HttpClient admin, Guid roleId, string username, int? onlyClientId = null)
    {
        var created = await admin.PostAsJsonAsync("/api/users", new
        {
            username, email = $"{username}@exemplo.com", fullName = $"Tecnico {username}", password = "senha-do-tecnico-1", roleIds = new[] { roleId },
            allClients = onlyClientId is null, clientIds = onlyClientId is { } id ? new[] { id } : Array.Empty<int>(),
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
    }

    private static async Task<JsonElement> NewTicketAsync(HttpClient admin, object body)
    {
        var created = await admin.PostAsJsonAsync("/api/tickets", body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return await created.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static Guid? Assignee(JsonElement ticket) =>
        ticket.GetProperty("assignedToId").ValueKind == JsonValueKind.Null ? null : ticket.GetProperty("assignedToId").GetGuid();

    [Fact]
    public async Task TicketRotation_AssignsNewTicketsInTurn_RespectingQueueClientAndPause()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente rodizio");
        var (_, _, _, _, otherClientId, _) = await RegisteredAgentAsync("Cliente rodizio outro");
        var queue = (await (await admin.PostAsJsonAsync("/api/ticket-queues", new { name = "Fila rodizio teste", isDefault = false }))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Tecnico rodizio", isSuperuser = false, permissions = new[] { "tickets.view", "tickets.manage" } });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        var ana = await TechnicianAsync(admin, roleId, "ana.rodizio");
        var bruno = await TechnicianAsync(admin, roleId, "bruno.rodizio");
        var carla = await TechnicianAsync(admin, roleId, "carla.rodizio", otherClientId);
        var semPermissao = await fixture.CreateUserAsync(admin, "visitante.rodizio", "senha-do-visitante-1");

        object Member(Guid userId, bool active = true) => new { userId, active, queueIds = new[] { queue } };

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, Member(semPermissao)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, Member(ana), Member(ana)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, new { userId = ana, active = true, queueIds = new[] { int.MaxValue } }))).StatusCode);
        try
        {
            var saved = await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, Member(ana), Member(bruno), Member(carla)));
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
            var rotation = await saved.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(new[] { ana, bruno, carla }, rotation.GetProperty("members").EnumerateArray().Select(m => m.GetProperty("userId").GetGuid()));
            Assert.Equal(ana, rotation.GetProperty("nextUserId").GetGuid());

            // Ana e Bruno se revezam; Carla so ve o outro cliente e fica de fora dos chamados deste.
            object OnQueue(string title) => new { title, agentId = pk, queueId = queue };
            var first = await NewTicketAsync(admin, OnQueue("Rodizio 1"));
            var second = await NewTicketAsync(admin, OnQueue("Rodizio 2"));
            var third = await NewTicketAsync(admin, OnQueue("Rodizio 3"));
            Assert.Equal([ana, bruno, ana], new[] { Assignee(first), Assignee(second), Assignee(third) });
            Assert.Equal("in_progress", first.GetProperty("status").GetString());
            var messages = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/tickets/{first.GetProperty("id").GetInt32()}/messages");
            // Quem assina e o agente: o nome do assistente nas configuracoes.
            Assert.Contains(messages!, m => m.GetProperty("body").GetString()!.EndsWith(" atribuiu o chamado a Tecnico ana.rodizio pelo rodizio da fila Fila rodizio teste", StringComparison.Ordinal));

            // Sem cliente, Carla pode atender, e ela nunca recebeu nenhum.
            Assert.Equal(carla, Assignee(await NewTicketAsync(admin, new { title = "Rodizio sem maquina", queueId = queue })));

            // Outra fila, ou tecnico escolhido por quem abriu, nao passam pelo rodizio.
            Assert.Null(Assignee(await NewTicketAsync(admin, new { title = "Rodizio outra fila", agentId = pk })));
            Assert.Equal(carla, Assignee(await NewTicketAsync(admin, new { title = "Rodizio escolhido", agentId = pk, queueId = queue, assignedToId = carla })));

            // Bruno pausado: a vez dele passa para a Ana.
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, Member(ana), Member(bruno, active: false), Member(carla)))).StatusCode);
            Assert.Equal(ana, Assignee(await NewTicketAsync(admin, OnQueue("Rodizio 4"))));

            var current = await admin.GetFromJsonAsync<JsonElement>("/api/ticket-rotation");
            var members = current.GetProperty("members").EnumerateArray().ToDictionary(m => m.GetProperty("userId").GetGuid());
            Assert.Equal(3, members[ana].GetProperty("openTickets").GetInt32());
            Assert.False(members[bruno].GetProperty("active").GetBoolean());
            Assert.Equal(1, members[bruno].GetProperty("openTickets").GetInt32());
            Assert.Equal(2, members[carla].GetProperty("openTickets").GetInt32());

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(false, Member(ana), Member(bruno), Member(carla)))).StatusCode);
            Assert.Null(Assignee(await NewTicketAsync(admin, OnQueue("Rodizio desligado"))));
            Assert.False((await admin.GetFromJsonAsync<JsonElement>("/api/ticket-rotation")).GetProperty("enabled").GetBoolean());
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true));
        }
    }

    [Fact]
    public async Task TrayAssistant_KeepsAttending_WhenTheRotationAssignedATechnician()
    {
        using var admin = await fixture.AdminClientAsync();
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Tecnico rodizio app", isSuperuser = false, permissions = new[] { "tickets.view", "tickets.manage" } });
        var tecnico = await TechnicianAsync(admin, (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id, "davi.rodizio");
        var (_, _, _, agent, _, _) = await RegisteredAgentAsync("Cliente rodizio app", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, "paula");

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true, new { userId = tecnico, active = true }))).StatusCode);
        try
        {
            await WithAssistantAsync(admin, chat: true, insights: false, async () =>
            {
                fixture.Assistant.Enqueue(new
                {
                    action = "ask_details", reply = "Olá, paula! Aparece alguma mensagem de erro?", faqId = (int?)null, title = "Sem acesso a pasta",
                    priority = "medium", summary = "Usuaria sem acesso a pasta compartilhada.",
                });
                var created = await tray.PostAsync("/api/tray/tickets", TrayTicket("Pasta", "Nao abro a pasta do financeiro"));
                Assert.Equal(HttpStatusCode.Created, created.StatusCode);
                var ticketId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

                var answered = await WaitTrayAsync(tray, ticketId, t => Messages(t).Any(m => m.GetProperty("authorType").GetString() == "assistant"));
                Assert.Contains(Messages(answered), m => m.GetProperty("body").GetString() == "Olá, paula! Aparece alguma mensagem de erro?");
                Assert.Equal("Tecnico davi.rodizio", answered.GetProperty("assignedToName").GetString());
                Assert.Equal(tecnico, Assignee(await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}")));
            });
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/ticket-rotation", Rotation(true));
        }
    }
}
