using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Remote;

public sealed record CreateRemoteSessionRequest(string[]? Channels, bool ViewOnly, int? TicketId);

public sealed record RemoteSessionDto(
    string SessionId, int AgentId, string Hostname, string User, string[] Channels, bool ViewOnly, string State, string Consent,
    DateTimeOffset StartedAt, DateTimeOffset? EndedAt, string? EndReason, string? RelayUrl, string? ViewerToken, DateTimeOffset? ExpiresAt,
    int? TicketId, DateTimeOffset? FirstFrameAt, long BytesToViewer, long BytesToAgent, int ClipboardToRemote, int ClipboardToLocal,
    RemoteRdpAccessDto? Rdp = null);

/// <summary>
/// Credencial temporaria do RDP do GNOME (canal rdp): so vai na resposta da criacao, ao tecnico da sessao. Clipboard diz
/// se o visualizador liga a area de transferencia do RDP (politica nos dois sentidos e sessao com controle).
/// </summary>
public sealed record RemoteRdpAccessDto(string Destination, string Username, string Password, string? User, bool Clipboard);

public sealed record RemotePolicyDto(
    string Scope, int ScopeId, [property: AllowedValues(null, RemoteConsent.None, RemoteConsent.Notify, RemoteConsent.Ask)] string? Consent,
    [property: Range(10, 600)] int? ConsentTimeoutSeconds, bool? AllowAtLoginScreen, bool? ClipboardToRemote, bool? ClipboardToLocal,
    bool? FilesUpload, bool? FilesDownload, [property: Range(1, 102400)] int? MaxFileMb, [property: Range(1, 1440)] int? IdleMinutes,
    [property: Range(1, 24)] int? MaxHours, DateTimeOffset? UpdatedAt, string? UpdatedBy);

/// <summary>Codigos de erro do acesso remoto (contrato, secao 2.3).</summary>
public static class RemoteErrors
{
    public const string Disabled = "REMOTE_DISABLED";
    public const string AgentOffline = "AGENT_OFFLINE";
    public const string Unsupported = "REMOTE_UNSUPPORTED";
    public const string Wayland = "REMOTE_WAYLAND";
    public const string SessionLimit = "SESSION_LIMIT";
    public const string NoInteractiveSession = "NO_INTERACTIVE_SESSION";
    public const string AgentError = "AGENT_ERROR";
    public const string SessionEnded = "SESSION_ENDED";
    public const string FileExists = "FILE_EXISTS";
    public const string FileTooLarge = "FILE_TOO_LARGE";
    public const string InvalidPath = "INVALID_PATH";
}

public static class RemoteAccess
{
    /// <summary>Permissoes efetivas (superusuario recebe todas) dos usuarios ativos da lista.</summary>
    public static async Task<Dictionary<Guid, HashSet<string>>> UsersWithPermissionsAsync(CybereyesDbContext db, IReadOnlyCollection<Guid> userIds, CancellationToken ct)
    {
        var rows = await (
            from u in db.Users.AsNoTracking()
            where userIds.Contains(u.Id) && u.IsActive
            join ur in db.UserRoles.AsNoTracking() on u.Id equals ur.UserId
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            select new { u.Id, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        return rows.GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.Any(r => r.IsSuperuser)
            ? Permissions.Catalog.Select(p => p.Key).ToHashSet(StringComparer.Ordinal)
            : g.SelectMany(r => r.Permissions).ToHashSet(StringComparer.Ordinal));
    }
}

public static class RemoteEndpoints
{
    public static void MapRemoteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/agents/{id:int}/remote/sessions", CreateAsync).WithTags("Acesso remoto");
        app.MapGet("/api/remote/sessions", ListAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        app.MapGet("/api/remote/sessions/{sessionId}", GetAsync).WithTags("Acesso remoto");
        app.MapGet("/api/remote/transfers", ListTransfersAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        app.MapDelete("/api/remote/sessions/{sessionId}", DeleteAsync).WithTags("Acesso remoto").AddEndpointFilter(RemoteForwarder.Filter);
        app.MapGet("/api/remote/policies", ListPoliciesAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.SettingsManage));
        app.MapPut("/api/remote/policies/{scope}/{scopeId:int?}", SavePolicyAsync).WithTags("Acesso remoto")
            .RequireAuthorization(Policies.Permission(Permissions.SettingsManage));
        app.MapDelete("/api/remote/policies/{scope}/{scopeId:int}", DeletePolicyAsync).WithTags("Acesso remoto")
            .RequireAuthorization(Policies.Permission(Permissions.SettingsManage));
        app.Map("/api/remote/relay/{sessionId}/{channel}", (HttpContext ctx, string sessionId, string channel, RemoteRelay relay) =>
            relay.HandleAsync(ctx, sessionId, channel)).AllowAnonymous().ExcludeFromDescription();
        RemoteFileEndpoints.MapRemoteFileEndpoints(app);
        app.MapWakeEndpoint();
    }

