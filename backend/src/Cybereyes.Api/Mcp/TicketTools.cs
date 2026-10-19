using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace Cybereyes.Api.Mcp;

/// <summary>Atendimento: fila, conversa, status, atribuicao, horas e resolucao dos chamados.</summary>
[McpServerToolType]
public sealed class TicketTools(PlatformApi api)
{
    [McpServerTool(Name = "list_tickets", Title = "Listar chamados", ReadOnly = true, OpenWorld = false)]
    [Description("Lista chamados, mais recentes primeiro. Use open=true para a fila de atendimento (novo, em atendimento, aguardando usuario).")]
    public Task<string> ListTickets(
        [Description("new, in_progress, waiting_user, resolved ou closed")] string? status = null,
        [Description("low, medium, high ou critical")] string? priority = null,
        [Description("request (solicitacao) ou incident (incidente)")] string? type = null,
        [Description("\"me\" (meus), \"unassigned\" (sem tecnico) ou o id de um usuario")] string? assigned = null,
        [Description("Somente chamados desta maquina")] int? agentId = null,
        [Description("Numero (#123), titulo, solicitante ou hostname")] string? search = null,
        [Description("true: somente chamados abertos")] bool? open = null,
        int page = 1,
        [Description("Ate 200")] int pageSize = 25,
        CancellationToken ct = default) =>
        api.GetAsync("/api/tickets", ct, ("status", status), ("priority", priority), ("type", type), ("assigned", assigned), ("agentId", agentId),
            ("search", search), ("open", open), ("page", page), ("pageSize", pageSize));

    [McpServerTool(Name = "get_ticket", Title = "Ver chamado", ReadOnly = true, OpenWorld = false)]
    [Description("Detalhe do chamado (solicitante, maquina, SLA, solucao) e a conversa completa, incluindo notas internas.")]
    public async Task<string> GetTicket(int ticketId, CancellationToken ct = default)
    {
        var detail = await api.GetAsync($"/api/tickets/{ticketId}", ct);
        var messages = await api.GetAsync($"/api/tickets/{ticketId}/messages", ct);
        return $"{{\"ticket\":{detail},\"messages\":{messages}}}";
    }

    [McpServerTool(Name = "create_ticket", Title = "Abrir chamado", OpenWorld = false)]
    [Description("Abre um chamado. Com agentId, o cliente e o site vem da maquina.")]
    public Task<string> CreateTicket(
        [Description("3 a 200 caracteres")] string title,
        string? description = null,
        [Description("request (padrao) ou incident")] string? type = null,
        [Description("low, medium (padrao), high ou critical")] string? priority = null,
        int? agentId = null,
        [Description("Nome de quem pediu; sem ele, o usuario da chave")] string? requesterName = null,
        string? requesterEmail = null,
        [Description("Fila; sem ela, a fila padrao (veja list_ticket_options)")] int? queueId = null,
        [Description("Tecnico atribuido (id de list_ticket_options)")] string? assignedToId = null,
        CancellationToken ct = default) =>
        api.PostAsync("/api/tickets", new { title, description, type, priority, agentId, requesterName, requesterEmail, queueId, assignedToId }, ct);

    [McpServerTool(Name = "update_ticket", Title = "Editar chamado", Idempotent = true, OpenWorld = false)]
    [Description("Altera titulo, descricao, tipo, prioridade (recalcula o SLA) ou fila. Campos omitidos ficam como estao.")]
    public Task<string> UpdateTicket(int ticketId, string? title = null, string? description = null,
        [Description("request ou incident")] string? type = null,
        [Description("low, medium, high ou critical")] string? priority = null,
        int? queueId = null, CancellationToken ct = default) =>
        api.PatchAsync($"/api/tickets/{ticketId}", new { title, description, type, priority, queueId }, ct);

