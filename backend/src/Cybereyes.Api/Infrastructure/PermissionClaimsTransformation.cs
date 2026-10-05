using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Infrastructure;

public sealed class PermissionClaimsTransformation(CybereyesDbContext db) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true || principal.HasClaim(c => c.Type == CybereyesClaims.Enriched))
        {
            return principal;
        }

        var userId = principal.UserId();
        if (userId is null)
        {
            return principal;
        }

        var active = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.IsActive).FirstOrDefaultAsync();
        if (!active)
        {
            return new ClaimsPrincipal(new ClaimsIdentity());
        }

        var roles = await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where ur.UserId == userId
            select new { r.IsSuperuser, r.Permissions }).ToListAsync();

        var claims = new List<Claim> { new(CybereyesClaims.Enriched, "1") };
        if (roles.Any(r => r.IsSuperuser))
        {
            claims.Add(new Claim(CybereyesClaims.Superuser, "1"));
        }
        claims.AddRange(roles.SelectMany(r => r.Permissions).Distinct(StringComparer.Ordinal)
            .Select(p => new Claim(CybereyesClaims.Permission, p)));

        principal.AddIdentity(new ClaimsIdentity(claims));
        return principal;
    }
}
