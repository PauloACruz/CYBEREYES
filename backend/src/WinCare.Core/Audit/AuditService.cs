using Microsoft.AspNetCore.Http;
using WinCare.Core.Persistence;

namespace WinCare.Core.Audit;

public interface IAuditService
{
    Task LogAsync(string action, string? objectType = null, string? objectId = null, string? message = null,
        string? username = null, CancellationToken cancellationToken = default);
}

public sealed class AuditService(WinCareDbContext db, IHttpContextAccessor httpContextAccessor) : IAuditService
{
    public async Task LogAsync(string action, string? objectType = null, string? objectId = null, string? message = null,
        string? username = null, CancellationToken cancellationToken = default)
    {
        var context = httpContextAccessor.HttpContext;
        db.AuditLogs.Add(new AuditLog
        {
            Action = action,
            ObjectType = objectType,
            ObjectId = objectId,
            Message = message,
            Username = username ?? context?.User.Identity?.Name ?? "sistema",
            IpAddress = context?.Connection.RemoteIpAddress?.ToString(),
        });
        await db.SaveChangesAsync(cancellationToken);
    }
}