    [McpServerTool(Name = "reply_ticket", Title = "Responder chamado", OpenWorld = false)]
    [Description("Escreve na conversa do chamado. internal=false: o usuario recebe no app de bandeja. internal=true: nota interna, so para os tecnicos (use para registrar diagnostico e o que foi feito).")]
    public Task<string> ReplyTicket(int ticketId, [Description("Texto, ate 20000 caracteres")] string body, bool @internal = false,
        CancellationToken ct = default) =>
        api.PostAsync($"/api/tickets/{ticketId}/messages", new { body, @internal }, ct);

    [McpServerTool(Name = "set_ticket_status", Title = "Mudar status do chamado", Idempotent = true, OpenWorld = false)]
    [Description("Muda o status. Para concluir o atendimento prefira resolve_ticket, que registra a solucao.")]
    public Task<string> SetTicketStatus(int ticketId,
        [Description("new, in_progress, waiting_user, resolved ou closed")] string status,
        [Description("Mensagem opcional ao usuario, publicada na conversa")] string? message = null,
        CancellationToken ct = default) =>
        api.PutAsync($"/api/tickets/{ticketId}/status", new { status, message }, ct);

    [McpServerTool(Name = "assign_ticket", Title = "Atribuir chamado", Idempotent = true, OpenWorld = false)]
    [Description("Atribui o chamado. \"me\" assume com o usuario da chave; \"none\" tira o tecnico; ou o id de list_ticket_options. Chamado novo passa para em atendimento.")]
    public async Task<string> AssignTicket(int ticketId, string userId, CancellationToken ct = default)
    {
        var target = userId.Trim();
        if (target.Equals("me", StringComparison.OrdinalIgnoreCase))
        {
            using var me = JsonDocument.Parse(await api.GetAsync("/api/auth/me", ct));
            target = me.RootElement.GetProperty("id").GetString();
        }
        else if (target.Length == 0 || target.Equals("none", StringComparison.OrdinalIgnoreCase))
        {
            target = null;
        }
        return await api.PutAsync($"/api/tickets/{ticketId}/assign", new { userId = target }, ct);
    }

    [McpServerTool(Name = "resolve_ticket", Title = "Resolver chamado", Idempotent = true, OpenWorld = false)]
    [Description("Resolve o chamado registrando o que foi feito: kind=solution (resolveu de vez) ou workaround (solucao de contorno). O texto vai para a conversa (para o usuario, ou nota interna com internal=true) e o status vira resolvido. Num chamado ja resolvido so corrige o texto; chamado fechado precisa ser reaberto antes.")]
    public Task<string> ResolveTicket(int ticketId,
        [Description("solution ou workaround")] string kind,
        [Description("O que resolveu ou como contornar, ate 20000 caracteres")] string resolution,
        bool @internal = false,
        CancellationToken ct = default) =>
        api.PostAsync($"/api/tickets/{ticketId}/resolve", new { kind, resolution, @internal }, ct);

    [McpServerTool(Name = "add_ticket_time", Title = "Apontar horas no chamado", OpenWorld = false)]
    [Description("Aponta tempo de trabalho no chamado, em nome do usuario da chave.")]
    public Task<string> AddTicketTime(int ticketId, [Description("1 a 1440")] int minutes, string? description = null,
        [Description("Data do trabalho (AAAA-MM-DD); padrao hoje")] string? workDate = null, CancellationToken ct = default) =>
        api.PostAsync($"/api/tickets/{ticketId}/time", new { minutes, description, workDate }, ct);

    [McpServerTool(Name = "list_ticket_options", Title = "Filas e tecnicos", ReadOnly = true, OpenWorld = false)]
    [Description("Filas de atendimento e tecnicos que podem receber chamados (ids para create_ticket, update_ticket e assign_ticket).")]
    public async Task<string> ListTicketOptions(CancellationToken ct = default)
    {
        var queues = await api.GetAsync("/api/ticket-queues", ct);
        var assignees = await api.GetAsync("/api/tickets/assignees", ct);
        return $"{{\"queues\":{queues},\"assignees\":{assignees}}}";
    }
}
