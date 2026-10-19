using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Client;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static async Task<JsonElement> McpAsync(HttpClient client, string method, object parameters)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/mcp")
        {
            Content = JsonContent.Create(new { jsonrpc = "2.0", id = 1, method, @params = parameters }),
        };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");
        using var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {body}");
        // A resposta pode vir como JSON ou como um evento SSE ("data: {...}").
        var json = response.Content.Headers.ContentType?.MediaType == "text/event-stream"
            ? body.Split('\n').Where(l => l.StartsWith("data:", StringComparison.Ordinal)).Select(l => l[5..].Trim()).Last(l => l.Length > 0)
            : body;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement.Clone();
        Assert.False(root.TryGetProperty("error", out var error), error.ToString());
        return root.GetProperty("result");
    }

    private static async Task<string> McpToolAsync(HttpClient client, string name, object arguments, bool expectError = false)
    {
        var result = await McpAsync(client, "tools/call", new { name, arguments });
        var text = result.GetProperty("content")[0].GetProperty("text").GetString()!;
        Assert.True((result.TryGetProperty("isError", out var isError) && isError.GetBoolean()) == expectError, text);
        return text;
    }

    /// <summary>Usuario proprio do agente de IA, com um papel restrito e a chave criada pelo administrador.</summary>
    private async Task<HttpClient> McpClientAsync(HttpClient admin, string username, params string[] permissions)
    {
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = $"Agente de IA {username}", isSuperuser = false, permissions });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        var userId = await fixture.CreateUserAsync(admin, username, $"senha-{username}-1", roleId);
        using var created = await admin.PostAsJsonAsync("/api/apikeys", new { name = "agente-ia", userId });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(username, body.GetProperty("username").GetString());
        var client = fixture.NewClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("key").GetString());
        return client;
    }

    [Fact]
    public async Task Mcp_RequiresKey_ListsTools_AndRunsTicketWorkflow()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente MCP", "linux", r => r.GetString("func") == "rawcmd" ? "Outlook fechado" : null);
        await using var _ = agent;
        using var mcp = await McpClientAsync(admin, "agente.ia", "tickets.view", "tickets.manage", "agents.view", "agents.run", "clients.view");

        using var anonymous = fixture.NewClient();
        using var noKey = await anonymous.PostAsJsonAsync("/api/mcp", new { jsonrpc = "2.0", id = 1, method = "tools/list" });
        Assert.Equal(HttpStatusCode.Unauthorized, noKey.StatusCode);

        var tools = (await McpAsync(mcp, "tools/list", new { })).GetProperty("tools").EnumerateArray().ToList();
        var names = tools.Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("resolve_ticket", names);
        Assert.Contains("api_get", names);
        var runCommand = tools.Single(t => t.GetProperty("name").GetString() == "run_command");
        Assert.True(runCommand.GetProperty("annotations").GetProperty("destructiveHint").GetBoolean());
        Assert.Contains("agentId", runCommand.GetProperty("inputSchema").GetProperty("required").EnumerateArray().Select(r => r.GetString()));

        var created = JsonDocument.Parse(await McpToolAsync(mcp, "create_ticket",
            new { title = "Outlook nao abre", description = "Trava na tela de carregamento", agentId = pk, requesterName = "Ana" })).RootElement;
        var ticketId = created.GetProperty("id").GetInt32();
        Assert.Equal("Ana", created.GetProperty("requesterName").GetString());

        var assigned = JsonDocument.Parse(await McpToolAsync(mcp, "assign_ticket", new { ticketId, userId = "me" })).RootElement;
        Assert.Equal("in_progress", assigned.GetProperty("status").GetString());

        var output = JsonDocument.Parse(await McpToolAsync(mcp, "run_command",
            new { agentId = pk, shell = "/bin/bash", command = "pgrep outlook || echo Outlook fechado" })).RootElement;
        Assert.Equal("Outlook fechado", output.GetProperty("output").GetString());

        await McpToolAsync(mcp, "reply_ticket", new { ticketId, body = "Processo travado encerrado", @internal = true });
        var resolved = JsonDocument.Parse(await McpToolAsync(mcp, "resolve_ticket",
            new { ticketId, kind = "workaround", resolution = "Abrir o Outlook pelo modo de seguranca ate a atualizacao" })).RootElement;
        Assert.Equal("resolved", resolved.GetProperty("status").GetString());
        Assert.Equal("workaround", resolved.GetProperty("resolutionKind").GetString());

        var full = JsonDocument.Parse(await McpToolAsync(mcp, "get_ticket", new { ticketId })).RootElement;
        Assert.Equal(pk, full.GetProperty("ticket").GetProperty("agentId").GetInt32());
        Assert.Contains(full.GetProperty("messages").EnumerateArray(),
            m => m.GetProperty("internal").GetBoolean() && m.GetProperty("body").GetString() == "Processo travado encerrado");

        // Erros da API e entradas recusadas voltam como resultado de erro da ferramenta, sem derrubar a conversa.
        Assert.Contains("HTTP 404", await McpToolAsync(mcp, "get_ticket", new { ticketId = 999999 }, expectError: true), StringComparison.Ordinal);
        await McpToolAsync(mcp, "api_get", new { path = "https://exemplo.com/api/tickets" }, expectError: true);
        await McpToolAsync(mcp, "get_agent_details", new { agentId = pk, section = "registry" }, expectError: true);
        var checks = await McpToolAsync(mcp, "api_get", new { path = $"/api/agents/{pk}/checks" });
        Assert.StartsWith("[", checks, StringComparison.Ordinal);
        // Sem alerts.manage no papel do agente: a rota recusa e a ferramenta devolve o 403.
        Assert.Contains("HTTP 403", await McpToolAsync(mcp, "alert_action", new { alertIds = new[] { 1 }, action = "resolve" }, expectError: true),
            StringComparison.Ordinal);

        // A acao fica na auditoria em nome do usuario do agente.
        var audit = await admin.GetFromJsonAsync<JsonElement>("/api/audit?action=ticket.resolve&pageSize=5");
        Assert.Contains(audit.GetProperty("items").EnumerateArray(),
            a => a.GetProperty("username").GetString() == "agente.ia" && a.GetProperty("message").GetString()!.Contains($"#{ticketId}", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Mcp_OfficialClient_InitializesListsAndCallsTools()
    {
        var admin = await fixture.AdminClientAsync();
        using var http = await McpClientAsync(admin, "agente.ia.sdk", "tickets.view", "clients.view");
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(http.BaseAddress!, "/api/mcp"), TransportMode = HttpTransportMode.StreamableHttp }, http);
        await using var client = await McpClient.CreateAsync(transport);

        Assert.Equal("cybereyes", client.ServerInfo.Name);
        Assert.Contains("resolve_ticket", client.ServerInstructions, StringComparison.Ordinal);
        var tools = await client.ListToolsAsync();
        Assert.Contains(tools, t => t.Name == "get_agent_details");
        var result = await client.CallToolAsync("list_tickets", new Dictionary<string, object?> { ["open"] = true, ["pageSize"] = 5 });
        Assert.NotEqual(true, result.IsError);
    }

    [Fact]
    public async Task ApiKey_ForAnotherUser_OnlySuperuser()
    {
        var admin = await fixture.AdminClientAsync();
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Gestor de chaves", isSuperuser = false, permissions = new[] { "apikeys.manage" } });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        await fixture.CreateUserAsync(admin, "gestor.chaves", "senha-gestor-chaves-1", roleId);
        var adminId = (await admin.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetString();
        using var gestor = await fixture.SignedInClientAsync("gestor.chaves", "senha-gestor-chaves-1");

        // Uma chave do administrador daria ao gestor as permissoes de superusuario.
        Assert.Equal(HttpStatusCode.Forbidden, (await gestor.PostAsJsonAsync("/api/apikeys", new { name = "escalada", userId = adminId })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await gestor.PostAsJsonAsync("/api/apikeys", new { name = "propria" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/apikeys", new { name = "fantasma", userId = Guid.NewGuid() })).StatusCode);
    }
}
