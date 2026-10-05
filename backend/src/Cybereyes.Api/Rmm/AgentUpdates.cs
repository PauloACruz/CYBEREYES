using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

public sealed record AgentUpdateRequest(int[]? AgentIds);

/// <summary>
/// Atualizacao remota do EYES: o servidor manda "agentupdate" com a versao e o SHA-256 do binario que ele
/// distribui; o agente baixa de /api/agent/download, confere, troca o executavel e reinicia o servico.
/// </summary>
public static partial class AgentUpdates
{
    public const string Func = "agentupdate";

    private static readonly ConcurrentDictionary<string, (DateTime Modified, string Hash)> Hashes = new(StringComparer.Ordinal);

    public static void MapAgentUpdateEndpoints(this IEndpointRouteBuilder app)
    {
        var control = Policies.Permission(Permissions.AgentsControl);
        app.MapGet("/api/agents/version", (IOptions<AgentSettings> settings) => TypedResults.Ok(new { version = settings.Value.Version, autoUpdate = settings.Value.AutoUpdate }))
            .WithTags("Agentes").RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        app.MapPost("/api/agents/{id:int}/update", UpdateOneAsync).WithTags("Agentes").RequireAuthorization(control);
        app.MapPost("/api/agents/update", UpdateManyAsync).WithTags("Agentes").RequireAuthorization(control);
        // Consulta do proprio agente por REST: atualiza mesmo quando o NATS nao esta funcionando.
        app.MapGet("/api/v3/{agentId}/update/", CheckForAgentAsync).RequireAuthorization(Policies.Agent).ExcludeFromDescription();
    }

