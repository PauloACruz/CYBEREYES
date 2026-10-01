using Microsoft.EntityFrameworkCore;
using WinCare.Api.Infrastructure;
using WinCare.Core.Persistence;
using WinCare.Core.Security;

namespace WinCare.Api.Endpoints;

public static class AuditEndpoints
{
    public static void MapAuditEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/audit", ListAsync).WithTags("Auditoria").RequireAuthorization(Policies.Permission(Permissions.AuditView));
    }

    private static async Task<IResult> ListAsync(WinCareDbContext db, int? page, int? pageSize, string? username, string? action,
        DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize, 50);
        var query = db.AuditLogs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(username))
        {
            query = query.Where(a => a.Username == username.Trim());
        }
        if (!string.IsNullOrWhiteSpace(action))
        {
            query = query.Where(a => a.Action.StartsWith(action.Trim()));
        }
        if (from?.ToUniversalTime() is { } f)
        {
            query = query.Where(a => a.Timestamp >= f);
        }
        if (to?.ToUniversalTime() is { } t)
        {
            query = query.Where(a => a.Timestamp <= t);
        }

        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(a => a.Timestamp).ThenByDescending(a => a.Id)
            .Skip((p - 1) * size).Take(size)
            .Select(a => new AuditDto(a.Id, a.Timestamp, a.Username, a.Action, a.ObjectType, a.ObjectId, a.Message, a.IpAddress))
            .ToListAsync(ct);
        return TypedResults.Ok(new Paged<AuditDto>(items, total, p, size));
    }
}
