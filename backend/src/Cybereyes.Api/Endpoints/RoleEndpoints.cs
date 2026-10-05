using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Mesh;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

public static class RoleEndpoints
{
    public static void MapRoleEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/roles").WithTags("Papeis").RequireAuthorization(Policies.Permission(Permissions.RolesManage));

        group.MapGet("/", ListAsync);
        group.MapGet("/permissions", () => TypedResults.Ok(Permissions.Catalog));
        group.MapPost("/", CreateAsync).RequestsMeshSync();
        group.MapPut("/{id:guid}", UpdateAsync).RequestsMeshSync();
        group.MapDelete("/{id:guid}", DeleteAsync).RequestsMeshSync();

        app.MapGet("/api/roles/options", OptionsAsync).WithTags("Papeis")
            .RequireAuthorization(Policies.Permission(Permissions.UsersManage));
    }

    private static async Task<IResult> OptionsAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var roles = await db.Roles.AsNoTracking().Select(r => new RoleRef(r.Id, r.Name!)).ToListAsync(ct);
        return TypedResults.Ok(roles.OrderBy(r => r.Name, StringComparer.Ordinal).ToList());
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var roles = await db.Roles.AsNoTracking()
            .Select(r => new RoleDto(r.Id, r.Name!, r.IsSuperuser, r.Permissions, db.UserRoles.Count(ur => ur.RoleId == r.Id)))
            .ToListAsync(ct);
        return TypedResults.Ok(roles.OrderBy(r => r.Name, StringComparer.Ordinal).ToList());
    }

    private static async Task<IResult> CreateAsync(SaveRoleRequest request, RoleManager<AppRole> roleManager, IAuditService audit, CancellationToken ct)
    {
        var permissions = NormalizePermissions(request.Permissions, out var invalid);
        if (invalid.Count > 0)
        {
            return Problems.Validation("permissions", $"Permissoes desconhecidas: {string.Join(", ", invalid)}");
        }

        var role = new AppRole { Name = request.Name.Trim(), IsSuperuser = request.IsSuperuser, Permissions = permissions };
        var result = await roleManager.CreateAsync(role);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }

        await audit.LogAsync("role.created", "role", role.Id.ToString(), $"Papel {role.Name} criado", cancellationToken: ct);
        return TypedResults.Created($"/api/roles/{role.Id}", new RoleDto(role.Id, role.Name!, role.IsSuperuser, role.Permissions, 0));
    }

    private static async Task<IResult> UpdateAsync(Guid id, SaveRoleRequest request, CybereyesDbContext db, RoleManager<AppRole> roleManager,
        IAuditService audit, CancellationToken ct)
    {
        var role = await roleManager.FindByIdAsync(id.ToString());
        if (role is null)
        {
            return Problems.NotFound("Papel");
        }

        var permissions = NormalizePermissions(request.Permissions, out var invalid);
        if (invalid.Count > 0)
        {
            return Problems.Validation("permissions", $"Permissoes desconhecidas: {string.Join(", ", invalid)}");
        }
        if (role.IsSuperuser && !request.IsSuperuser &&
            await SuperuserGuard.CountActiveSuperusersAsync(db, excludeRoleId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }

        role.Name = request.Name.Trim();
        role.IsSuperuser = request.IsSuperuser;
        role.Permissions = permissions;
        var result = await roleManager.UpdateAsync(role);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }

        await audit.LogAsync("role.updated", "role", id.ToString(), $"Papel {role.Name} alterado", cancellationToken: ct);
        var count = await db.UserRoles.CountAsync(ur => ur.RoleId == id, ct);
        return TypedResults.Ok(new RoleDto(role.Id, role.Name, role.IsSuperuser, role.Permissions, count));
    }

    private static async Task<IResult> DeleteAsync(Guid id, CybereyesDbContext db, RoleManager<AppRole> roleManager, IAuditService audit, CancellationToken ct)
    {
        var role = await roleManager.FindByIdAsync(id.ToString());
        if (role is null)
        {
            return Problems.NotFound("Papel");
        }
        if (await db.UserRoles.AnyAsync(ur => ur.RoleId == id, ct))
        {
            return Problems.Conflict("Remova os usuarios deste papel antes de exclui-lo");
        }

        await roleManager.DeleteAsync(role);
        await audit.LogAsync("role.deleted", "role", id.ToString(), $"Papel {role.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static List<string> NormalizePermissions(IReadOnlyList<string>? permissions, out List<string> invalid)
    {
        var distinct = (permissions ?? []).Select(p => p.Trim()).Distinct(StringComparer.Ordinal).ToList();
        invalid = distinct.Where(p => !Permissions.IsKnown(p)).ToList();
        return distinct.Where(Permissions.IsKnown).OrderBy(p => p, StringComparer.Ordinal).ToList();
    }
}
