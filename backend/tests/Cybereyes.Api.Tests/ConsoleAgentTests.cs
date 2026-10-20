using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static readonly string[] ReadOnlyAgent = ["clients.view", "agents.view", "alerts.view", "tickets.view", "logs.view", "scripts.view", "docs.view", "inventory.view"];

    private static object ConsoleSettings(string apiKey, string[] nativePermissions) => new
    {
        apiKey, model = "claude-opus-5-5", name = "Agente Teste", chatEnabled = false, logInsightsEnabled = false, logInsightsIntervalHours = 24,
        logInsightsMinLevel = "error", logInsightsPush = true, logInsightsEmail = false, nativeEnabled = true, nativePermissions,
    };

    private static async Task<JsonElement> WaitSessionAsync(HttpClient client, Guid id, string status)
    {
        JsonElement last = default;
        for (var i = 0; i < 100; i++)
        {
            last = await client.GetFromJsonAsync<JsonElement>($"/api/assistant/console/sessions/{id}");
            if (last.GetProperty("status").GetString() == status)
            {
                return last;
            }
            await Task.Delay(100);
        }
        Assert.Fail($"A conversa ficou em {last.GetProperty("status").GetString()} ({last.GetProperty("error")}) em vez de {status}");
        return last;
    }

    private static List<JsonElement> Entries(JsonElement session) => [.. session.GetProperty("entries").EnumerateArray()];

    [Fact]
    public async Task ConsoleAgent_ActsForTheTechnician_WithinTheAgentPermissions_AsksApproval_AndAuditsBoth()
    {
        using var admin = await fixture.AdminClientAsync();
        var role = await admin.PostAsJsonAsync("/api/roles", new
        {
            name = "Tecnico com agente", isSuperuser = false, permissions = new[] { "tickets.view", "tickets.manage", "agents.view", "agents.control", "assistant.use" },
        });
        await TechnicianAsync(admin, (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id, "tecnico.agente");
        using var tecnico = await fixture.SignedInClientAsync("tecnico.agente", "senha-do-tecnico-1");
        await fixture.CreateUserAsync(admin, "sem.agente", "senha-sem-agente-1");
        using var outro = await fixture.SignedInClientAsync("sem.agente", "senha-sem-agente-1");
        var ticketId = (await NewTicketAsync(admin, new { title = "Impressora do financeiro (agente)" })).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync("/api/assistant/settings", ConsoleSettings(AnthropicKey, ["tickets.view", "nao.existe"]))).StatusCode);
        // O agente pode responder chamados e mexer em maquinas, mas nao listar maquinas; o tecnico pode listar, nao rodar comandos.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/assistant/settings",
            ConsoleSettings(AnthropicKey, ["tickets.view", "tickets.manage", "agents.control", "agents.run"]))).StatusCode);
        try
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await outro.GetAsync("/api/assistant/console/executors")).StatusCode);
            var executors = await tecnico.GetFromJsonAsync<JsonElement>("/api/assistant/console/executors");
            var native = executors.EnumerateArray().Single(e => e.GetProperty("id").GetString() == "native");
            Assert.Equal("Agente Teste", native.GetProperty("name").GetString());
            Assert.Equal(["agents.control", "tickets.manage", "tickets.view"], native.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()));

            var calls = fixture.Assistant.Conversations.Count;
            fixture.Assistant.EnqueueTurn("Vou responder e ver as maquinas.",
                ("reply_ticket", new { ticketId, body = "Estamos verificando a impressora." }),
                ("list_agents", new { }));
            fixture.Assistant.EnqueueTurn("Para liberar a fila, preciso reiniciar o spooler.", ("service_action", new { agentId = 1, serviceName = "Spooler", action = "restart" }));
            fixture.Assistant.EnqueueTurn("Certo, nao reiniciei o servico.");

            var started = await tecnico.PostAsJsonAsync("/api/assistant/console/sessions", new { executor = "native", message = $"Responda o chamado #{ticketId}" });
            Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
            var id = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

            var waiting = await WaitSessionAsync(tecnico, id, "awaiting_approval");
            var actions = Entries(waiting).Where(e => e.GetProperty("kind").GetString() == "action").ToDictionary(e => e.GetProperty("tool").GetString()!);
            Assert.Equal("done", actions["reply_ticket"].GetProperty("status").GetString());
            Assert.Equal("error", actions["list_agents"].GetProperty("status").GetString());
            Assert.Contains("HTTP 403", actions["list_agents"].GetProperty("result").GetString(), StringComparison.Ordinal);
            Assert.Equal("pending", actions["service_action"].GetProperty("status").GetString());
            Assert.Equal(HttpStatusCode.Conflict, (await tecnico.PostAsJsonAsync($"/api/assistant/console/sessions/{id}/messages", new { message = "E agora?" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/assistant/console/sessions/{id}")).StatusCode);

            Assert.Equal(HttpStatusCode.Accepted, (await tecnico.PostAsJsonAsync($"/api/assistant/console/sessions/{id}/approval", new { approve = false })).StatusCode);
            var done = await WaitSessionAsync(tecnico, id, "idle");
            var entries = Entries(done);
            Assert.Equal("rejected", entries.Single(e => e.GetProperty("tool").ValueKind == JsonValueKind.String && e.GetProperty("tool").GetString() == "service_action")
                .GetProperty("status").GetString());
            Assert.Equal("Certo, nao reiniciei o servico.", entries[^1].GetProperty("text").GetString());

            // O modelo recebeu as ferramentas do MCP, as permissoes da execucao e o resultado da recusa.
            var first = fixture.Assistant.Conversations[calls];
            Assert.Contains(first.Tools, t => t.Name == "reply_ticket");
            Assert.Contains("<permissoes>agents.control, tickets.manage, tickets.view</permissoes>", first.System, StringComparison.Ordinal);
            var last = fixture.Assistant.Conversations[^1];
            Assert.Contains(last.Messages[^1].Content, b => b.Type == "tool_result" && b.Text == Cybereyes.Api.Assistant.ConsoleAgent.RejectedText);

            // Coautoria: a mensagem sai no nome do tecnico pelo agente, e a auditoria grava os dois.
            var messages = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/tickets/{ticketId}/messages");
            var reply = messages!.Single(m => m.GetProperty("body").GetString() == "Estamos verificando a impressora.");
            Assert.Equal("Tecnico tecnico.agente (pelo agente Agente Teste)", reply.GetProperty("authorName").GetString());
            var audit = await admin.GetFromJsonAsync<JsonElement>("/api/audit?username=tecnico.agente&pageSize=50");
            var items = audit.GetProperty("items").EnumerateArray().ToList();
            var replied = items.Single(a => a.GetProperty("action").GetString() == "ticket.reply");
            Assert.Equal("Agente Teste", replied.GetProperty("agent").GetString());
            Assert.Contains(items, a => a.GetProperty("action").GetString() == "assistant.request");
            Assert.Contains(items, a => a.GetProperty("action").GetString() == "assistant.rejected");

            // Aprovada, a acao roda de verdade: aqui a rota recusa a maquina inexistente e o agente relata o erro.
            fixture.Assistant.EnqueueTurn(null, ("service_action", new { agentId = int.MaxValue, serviceName = "Spooler", action = "restart" }));
            fixture.Assistant.EnqueueTurn("A maquina nao existe.");
            Assert.Equal(HttpStatusCode.Accepted,
                (await tecnico.PostAsJsonAsync($"/api/assistant/console/sessions/{id}/messages", new { message = "Pode reiniciar" })).StatusCode);
            await WaitSessionAsync(tecnico, id, "awaiting_approval");
            Assert.Equal(HttpStatusCode.Accepted, (await tecnico.PostAsJsonAsync($"/api/assistant/console/sessions/{id}/approval", new { approve = true })).StatusCode);
            var approved = Entries(await WaitSessionAsync(tecnico, id, "idle"))
                .Last(e => e.GetProperty("kind").GetString() == "action");
            Assert.Equal("error", approved.GetProperty("status").GetString());
            Assert.Contains("HTTP 404", approved.GetProperty("result").GetString(), StringComparison.Ordinal);
            Assert.Contains((await admin.GetFromJsonAsync<JsonElement>("/api/audit?username=tecnico.agente&pageSize=50")).GetProperty("items").EnumerateArray(),
                a => a.GetProperty("action").GetString() == "assistant.approved");

            var list = await tecnico.GetFromJsonAsync<JsonElement>("/api/assistant/console/sessions");
            Assert.Equal(id, list[0].GetProperty("id").GetGuid());
            Assert.Equal(HttpStatusCode.Forbidden, (await outro.GetAsync("/api/assistant/console/sessions")).StatusCode);
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/assistant/settings", ConsoleSettings(string.Empty, ReadOnlyAgent));
            fixture.Assistant.ClearReplies();
        }
    }
}