    private static IResult Error(int status, string title, string code) => Problems.Create(status, title, code);

    private static async Task<IResult> CreateAsync(int id, CreateRemoteSessionRequest request, ClaimsPrincipal principal, HttpContext ctx,
        IConfiguration config, CybereyesDbContext db, RemoteSessionManager manager, IAgentRpc rpc, IAuditService audit, TimeProvider time,
        CancellationToken ct)
    {
        var settings = manager.Settings;
        if (!settings.Enabled)
        {
            return Error(StatusCodes.Status503ServiceUnavailable, "Acesso remoto desligado no servidor", RemoteErrors.Disabled);
        }
        var channels = (request.Channels is { Length: > 0 } c ? c : [RemoteFrames.Desktop]).Distinct(StringComparer.Ordinal).ToArray();
        if (channels.Any(ch => ch is not (RemoteFrames.Desktop or RemoteFrames.Files or RemoteFrames.Rdp)) || channels.Count(RemoteFrames.IsScreen) > 1)
        {
            return Problems.Validation("channels", "Canais validos: desktop ou rdp, e files");
        }
        var wantsDesktop = channels.Any(RemoteFrames.IsScreen);
        var wantsRdp = channels.Contains(RemoteFrames.Rdp);
        var wantsFiles = channels.Contains(RemoteFrames.Files);
        if ((wantsDesktop && !principal.HasPermission(Permissions.AgentsRemote)) || (wantsFiles && !principal.HasPermission(Permissions.AgentsFiles)))
        {
            return Problems.Forbidden("Sem permissao para este acesso");
        }
        var userId = principal.UserId()!.Value;
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id)
            .Select(a => new { a.Id, a.AgentId, a.Hostname, a.SiteId, a.Status, a.Version, a.Plat }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (!Version.TryParse(agent.Version, out var version) || !Version.TryParse(settings.MinimumAgentVersion, out var minimum) || version < minimum)
        {
            return Error(StatusCodes.Status409Conflict, $"O EYES desta maquina precisa ser atualizado para {settings.MinimumAgentVersion} ou mais", RemoteErrors.Unsupported);
        }
        if (agent.Status != AgentStatus.Online)
        {
            return Error(StatusCodes.Status409Conflict, "Agente desconectado", RemoteErrors.AgentOffline);
        }
        if (wantsRdp && agent.Plat != "linux")
        {
            return Error(StatusCodes.Status409Conflict, "O RDP do GNOME so existe em maquinas Linux", RemoteErrors.Unsupported);
        }
        var policy = await RemotePolicies.ForSiteAsync(db, agent.SiteId, ct);
        if (wantsFiles && !policy.FilesUpload && !policy.FilesDownload)
        {
            return Problems.Forbidden("A politica deste site nao permite transferencia de arquivos");
        }
        if (request.TicketId is { } ticketId && !await db.Tickets.AnyAsync(t => t.Id == ticketId, ct))
        {
            return Problems.Validation("ticketId", "Chamado nao encontrado");
        }
        var open = await db.RemoteSessions.AsNoTracking().Where(s => s.State != RemoteSessionState.Ended && (s.AgentId == id || s.UserId == userId))
            .Select(s => new { s.AgentId, s.UserId, s.Channels }).ToListAsync(ct);
        var agentOpen = open.Where(s => s.AgentId == id).ToList();
        // Varias sessoes de tela na mesma estacao sao permitidas; o RDP do GNOME tem uma credencial so e e exclusivo.
        var rdpOpen = agentOpen.Any(s => s.Channels.Split(',').Contains(RemoteFrames.Rdp));
        var limit = agentOpen.Count >= settings.MaxSessionsPerAgent
                ? $"Esta maquina ja tem {agentOpen.Count} acessos remotos abertos (limite de {settings.MaxSessionsPerAgent})"
            : wantsRdp && agentOpen.Any(s => s.Channels.Split(',').Any(RemoteFrames.IsScreen)) || wantsDesktop && rdpOpen
                ? "O acesso pelo RDP do GNOME nesta maquina ja esta em uso por outro tecnico"
            : open.Count(s => s.UserId == userId) >= settings.MaxSessionsPerUser
                ? $"Voce ja tem {settings.MaxSessionsPerUser} acessos remotos abertos; encerre um para abrir outro"
            : !manager.AllowCreate(userId)
                ? "Muitos acessos abertos no ultimo minuto; aguarde um pouco"
            : null;
        if (limit is not null)
        {
            return Error(StatusCodes.Status409Conflict, limit, RemoteErrors.SessionLimit);
        }

        var now = time.GetUtcNow();
        var viewerToken = RemoteTokens.New();
        var agentToken = RemoteTokens.New();
        var username = principal.Identity?.Name ?? "?";
        var handle = new RemoteSessionHandle
        {
            SessionId = RemoteTokens.NewSessionId(),
            AgentPk = agent.Id,
            AgentId = agent.AgentId,
            Hostname = agent.Hostname,
            UserId = userId,
            Username = username,
            Channels = channels,
            ViewOnly = request.ViewOnly,
            Policy = policy,
            TicketId = request.TicketId,
            ViewerTokenHash = RemoteTokens.Hash(viewerToken),
            AgentTokenHash = RemoteTokens.Hash(agentToken),
            HopKey = RemoteTokens.New(),
            CreatedAt = now,
            // O rdp_enable pode levar ate 85 s antes do remote_start (reinicio do gnome-remote-desktop).
            ConnectDeadline = now.AddSeconds(settings.ConnectSeconds + (wantsRdp ? 85 : 0)),
        };
        db.RemoteSessions.Add(new RemoteSession
        {
            SessionId = handle.SessionId,
            AgentId = agent.Id,
            UserId = userId,
            Username = username,
            TicketId = request.TicketId,
            Channels = string.Join(',', channels),
            ViewOnly = request.ViewOnly,
            ConsentMode = policy.Consent,
            StartedAt = now,
            ViewerIp = ctx.Connection.RemoteIpAddress?.ToString(),
        });
        await db.SaveChangesAsync(ct);
        await manager.RegisterAsync(handle);
        await audit.LogAsync("remote.session-start", "agent", agent.Id.ToString(CultureInfo.InvariantCulture),
            $"Acesso remoto a {agent.Hostname} ({string.Join(", ", channels)}{(request.ViewOnly ? ", somente visualizacao" : string.Empty)})", cancellationToken: ct);

        var publicUrl = InstallerEndpoints.PublicUrl(ctx, config);
        var relayUrl = publicUrl.Replace("https://", "wss://", StringComparison.Ordinal).Replace("http://", "ws://", StringComparison.Ordinal)
            + "/api/remote/relay/" + handle.SessionId;
        var technician = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        RemoteRdpAccessDto? rdp = null;
        var payload = new Dictionary<string, string>
        {
            ["session_id"] = handle.SessionId,
            ["relay_url"] = relayUrl,
            ["token"] = agentToken,
            ["channels"] = string.Join(',', channels),
            ["view_only"] = request.ViewOnly ? "true" : "false",
            ["policy"] = policy.ToAgentJson(),
            ["technician"] = string.IsNullOrWhiteSpace(technician) ? username : technician,
        };
        string reply;
        try
        {
            if (wantsRdp)
            {
                // Liga o RDP do GNOME na sessao do usuario (credencial nova a cada vez); o EYES desliga no fim da sessao.
                var enabled = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
                {
                    ["func"] = "rdp_enable",
                    ["payload"] = new Dictionary<string, string> { ["view_only"] = request.ViewOnly ? "true" : "false" },
                }, TimeSpan.FromSeconds(85), ct);
                if (enabled is not IReadOnlyDictionary<string, object?> access || access.GetString("password") is not { Length: > 0 } password
                    || access.GetNumber("port") is not { } port)
                {
                    await manager.EndAsync(handle, "agent-refused", notifyAgent: false);
                    var why = enabled as string ?? "resposta invalida";
                    return Error(StatusCodes.Status502BadGateway, "O RDP do GNOME nao foi ativado: " + (why.StartsWith("error: ", StringComparison.Ordinal) ? why[7..] : why),
                        RemoteErrors.AgentError);
                }
                payload["rdp_port"] = ((int)port).ToString(CultureInfo.InvariantCulture);
                rdp = new RemoteRdpAccessDto(agent.Hostname, access.GetString("username") ?? "eyes", password, access.GetString("user"),
                    policy.ClipboardToRemote && policy.ClipboardToLocal && !request.ViewOnly);
            }
            var answer = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "remote_start", ["payload"] = payload },
                TimeSpan.FromSeconds(15), ct);
            reply = answer as string ?? "error: resposta invalida";
        }
        catch (AgentRpcTimeoutException)
        {
            await manager.EndAsync(handle, "agent-timeout", notifyAgent: false);
            await DisableRdpAsync(rpc, agent.AgentId, rdp);
            return Problems.AgentTimeout();
        }
        if (reply != "ok")
        {
            var reason = reply.StartsWith("error: ", StringComparison.Ordinal) ? reply[7..] : reply;
            await manager.EndAsync(handle, "agent-refused", notifyAgent: false);
            await DisableRdpAsync(rpc, agent.AgentId, rdp);
            return reason switch
            {
                "wayland" => Error(StatusCodes.Status409Conflict, "Sessao Wayland: a tela desta maquina vai pelo RDP do GNOME", RemoteErrors.Wayland),
                "unsupported" => Error(StatusCodes.Status409Conflict, "Esta maquina nao tem acesso remoto suportado", RemoteErrors.Unsupported),
                "busy" => Error(StatusCodes.Status409Conflict, "Limite de sessoes no agente", RemoteErrors.SessionLimit),
                "no session" => Error(StatusCodes.Status409Conflict, "Nao ha usuario conectado na maquina", RemoteErrors.NoInteractiveSession),
                "policy" => Problems.Forbidden("A politica do agente nao permite este acesso"),
                _ => Error(StatusCodes.Status502BadGateway, "O agente recusou o acesso: " + reason, RemoteErrors.AgentError),
            };
        }
        return TypedResults.Created($"/api/remote/sessions/{handle.SessionId}", new RemoteSessionDto(
            handle.SessionId, agent.Id, agent.Hostname, username, channels, request.ViewOnly, handle.State, policy.Consent, now, null, null,
            relayUrl, viewerToken, handle.ConnectDeadline, request.TicketId, null, 0, 0, 0, 0, rdp));
    }

    /// <summary>Desliga o RDP do GNOME quando a sessao nao chegou a comecar no agente.</summary>
    private static async Task DisableRdpAsync(IAgentRpc rpc, string agentId, RemoteRdpAccessDto? rdp)
    {
        if (rdp is null)
        {
            return;
        }
        try
        {
            await rpc.PublishAsync(agentId, new Dictionary<string, object?> { ["func"] = "rdp_disable" });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // o agente desliga de novo no proximo rdp_enable; nada a fazer aqui
        }
    }

    private static IQueryable<RemoteSessionDto> Project(CybereyesDbContext db, IQueryable<RemoteSession> query) =>
        from s in query
        join a in db.Agents.AsNoTracking() on s.AgentId equals a.Id
        select new RemoteSessionDto(s.SessionId, s.AgentId, a.Hostname, s.Username, s.Channels.Split(',', StringSplitOptions.None), s.ViewOnly, s.State,
            s.ConsentMode, s.StartedAt, s.EndedAt, s.EndReason, null, null, null, s.TicketId, s.FirstFrameAt, s.BytesToViewer, s.BytesToAgent,
            s.ClipboardToRemote, s.ClipboardToLocal);

    private static async Task<IResult> GetAsync(string sessionId, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var dto = await Project(db, db.RemoteSessions.AsNoTracking().Where(s => s.SessionId == sessionId)).FirstOrDefaultAsync(ct);
        if (dto is null || (dto.User != principal.Identity?.Name && !principal.HasPermission(Permissions.SettingsManage)))
        {
            return Problems.NotFound("Sessao");
        }
        return TypedResults.Ok(dto);
    }

    private static async Task<IResult> DeleteAsync(string sessionId, ClaimsPrincipal principal, RemoteSessionManager manager, CybereyesDbContext db, CancellationToken ct)
    {
        if (!manager.TryGet(sessionId, out var handle))
        {
            var exists = await db.RemoteSessions.AnyAsync(s => s.SessionId == sessionId, ct);
            return exists ? TypedResults.NoContent() : Problems.NotFound("Sessao");
        }
        if (handle.UserId != principal.UserId() && !principal.HasPermission(Permissions.SettingsManage))
        {
            return Problems.NotFound("Sessao");
        }
        await manager.EndAsync(handle, "technician");
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ListAsync(int? agentId, int? ticketId, Guid? userId, bool? active, int? page, CybereyesDbContext db, CancellationToken ct)
    {
        var query = db.RemoteSessions.AsNoTracking();
        if (agentId is { } a)
        {
            query = query.Where(s => s.AgentId == a);
        }
        if (ticketId is { } t)
        {
            query = query.Where(s => s.TicketId == t);
        }
        if (userId is { } u)
        {
            query = query.Where(s => s.UserId == u);
        }
        if (active == true)
        {
            query = query.Where(s => s.State != RemoteSessionState.Ended);
        }
        var p = Math.Max(1, page ?? 1);
        var total = await query.CountAsync(ct);
        var items = await Project(db, query.OrderByDescending(s => s.StartedAt).Skip((p - 1) * 50).Take(50)).ToListAsync(ct);
        return TypedResults.Ok(new { items, total, page = p, pageSize = 50 });
    }

    /// <summary>Transferencias de arquivos (relatorio): sem conteudo, so caminho, tamanho, hash e situacao.</summary>
    private static async Task<IResult> ListTransfersAsync(int? agentId, string? sessionId, int? page, CybereyesDbContext db, CancellationToken ct)
    {
        var query = db.RemoteTransfers.AsNoTracking();
        if (agentId is { } a)
        {
            query = query.Where(t => t.AgentId == a);
        }
        if (!string.IsNullOrEmpty(sessionId))
        {
            query = query.Where(t => t.SessionId == sessionId);
        }
        var p = Math.Max(1, page ?? 1);
        var total = await query.CountAsync(ct);
        var items = await (from t in query.OrderByDescending(t => t.StartedAt).Skip((p - 1) * 50).Take(50)
                           join ag in db.Agents on t.AgentId equals ag.Id
                           select new
                           {
                               t.Id, t.SessionId, t.AgentId, ag.Hostname, t.Username, t.Direction, t.RemotePath, t.SizeBytes, t.Sha256,
                               t.StartedAt, t.FinishedAt, t.Status, t.Error,
                           }).ToListAsync(ct);
        return TypedResults.Ok(new { items, total, page = p, pageSize = 50 });
    }

    private static RemotePolicyDto ToDto(RemotePolicy p) => new(p.Scope, p.ScopeId, p.Consent, p.ConsentTimeoutSeconds, p.AllowAtLoginScreen,
        p.ClipboardToRemote, p.ClipboardToLocal, p.FilesUpload, p.FilesDownload, p.MaxFileMb, p.IdleMinutes, p.MaxHours, p.UpdatedAt, p.UpdatedBy);

    private static async Task<IResult> ListPoliciesAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var rows = await db.RemotePolicies.AsNoTracking().OrderBy(p => p.Scope).ThenBy(p => p.ScopeId).ToListAsync(ct);
        if (!rows.Any(r => r.Scope == RemotePolicyScope.Global))
        {
            rows.Insert(0, RemotePolicy.Defaults());
        }
        return TypedResults.Ok(rows.Select(ToDto));
    }

    private static async Task<IResult> SavePolicyAsync(string scope, int? scopeId, RemotePolicyDto body, ClaimsPrincipal principal, CybereyesDbContext db,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (!RemotePolicyScope.IsValid(scope))
        {
            return Problems.Validation("scope", "Escopo invalido");
        }
        var id = scope == RemotePolicyScope.Global ? 0 : scopeId ?? 0;
        if (scope != RemotePolicyScope.Global && !await (scope == RemotePolicyScope.Client ? db.Clients.AnyAsync(c => c.Id == id, ct) : db.Sites.AnyAsync(s => s.Id == id, ct)))
        {
            return Problems.NotFound(scope == RemotePolicyScope.Client ? "Cliente" : "Site");
        }
        var row = await db.RemotePolicies.FirstOrDefaultAsync(p => p.Scope == scope && p.ScopeId == id, ct);
        if (row is null)
        {
            row = scope == RemotePolicyScope.Global ? RemotePolicy.Defaults() : new RemotePolicy { Scope = scope, ScopeId = id };
            db.RemotePolicies.Add(row);
        }
        var global = scope == RemotePolicyScope.Global;
        var defaults = RemotePolicy.Defaults();
        row.Consent = body.Consent ?? (global ? defaults.Consent : null);
        row.ConsentTimeoutSeconds = body.ConsentTimeoutSeconds ?? (global ? defaults.ConsentTimeoutSeconds : null);
        row.AllowAtLoginScreen = body.AllowAtLoginScreen ?? (global ? defaults.AllowAtLoginScreen : null);
        row.ClipboardToRemote = body.ClipboardToRemote ?? (global ? defaults.ClipboardToRemote : null);
        row.ClipboardToLocal = body.ClipboardToLocal ?? (global ? defaults.ClipboardToLocal : null);
        row.FilesUpload = body.FilesUpload ?? (global ? defaults.FilesUpload : null);
        row.FilesDownload = body.FilesDownload ?? (global ? defaults.FilesDownload : null);
        row.MaxFileMb = body.MaxFileMb ?? (global ? defaults.MaxFileMb : null);
        row.IdleMinutes = body.IdleMinutes ?? (global ? defaults.IdleMinutes : null);
        row.MaxHours = body.MaxHours ?? (global ? defaults.MaxHours : null);
        row.UpdatedAt = time.GetUtcNow();
        row.UpdatedBy = principal.Identity?.Name;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("remote.policy-change", "remote-policy", $"{scope}:{id}",
            $"Politica de acesso remoto ({scope} {id}): aviso {row.Consent ?? "herdado"}, area de transferencia {row.ClipboardToRemote?.ToString() ?? "herdada"}/{row.ClipboardToLocal?.ToString() ?? "herdada"}, arquivos {row.FilesUpload?.ToString() ?? "herdado"}/{row.FilesDownload?.ToString() ?? "herdado"}",
            cancellationToken: ct);
        return TypedResults.Ok(ToDto(row));
    }

    private static async Task<IResult> DeletePolicyAsync(string scope, int scopeId, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (scope is not (RemotePolicyScope.Client or RemotePolicyScope.Site))
        {
            return Problems.Validation("scope", "So politicas de cliente ou site podem ser removidas");
        }
        var removed = await db.RemotePolicies.Where(p => p.Scope == scope && p.ScopeId == scopeId).ExecuteDeleteAsync(ct);
        if (removed == 0)
        {
            return Problems.NotFound("Politica");
        }
        await audit.LogAsync("remote.policy-change", "remote-policy", $"{scope}:{scopeId}", $"Politica de acesso remoto ({scope} {scopeId}) removida; volta a herdar",
            cancellationToken: ct);
        return TypedResults.NoContent();
    }
}
