using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Endpoints;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm;

public sealed record AgentListItem(int Id, string AgentId, string Hostname, int ClientId, string ClientName, int SiteId, string SiteName,
    string MonitoringType, string Plat, string? OperatingSystem, string Status, DateTimeOffset? LastSeen, string Version,
    string? LoggedInUsername, string? LastLoggedInUser, string? PublicIp, bool NeedsReboot, string? Description);

public sealed record AgentDetail(int Id, string AgentId, string Hostname, int ClientId, string ClientName, int SiteId, string SiteName,
    string MonitoringType, string Plat, string? GoArch, string? OperatingSystem, string Status, DateTimeOffset? LastSeen, string Version,
    string? LoggedInUsername, string? LastLoggedInUser, string? PublicIp, bool NeedsReboot, string? Description, int? TotalRam,
    DateTimeOffset? BootTime, string? MeshNodeId, JsonElement? Disks, JsonElement? Services, JsonElement? Wmi, int CheckInterval,
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

    private static async Task<IResult> ListAsync(WinCareDbContext db, int? clientId, int? siteId, string? status, string? search,
        int? page, int? pageSize, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize, 50);
        var query = db.Agents.AsNoTracking();
        if (clientId is { } c)
        {
            query = query.Where(a => a.Site!.ClientId == c);
        }
        if (siteId is { } s)
        {
            query = query.Where(a => a.SiteId == s);
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(a => a.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(a => EF.Functions.ILike(a.Hostname, pattern) || EF.Functions.ILike(a.Description ?? "", pattern) ||
                                     EF.Functions.ILike(a.LastLoggedInUser ?? "", pattern) || EF.Functions.ILike(a.PublicIp ?? "", pattern));
        }

        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(a => a.Hostname).Skip((p - 1) * size).Take(size)
            .Select(a => new AgentListItem(a.Id, a.AgentId, a.Hostname, a.Site!.ClientId, a.Site.Client!.Name, a.SiteId, a.Site.Name,
                a.MonitoringType, a.Plat, a.OperatingSystem, a.Status, a.LastSeen, a.Version, a.LoggedInUsername, a.LastLoggedInUser,
                a.PublicIp, a.NeedsReboot, a.Description))
            .ToListAsync(ct);
        return TypedResults.Ok(new Paged<AgentListItem>(items, total, p, size));
    }

    private static async Task<IResult> GetAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var a = await db.Agents.AsNoTracking().Include(x => x.Site!).ThenInclude(s => s.Client).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null)
        {
            return Problems.NotFound("Agente");
        }

        return TypedResults.Ok(new AgentDetail(a.Id, a.AgentId, a.Hostname, a.Site!.ClientId, a.Site.Client!.Name, a.SiteId, a.Site.Name,
            a.MonitoringType, a.Plat, a.GoArch, a.OperatingSystem, a.Status, a.LastSeen, a.Version, a.LoggedInUsername, a.LastLoggedInUser,
            a.PublicIp, a.NeedsReboot, a.Description, a.TotalRam,
            a.BootTime is { } boot ? DateTimeOffset.FromUnixTimeSeconds((long)boot) : null, a.MeshNodeId,
            Json(a.Disks), Json(a.Services), Json(a.WmiDetail), a.CheckInterval, a.OfflineTime, a.OverdueTime, a.CreatedAt, a.SnmpCollector));
    }

    private static async Task<IResult> PingAsync(int id, WinCareDbContext db, IAgentRpc rpc, CancellationToken ct)
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

    private static async Task<IResult> DeleteAsync(int id, WinCareDbContext db, NatsAuthSync natsAuth, IAgentNotifier notifier, IAuditService audit,
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
