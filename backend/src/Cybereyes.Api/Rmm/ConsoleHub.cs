using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

[Authorize]
public sealed class ConsoleHub(TerminalSessions terminals, CybereyesDbContext db, IAuditService audit) : Hub
{
    public async Task<string> StartTerminal(int agentPk, int cols, int rows, string? shell)
    {
        if (Context.User?.HasPermission(Permissions.AgentsRun) != true)
        {
            throw new HubException("Sem permissao para abrir terminal");
        }

        db.ApplyClientScope(Context.User);
        var agent = await AgentRef.FindAsync(db, agentPk, Context.ConnectionAborted) ?? throw new HubException("Agente nao encontrado");
        var allowed = agent.IsWindows ? CommandEndpoints.WindowsShells : CommandEndpoints.UnixShells;
        var selected = string.IsNullOrWhiteSpace(shell) ? (agent.IsWindows ? "cmd" : "/bin/bash") : shell;
        if (!allowed.Contains(selected))
        {
            throw new HubException($"Shell invalido: use {string.Join(", ", allowed)}");
        }

        var username = Context.User.Identity?.Name ?? "?";
        var sessionId = await terminals.StartAsync(Context.ConnectionId, username, agent.AgentId, selected, cols, rows);
        await audit.LogAsync("agent.terminal-opened", "agent", agent.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Terminal ({selected}) aberto em {agent.Hostname}", username, Context.ConnectionAborted);
        return sessionId;
    }

    public Task TerminalInput(string sessionId, string data) => terminals.InputAsync(Context.ConnectionId, sessionId, data);

    public Task ResizeTerminal(string sessionId, int cols, int rows) => terminals.ResizeAsync(Context.ConnectionId, sessionId, cols, rows);

    public Task StopTerminal(string sessionId) => terminals.StopAsync(Context.ConnectionId, sessionId);

    public async Task JoinTicket(int ticketId)
    {
        if (Context.User?.HasPermission(Permissions.TicketsView) != true)
        {
            throw new HubException("Sem permissao para ver chamados");
        }
        db.ApplyClientScope(Context.User);
        if (!await db.Tickets.AnyAsync(t => t.Id == ticketId, Context.ConnectionAborted))
        {
            throw new HubException("Chamado nao encontrado");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, Tickets.TicketService.ConsoleGroup(ticketId));
    }

    public async Task JoinCareRun(string runId)
    {
        if (Context.User?.HasPermission(Permissions.AgentsView) != true)
        {
            throw new HubException("Sem permissao para ver agentes");
        }
        db.ApplyClientScope(Context.User);
        if (!await db.CareRuns.AnyAsync(r => r.RunId == runId, Context.ConnectionAborted))
        {
            throw new HubException("Execucao nao encontrada");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, Maintenance.CareService.ConsoleGroup(runId));
    }

    public Task LeaveCareRun(string runId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Maintenance.CareService.ConsoleGroup(runId));

    public Task LeaveTicket(int ticketId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Tickets.TicketService.ConsoleGroup(ticketId));

    public override async Task OnConnectedAsync()
    {
        // Eventos com dados de um cliente vao so para quem ve todos ou para os grupos dos clientes liberados.
        if (Context.User?.VisibleClientIds() is { } clientIds)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ConsoleAudience.Restricted);
            foreach (var clientId in clientIds)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, ConsoleAudience.Client(clientId));
            }
        }
        else
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ConsoleAudience.AllClients);
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await terminals.StopAllAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}

/// <summary>Grupos do hub pelo escopo de clientes do usuario (definidos na conexao).</summary>
public static class ConsoleAudience
{
    public const string AllClients = "clients:all";
    public const string Restricted = "clients:restricted";

    public static string Client(int clientId) => "client:" + clientId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Conexoes que podem ver os dados do cliente.</summary>
    public static IClientProxy ForClient(this IHubClients clients, int clientId) => clients.Groups(AllClients, Client(clientId));
}

public interface IAgentNotifier
{
    Task StatusChangedAsync(string agentId, string status, DateTimeOffset? lastSeen, CancellationToken ct = default);

    Task AgentsChangedAsync(CancellationToken ct = default);
}

public sealed class AgentNotifier(IHubContext<ConsoleHub> hub) : IAgentNotifier
{
    public Task StatusChangedAsync(string agentId, string status, DateTimeOffset? lastSeen, CancellationToken ct = default) =>
        hub.Clients.All.SendAsync("agentStatusChanged", new { agentId, status, lastSeen }, ct);

    public Task AgentsChangedAsync(CancellationToken ct = default) => hub.Clients.All.SendAsync("agentsChanged", ct);
}
