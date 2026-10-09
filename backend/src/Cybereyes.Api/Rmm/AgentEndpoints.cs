using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

public sealed record AgentListItem(int Id, string AgentId, string Hostname, int ClientId, string ClientName, int SiteId, string SiteName,
    string MonitoringType, string Plat, string? OperatingSystem, string Status, DateTimeOffset? LastSeen, string Version,
    string? LoggedInUsername, string? LastLoggedInUser, string? PublicIp, bool NeedsReboot, string? Description, ResponsibleRef? Responsible);

public sealed record AgentDetail(int Id, string AgentId, string Hostname, int ClientId, string ClientName, int SiteId, string SiteName,
    string MonitoringType, string Plat, string? GoArch, string? OperatingSystem, string Status, DateTimeOffset? LastSeen, string Version,
    string? LoggedInUsername, string? LastLoggedInUser, string? PublicIp, bool NeedsReboot, string? Description, int? TotalRam,
    DateTimeOffset? BootTime, JsonElement? Disks, JsonElement? Services, JsonElement? Wmi, int CheckInterval,
    int OfflineTime, int OverdueTime, DateTimeOffset CreatedAt, bool SnmpCollector);

public static class AgentEndpoints
{
    public static void MapAgentEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var group = app.MapGroup("/api/agents").WithTags("Agentes");
        group.MapGet("/", ListAsync).RequireAuthorization(view);
        group.MapGet("/{id:int}", GetAsync).RequireAuthorization(view);
        group.MapPost("/{id:int}/ping", PingAsync).RequireAuthorization(view);
        group.MapDelete("/{id:int}", DeleteAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsManage));
        app.MapHub<ConsoleHub>("/hubs/console");
    }

    /// <summary>Colunas aceitas em sortBy na lista de agentes (padrao: hostname).</summary>
    public static readonly string[] SortColumns = ["status", "hostname", "client", "type", "os", "user", "version", "lastSeen", "reboot", "responsible"];

    /// <summary>Agente com o responsavel atual do ativo do inventario ligado a ele.</summary>
    private sealed class AgentRow
    {
        public required Agent A { get; init; }
        public int? PersonId { get; init; }
        public string? PersonName { get; init; }
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, int? clientId, int? siteId, string? status, string? search,
        int? page, int? pageSize, string? sortBy, string? sortDir, CancellationToken ct)
    {
        sortBy = string.IsNullOrWhiteSpace(sortBy) ? "hostname" : sortBy;
        if (!SortColumns.Contains(sortBy, StringComparer.Ordinal))
        {
            return Problems.Validation("sortBy", "Use " + string.Join(", ", SortColumns));
        }
        if (sortDir is not (null or "" or "asc" or "desc"))
        {
            return Problems.Validation("sortDir", "Use asc ou desc");
        }
        var desc = sortDir == "desc";
        var (p, size) = Paging.Normalize(page, pageSize, 50);
        var agents = db.Agents.AsNoTracking();
        if (clientId is { } c)
        {
            agents = agents.Where(a => a.Site!.ClientId == c);
        }
        if (siteId is { } s)
        {
            agents = agents.Where(a => a.SiteId == s);
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            agents = agents.Where(a => a.Status == status);
        }
        var query =
            from a in agents
            let person = (from x in db.AssetAssignments
                          where x.UnassignedAt == null && db.Assets.Any(asset => asset.Id == x.AssetId && asset.AgentId == a.Id)
                          join p in db.People on x.PersonId equals p.Id
                          select new { p.Id, p.Name }).FirstOrDefault()
            select new AgentRow { A = a, PersonId = person == null ? null : (int?)person.Id, PersonName = person == null ? null : person.Name };
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(r => EF.Functions.ILike(r.A.Hostname, pattern) || EF.Functions.ILike(r.A.Description ?? "", pattern) ||
                                     EF.Functions.ILike(r.A.LastLoggedInUser ?? "", pattern) || EF.Functions.ILike(r.A.PublicIp ?? "", pattern) ||
                                     EF.Functions.ILike(r.PersonName ?? "", pattern));
        }

        var total = await query.CountAsync(ct);
        var items = await Sort(query, sortBy, desc).Skip((p - 1) * size).Take(size)
            .Select(r => new AgentListItem(r.A.Id, r.A.AgentId, r.A.Hostname, r.A.Site!.ClientId, r.A.Site.Client!.Name, r.A.SiteId, r.A.Site.Name,
                r.A.MonitoringType, r.A.Plat, r.A.OperatingSystem, r.A.Status, r.A.LastSeen, r.A.Version, r.A.LoggedInUsername, r.A.LastLoggedInUser,
                r.A.PublicIp, r.A.NeedsReboot, r.A.Description, r.PersonId == null ? null : new ResponsibleRef(r.PersonId.Value, r.PersonName!)))
            .ToListAsync(ct);
        return TypedResults.Ok(new Paged<AgentListItem>(items, total, p, size));
    }

    /// <summary>Ordena pela coluna pedida; empates pelo hostname e pelo id, para a paginacao ser estavel.</summary>
    private static IOrderedQueryable<AgentRow> Sort(IQueryable<AgentRow> q, string column, bool desc)
    {
        IOrderedQueryable<AgentRow> ordered = column switch
        {
            // online, depois atrasado, depois offline (a ordem que importa para o tecnico)
            "status" => By(q, r => r.A.Status == AgentStatus.Online ? 0 : r.A.Status == AgentStatus.Overdue ? 1 : 2, desc),
            "client" => By(q, r => r.A.Site!.Client!.Name, desc).ThenBy(r => r.A.Site!.Name),
            "type" => By(q, r => r.A.MonitoringType, desc),
            "os" => By(q, r => r.A.OperatingSystem, desc),
            "user" => By(q, r => r.A.LoggedInUsername != null && r.A.LoggedInUsername != "" ? r.A.LoggedInUsername : r.A.LastLoggedInUser, desc),
            "version" => By(q, r => r.A.Version, desc),
            "lastSeen" => By(q, r => r.A.LastSeen, desc),
            "reboot" => By(q, r => r.A.NeedsReboot, desc),
            "responsible" => By(q, r => r.PersonName, desc),
            _ => By(q, r => r.A.Hostname, desc),
        };
        return ordered.ThenBy(r => r.A.Hostname).ThenBy(r => r.A.Id);
    }

    private static IOrderedQueryable<AgentRow> By<T>(IQueryable<AgentRow> q, System.Linq.Expressions.Expression<Func<AgentRow, T>> key, bool desc) =>
        desc ? q.OrderByDescending(key) : q.OrderBy(key);

    private static async Task<IResult> GetAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var a = await db.Agents.AsNoTracking().Include(x => x.Site!).ThenInclude(s => s.Client).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null)
        {
            return Problems.NotFound("Agente");
        }

        return TypedResults.Ok(new AgentDetail(a.Id, a.AgentId, a.Hostname, a.Site!.ClientId, a.Site.Client!.Name, a.SiteId, a.Site.Name,
            a.MonitoringType, a.Plat, a.GoArch, a.OperatingSystem, a.Status, a.LastSeen, a.Version, a.LoggedInUsername, a.LastLoggedInUser,
            a.PublicIp, a.NeedsReboot, a.Description, a.TotalRam,
            a.BootTime is { } boot ? DateTimeOffset.FromUnixTimeSeconds((long)boot) : null,
            Json(a.Disks), Json(a.Services), Json(a.WmiDetail), a.CheckInterval, a.OfflineTime, a.OverdueTime, a.CreatedAt, a.SnmpCollector));
    }

    private static async Task<IResult> PingAsync(int id, CybereyesDbContext db, IAgentRpc rpc, CancellationToken ct)
    {
        var agentId = await db.Agents.Where(a => a.Id == id).Select(a => a.AgentId).FirstOrDefaultAsync(ct);
        if (agentId is null)
        {
            return Problems.NotFound("Agente");
        }

        try
        {
            var reply = await rpc.RequestAsync(agentId, new Dictionary<string, object?> { ["func"] = "ping" }, TimeSpan.FromSeconds(3), ct);
            return TypedResults.Ok(new { status = reply as string == "pong" ? AgentStatus.Online : AgentStatus.Offline });
        }
        catch (AgentRpcTimeoutException)
        {
            return TypedResults.Ok(new { status = AgentStatus.Offline });
        }
    }

    private static async Task<IResult> DeleteAsync(int id, CybereyesDbContext db, NatsAuthSync natsAuth, IAgentNotifier notifier, IAuditService audit,
        CancellationToken ct)
    {
        var agent = await db.Agents.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }

        db.Agents.Remove(agent);
        await db.SaveChangesAsync(ct);
        natsAuth.Request();
        await audit.LogAsync("agent.deleted", "agent", id.ToString(CultureInfo.InvariantCulture), $"Agente {agent.Hostname} excluido", cancellationToken: ct);
        await notifier.AgentsChangedAsync(ct);
        return TypedResults.NoContent();
    }

    private static JsonElement? Json(string? raw) => raw is null ? null : JsonDocument.Parse(raw).RootElement.Clone();
}