    private static async Task<IResult> CheckForAgentAsync(System.Security.Claims.ClaimsPrincipal principal, CybereyesDbContext db,
        IOptions<AgentSettings> options, CancellationToken ct)
    {
        var pk = int.Parse(principal.FindFirst(CybereyesClaims.AgentPk)!.Value, CultureInfo.InvariantCulture);
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == pk).Select(a => new { a.Plat, a.GoArch }).FirstOrDefaultAsync(ct);
        var settings = options.Value;
        var message = agent is null ? null : Message(settings, agent.Plat, agent.GoArch);
        var sha = message?["payload"] is Dictionary<string, string> payload ? payload["sha256"] : string.Empty;
        return Results.Json(new Dictionary<string, object> { ["version"] = settings.Version, ["sha256"] = sha, ["auto_update"] = settings.AutoUpdate });
    }

    /// <summary>Mensagem NATS de atualizacao para a plataforma, ou nulo se o servidor nao tem o binario.</summary>
    public static Dictionary<string, object?>? Message(AgentSettings settings, string plat, string? goarch)
    {
        if (settings.FindBinary(plat, goarch ?? "amd64") is not { } path)
        {
            return null;
        }
        return new Dictionary<string, object?>
        {
            ["func"] = Func,
            ["payload"] = new Dictionary<string, string> { ["version"] = settings.Version, ["sha256"] = Sha256(path) },
        };
    }

    public static bool IsOutdated(string? current, string target) =>
        Version.TryParse(target, out var t) && (!Version.TryParse(current, out var c) || c < t);

    private static string Sha256(string path)
    {
        var modified = File.GetLastWriteTimeUtc(path);
        if (Hashes.TryGetValue(path, out var cached) && cached.Modified == modified)
        {
            return cached.Hash;
        }
        using var stream = File.OpenRead(path);
        var hash = Convert.ToHexStringLower(SHA256.HashData(stream));
        Hashes[path] = (modified, hash);
        return hash;
    }

    private static async Task<IResult> UpdateOneAsync(int id, CybereyesDbContext db, IAgentRpc rpc, IOptions<AgentSettings> options, IAuditService audit, CancellationToken ct)
    {
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id).Select(a => new { a.AgentId, a.Hostname, a.Plat, a.GoArch, a.Version }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var settings = options.Value;
        if (Message(settings, agent.Plat, agent.GoArch) is not { } message)
        {
            return Problems.Conflict($"Este servidor nao tem o EYES {settings.Version} para {agent.Plat}/{agent.GoArch}");
        }
        object? reply;
        try
        {
            reply = await rpc.RequestAsync(agent.AgentId, message, TimeSpan.FromMinutes(5), ct);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        if (reply is string text && text.StartsWith("error", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.Validation("agent", text);
        }
        if (reply is string unknown && unknown.Contains("unknown", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.Conflict("Este agente nao suporta atualizacao remota: reinstale pelo comando de implantacao");
        }
        await audit.LogAsync("agent.update", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"Atualizacao do EYES de {agent.Version} para {settings.Version} em {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Accepted((string?)null, new { version = settings.Version });
    }

    private static async Task<IResult> UpdateManyAsync(AgentUpdateRequest request, CybereyesDbContext db, IAgentRpc rpc, IOptions<AgentSettings> options,
        IAuditService audit, CancellationToken ct)
    {
        var settings = options.Value;
        var query = db.Agents.AsNoTracking().Where(a => a.Status == AgentStatus.Online);
        if (request.AgentIds is { Length: > 0 } ids)
        {
            query = query.Where(a => ids.Contains(a.Id));
        }
        var agents = await query.Select(a => new { a.Id, a.AgentId, a.Plat, a.GoArch, a.Version }).ToListAsync(ct);
        var sent = 0;
        foreach (var a in agents.Where(a => IsOutdated(a.Version, settings.Version)))
        {
            if (Message(settings, a.Plat, a.GoArch) is { } message)
            {
                await rpc.PublishAsync(a.AgentId, message, ct);
                sent++;
            }
        }
        await audit.LogAsync("agent.update-bulk", "agent", null, $"Atualizacao do EYES para {settings.Version} enviada a {sent} agente(s)", cancellationToken: ct);
        return TypedResults.Ok(new { version = settings.Version, sent });
    }
}

/// <summary>
/// Atualiza sozinho, a cada 30 minutos, ate 25 agentes online com versao menor que a distribuida
/// (Agent:AutoUpdate, ligado por padrao). Uma replica por vez (lock consultivo do PostgreSQL).
/// </summary>
public sealed partial class AgentAutoUpdater(IServiceScopeFactory scopes, IOptions<AgentSettings> options, ILogger<AgentAutoUpdater> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var settings = options.Value;
        if (!settings.AutoUpdate)
        {
            return 0;
        }
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var rpc = scope.ServiceProvider.GetRequiredService<IAgentRpc>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var locked = await db.Database.SqlQueryRaw<bool>("SELECT pg_try_advisory_xact_lock(hashtext('cybereyes-agent-update')) AS \"Value\"").SingleAsync(ct);
        if (!locked)
        {
            return 0;
        }
        var agents = await db.Agents.AsNoTracking().Where(a => a.Status == AgentStatus.Online)
            .Select(a => new { a.AgentId, a.Plat, a.GoArch, a.Version }).ToListAsync(ct);
        var sent = 0;
        foreach (var a in agents.Where(a => AgentUpdates.IsOutdated(a.Version, settings.Version)
                     && Version.TryParse(a.Version, out var v) && v.Major >= 3).Take(25))
        {
            // Agentes anteriores ao EYES (2.x) nao entendem "agentupdate": precisam ser reinstalados.
            if (AgentUpdates.Message(settings, a.Plat, a.GoArch) is { } message)
            {
                await rpc.PublishAsync(a.AgentId, message, ct);
                sent++;
            }
        }
        await tx.CommitAsync(ct);
        if (sent > 0)
        {
            LogSent(logger, sent, settings.Version);
        }
        return sent;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Atualizacao automatica do EYES {Version} enviada a {Count} agente(s)")]
    private static partial void LogSent(ILogger logger, int count, string version);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha na atualizacao automatica dos agentes")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
