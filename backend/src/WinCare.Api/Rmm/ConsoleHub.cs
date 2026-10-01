using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Actions;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm;

[Authorize]
public sealed class ConsoleHub(TerminalSessions terminals, WinCareDbContext db, IAuditService audit) : Hub
{
    public async Task<string> StartTerminal(int agentPk, int cols, int rows, string? shell)
    {
        if (Context.User?.HasPermission(Permissions.AgentsRun) != true)
        {
            throw new HubException("Sem permissao para abrir terminal");
        }

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

    public Task JoinTicket(int ticketId) => Context.User?.HasPermission(Permissions.TicketsView) == true
        ? Groups.AddToGroupAsync(Context.ConnectionId, Tickets.TicketService.ConsoleGroup(ticketId))
        : throw new HubException("Sem permissao para ver chamados");

    public Task JoinWinCareRun(string runId) => Context.User?.HasPermission(Permissions.AgentsView) == true
        ? Groups.AddToGroupAsync(Context.ConnectionId, Maintenance.WinCareService.ConsoleGroup(runId))
        : throw new HubException("Sem permissao para ver agentes");

    public Task LeaveWinCareRun(string runId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Maintenance.WinCareService.ConsoleGroup(runId));

    public Task LeaveTicket(int ticketId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Tickets.TicketService.ConsoleGroup(ticketId));

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await terminals.StopAllAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
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
