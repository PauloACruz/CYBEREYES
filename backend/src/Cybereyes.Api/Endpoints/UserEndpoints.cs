using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Mesh;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.UsersView);
        var manage = Policies.Permission(Permissions.UsersManage);
        var group = app.MapGroup("/api/users").WithTags("Usuarios");

        group.MapGet("/", ListAsync).RequireAuthorization(view);
        group.MapGet("/{id:guid}", GetAsync).RequireAuthorization(view);
        group.MapPost("/", CreateAsync).RequireAuthorization(manage).RequestsMeshSync();
        group.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(manage).RequestsMeshSync();
        group.MapPost("/{id:guid}/reset-password", ResetPasswordAsync).RequireAuthorization(manage);
        group.MapPost("/{id:guid}/reset-2fa", ResetTwoFactorAsync).RequireAuthorization(manage);
        group.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(manage).RequestsMeshSync();
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, int? page, int? pageSize, string? search, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize);
        var query = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(u => EF.Functions.ILike(u.UserName!, pattern) || EF.Functions.ILike(u.Email!, pattern) ||
                                     EF.Functions.ILike(u.FullName, pattern));
        }

        var total = await query.CountAsync(ct);
        var users = await query.OrderBy(u => u.UserName).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        var roles = await LoadRolesAsync(db, users.Select(u => u.Id).ToList(), ct);
        return TypedResults.Ok(new Paged<UserDto>(users.Select(u => ToDto(u, roles)).ToList(), total, p, size));
    }

    private static async Task<IResult> GetAsync(Guid id, CybereyesDbContext db, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }
        var logins = await db.UserLogins.AsNoTracking().Where(l => l.UserId == id && l.LoginProvider.StartsWith("oidc:")).ToListAsync(ct);
        var sso = logins.Select(l => new SsoLoginRef(int.TryParse(l.LoginProvider[5..], out var pid) ? pid : 0, l.ProviderDisplayName ?? l.LoginProvider)).ToList();
        return TypedResults.Ok(ToDto(user, await LoadRolesAsync(db, [id], ct)) with { SsoLogins = sso, HasPassword = user.PasswordHash is not null });
    }

    private static async Task<IResult> CreateAsync(CreateUserRequest request, CybereyesDbContext db, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        var roleNames = await ResolveRoleNamesAsync(db, request.RoleIds, ct);
        if (roleNames is null)
        {
            return Problems.Validation("roleIds", "Um ou mais papeis nao existem");
        }

        var user = new AppUser
        {
            UserName = request.Username.Trim(),
            Email = request.Email.Trim(),
            FullName = request.FullName.Trim(),
            IsActive = request.IsActive,
        };
        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }
        if (roleNames.Count > 0)
        {
            await userManager.AddToRolesAsync(user, roleNames);
        }

        await audit.LogAsync("user.created", "user", user.Id.ToString(), $"Usuario {user.UserName} criado", cancellationToken: ct);
        return TypedResults.Created($"/api/users/{user.Id}", ToDto(user, await LoadRolesAsync(db, [user.Id], ct)));
    }

    private static async Task<IResult> UpdateAsync(Guid id, UpdateUserRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        UserManager<AppUser> userManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        var roleNames = await ResolveRoleNamesAsync(db, request.RoleIds, ct);
        if (roleNames is null)
        {
            return Problems.Validation("roleIds", "Um ou mais papeis nao existem");
        }
        if (!request.IsActive && principal.UserId() == id)
        {
            return Problems.Conflict("Voce nao pode desativar o proprio usuario");
        }

        var wasSuperuser = await SuperuserGuard.IsSuperuserAsync(db, id, ct);
        var willBeSuperuser = request.IsActive && await db.Roles.AnyAsync(r => roleNames.Contains(r.Name!) && r.IsSuperuser, ct);
        if (wasSuperuser && !willBeSuperuser && await SuperuserGuard.CountActiveSuperusersAsync(db, excludeUserId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }

        var deactivated = user.IsActive && !request.IsActive;
        user.Email = request.Email.Trim();
        user.FullName = request.FullName.Trim();
        user.IsActive = request.IsActive;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }

        var current = await userManager.GetRolesAsync(user);
        await userManager.RemoveFromRolesAsync(user, current.Except(roleNames));
        await userManager.AddToRolesAsync(user, roleNames.Except(current));
        if (deactivated)
        {
            await userManager.UpdateSecurityStampAsync(user);
        }

        await audit.LogAsync("user.updated", "user", id.ToString(), $"Usuario {user.UserName} alterado", cancellationToken: ct);
        var logins = await db.UserLogins.AsNoTracking().Where(l => l.UserId == id && l.LoginProvider.StartsWith("oidc:")).ToListAsync(ct);
        var sso = logins.Select(l => new SsoLoginRef(int.TryParse(l.LoginProvider[5..], out var pid) ? pid : 0, l.ProviderDisplayName ?? l.LoginProvider)).ToList();
        return TypedResults.Ok(ToDto(user, await LoadRolesAsync(db, [id], ct)) with { SsoLogins = sso, HasPassword = user.PasswordHash is not null });
    }

    private static async Task<IResult> ResetPasswordAsync(Guid id, ResetPasswordRequest request, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, request.NewPassword);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result, "newPassword");
        }

        await audit.LogAsync("user.password-reset", "user", id.ToString(), $"Senha de {user.UserName} redefinida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ResetTwoFactorAsync(Guid id, UserManager<AppUser> userManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        await userManager.SetTwoFactorEnabledAsync(user, false);
        await userManager.ResetAuthenticatorKeyAsync(user);
        await userManager.UpdateSecurityStampAsync(user);
        await audit.LogAsync("user.2fa-reset", "user", id.ToString(), $"2FA de {user.UserName} redefinido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> DeleteAsync(Guid id, ClaimsPrincipal principal, CybereyesDbContext db, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        if (principal.UserId() == id)
        {
            return Problems.Conflict("Voce nao pode excluir o proprio usuario");
        }

        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }
        if (await SuperuserGuard.IsSuperuserAsync(db, id, ct) &&
            await SuperuserGuard.CountActiveSuperusersAsync(db, excludeUserId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }

        await userManager.DeleteAsync(user);
        await audit.LogAsync("user.deleted", "user", id.ToString(), $"Usuario {user.UserName} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<List<string>?> ResolveRoleNamesAsync(CybereyesDbContext db, IReadOnlyList<Guid>? roleIds, CancellationToken ct)
    {
        var ids = (roleIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var names = await db.Roles.Where(r => ids.Contains(r.Id)).Select(r => r.Name!).ToListAsync(ct);
        return names.Count == ids.Count ? names : null;
    }

    private static async Task<ILookup<Guid, RoleRef>> LoadRolesAsync(CybereyesDbContext db, List<Guid> userIds, CancellationToken ct)
    {
        var rows = await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where userIds.Contains(ur.UserId)
            select new { ur.UserId, r.Id, r.Name }).ToListAsync(ct);
        return rows.ToLookup(r => r.UserId, r => new RoleRef(r.Id, r.Name ?? string.Empty));
    }

    private static UserDto ToDto(AppUser user, ILookup<Guid, RoleRef> roles) =>
        new(user.Id, user.UserName ?? string.Empty, user.Email, user.FullName, user.IsActive, user.TwoFactorEnabled,
            roles[user.Id].OrderBy(r => r.Name, StringComparer.Ordinal).ToList(), user.LastLoginAt, user.CreatedAt);
}
