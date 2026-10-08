using System.Globalization;
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

        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.IsActive, u.AllClients }).FirstOrDefaultAsync();
        if (user is not { IsActive: true })
        {
            return new ClaimsPrincipal(new ClaimsIdentity());
        }

        var roles = await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where ur.UserId == userId
            select new { r.IsSuperuser, r.Permissions }).ToListAsync();

        var claims = new List<Claim> { new(CybereyesClaims.Enriched, "1") };
        var superuser = roles.Any(r => r.IsSuperuser);
        if (superuser)
        {
            claims.Add(new Claim(CybereyesClaims.Superuser, "1"));
        }
        else if (!user.AllClients)
        {
            var clientIds = await db.UserClients.AsNoTracking().Where(uc => uc.UserId == userId).Select(uc => uc.ClientId).ToListAsync();
            claims.Add(new Claim(CybereyesClaims.ClientScope, "1"));
            claims.AddRange(clientIds.Select(id => new Claim(CybereyesClaims.Client, id.ToString(CultureInfo.InvariantCulture))));
        }
        claims.AddRange(roles.SelectMany(r => r.Permissions).Distinct(StringComparer.Ordinal)
            .Select(p => new Claim(CybereyesClaims.Permission, p)));

        principal.AddIdentity(new ClaimsIdentity(claims));
        return principal;
    }
}
