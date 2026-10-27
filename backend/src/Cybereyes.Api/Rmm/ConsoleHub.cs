using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Apps;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

[Authorize]
public sealed class ConsoleHub(TerminalSessions terminals, SshTerminalSessions sshTerminals, CybereyesDbContext db, IAuditService audit, Vault vault,
    ProcedureLog procedures, TimeProvider time) : Hub
{
    private const int MaxSshTerminalsPerConnection = 8;

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
        // Concluido pelo TerminalSessions quando o terminal fecha (pelo tecnico, pelo agente ou pela conexao).
        await procedures.StartAsync(agent.Id, ProcedureKind.Terminal, selected, refType: ProcedureRef.Terminal, refId: sessionId,
            ct: Context.ConnectionAborted);
        return sessionId;
    }

    /// <summary>Terminal SSH num servidor do modulo Aplicacoes; com a aplicacao, abre na pasta dela.</summary>
    public async Task<string> StartSshTerminal(int serverId, int? webAppId, int cols, int rows)
    {
        if (Context.User?.HasPermission(Permissions.AppsRun) != true)
        {
            throw new HubException("Sem permissao para abrir terminal SSH");
        }
        if (!vault.Enabled)
        {
            throw new HubException("Cofre de credenciais sem chave configurada (VAULT_KEY)");
        }
        if (sshTerminals.CountFor(Context.ConnectionId) >= MaxSshTerminalsPerConnection)
        {
            throw new HubException($"Limite de {MaxSshTerminalsPerConnection} terminais SSH abertos por janela");
        }
        db.ApplyClientScope(Context.User);
        var server = await db.AppServers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == serverId, Context.ConnectionAborted)
            ?? throw new HubException("Servidor nao encontrado");
        string? directory = null;
        if (webAppId is { } appId)
        {
            var webApp = await db.WebApps.AsNoTracking().FirstOrDefaultAsync(w => w.Id == appId && w.ServerId == serverId, Context.ConnectionAborted)
                ?? throw new HubException("A aplicacao nao roda neste servidor");
            directory = webApp.DeployPath;
        }

        var username = Context.User.Identity?.Name ?? "?";
        try
        {
            var target = SshTarget.FromServer(server, vault);
            var (sessionId, session) = await sshTerminals.StartAsync(Context.ConnectionId, username, target, directory, cols, rows, Context.ConnectionAborted);
            await SshConnector.RecordConnectionAsync(db, server.Id, session, time, Context.ConnectionAborted);
            await audit.LogAsync("app-server.terminal-opened", "app-server", server.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                $"Terminal SSH aberto em {server.Name} ({server.Username}@{server.Host})", username, Context.ConnectionAborted);
            return sessionId;
        }
        catch (Exception ex) when (ex is SshFailureException or System.Security.Cryptography.CryptographicException)
        {
            throw new HubException(ex is SshFailureException ? ex.Message : "Nao foi possivel decifrar a credencial: a chave do cofre mudou?");
        }
    }

    public Task TerminalInput(string sessionId, string data)
    {
        if (sshTerminals.Owns(sessionId))
        {
            sshTerminals.Input(Context.ConnectionId, sessionId, data);
            return Task.CompletedTask;
        }
        return terminals.InputAsync(Context.ConnectionId, sessionId, data);
    }

    public Task ResizeTerminal(string sessionId, int cols, int rows)
    {
        if (sshTerminals.Owns(sessionId))
        {
            sshTerminals.Resize(Context.ConnectionId, sessionId, cols, rows);
            return Task.CompletedTask;
        }
        return terminals.ResizeAsync(Context.ConnectionId, sessionId, cols, rows);
    }

    public Task StopTerminal(string sessionId)
    {
        if (sshTerminals.Owns(sessionId))
        {
            sshTerminals.Stop(Context.ConnectionId, sessionId);
            return Task.CompletedTask;
        }
        return terminals.StopAsync(Context.ConnectionId, sessionId);
    }

    public async Task JoinAppRun(long runId)
    {
        if (Context.User?.HasPermission(Permissions.AppsView) != true)
        {
            throw new HubException("Sem permissao para ver aplicacoes");
        }
        db.ApplyClientScope(Context.User);
        if (!await db.AppRuns.AnyAsync(r => r.Id == runId, Context.ConnectionAborted))
        {
            throw new HubException("Execucao nao encontrada");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, AppRunner.Group(runId));
    }

    public Task LeaveAppRun(long runId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, AppRunner.Group(runId));

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

    /// <summary>Recebe ao vivo o teste de perifericos da maquina (o que o usuario digita e clica na tela de teste do app).</summary>
    public async Task JoinPeripheralTests(int agentPk)
    {
        if (Context.User?.HasPermission(Permissions.AgentsView) != true)
        {
            throw new HubException("Sem permissao para ver agentes");
        }
        db.ApplyClientScope(Context.User);
        if (!await db.Agents.AnyAsync(a => a.Id == agentPk, Context.ConnectionAborted))
        {
            throw new HubException("Agente nao encontrado");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, Peripherals.PeripheralTestEndpoints.ConsoleGroup(agentPk));
    }

    public Task LeavePeripheralTests(int agentPk) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, Peripherals.PeripheralTestEndpoints.ConsoleGroup(agentPk));

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
        sshTerminals.StopAll(Context.ConnectionId);
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
