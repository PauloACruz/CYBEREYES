using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Actions;

public static class KeyCaptureEndpoints
{
    public static void MapKeyCaptureEndpoints(this IEndpointRouteBuilder app)
    {
        var run = Policies.Permission(Permissions.AgentsRun);
        var group = app.MapGroup("/api/agents/{agentId:int}/keycapture").WithTags("Captura de teclado");
        group.MapGet("/sessions", ListSessionsAsync).RequireAuthorization(run);
        group.MapGet("/sessions/{sessionId:long}/entries", ListEntriesAsync).RequireAuthorization(run);
        group.MapGet("/active", GetActiveAsync).RequireAuthorization(run);
    }

    private static async Task<IResult> ListSessionsAsync(
        int agentId,
        CybereyesDbContext db,
        [FromQuery] DateOnly? date,
        CancellationToken ct)
    {
        var query = db.KeyCaptureSessions.AsNoTracking()
            .Where(s => s.AgentId == agentId)
            .OrderByDescending(s => s.StartedAt);

        if (date is { } d)
        {
            var start = new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var end = start.AddDays(1);
            query = (IOrderedQueryable<Core.Rmm.KeyCaptureSession>)query.Where(s => s.StartedAt >= start && s.StartedAt < end);
        }

        var sessions = await query.Take(100).Select(s => new
        {
            s.Id,
            s.AgentId,
            s.Username,
            s.State,
            s.StartedAt,
            s.StoppedAt,
            EntryCount = db.KeyCaptureEntries.Count(e => e.SessionId == s.Id),
        }).ToListAsync(ct);

        return Results.Ok(sessions);
    }

    private static async Task<IResult> ListEntriesAsync(
        int agentId,
        long sessionId,
        CybereyesDbContext db,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        CancellationToken ct)
    {
        var session = await db.KeyCaptureSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.AgentId == agentId, ct);
        if (session is null)
            return Results.NotFound();

        var p = Math.Max(1, page ?? 1);
        var size = Math.Clamp(pageSize ?? 200, 10, 1000);

        var entries = await db.KeyCaptureEntries.AsNoTracking()
            .Where(e => e.SessionId == sessionId)
            .OrderBy(e => e.CapturedAt)
            .Skip((p - 1) * size)
            .Take(size)
            .Select(e => new { e.Keys, e.CapturedAt })
            .ToListAsync(ct);

        return Results.Ok(entries);
    }

    private static Task<IResult> GetActiveAsync(
        int agentId,
        CybereyesDbContext db,
        KeyCaptureSessions keyCapture,
        CancellationToken ct)
    {
        var agent = db.Agents.AsNoTracking().FirstOrDefault(a => a.Id == agentId);
        if (agent is null)
            return Task.FromResult(Results.NotFound());

        var sessionId = keyCapture.ActiveSessionFor(agent.AgentId);
        if (sessionId is null)
            return Task.FromResult(Results.Ok(new { active = false }));

        var dbId = keyCapture.DbSessionIdFor(sessionId);
        return Task.FromResult(Results.Ok(new { active = true, sessionId, dbSessionId = dbId }));
    }
}
