using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
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
        group.MapGet("/client-options", ClientOptionsAsync);
        group.MapPost("/", CreateAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);

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
        var roles = await db.Roles.AsNoTracking().ToListAsync(ct);
        var ids = roles.Select(r => r.Id).ToList();
        var counts = await db.UserRoles.AsNoTracking().Where(ur => ids.Contains(ur.RoleId)).GroupBy(ur => ur.RoleId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var clients = await LoadClientsAsync(db, ids, ct);
        return TypedResults.Ok(roles.Select(r => ToDto(r, counts.GetValueOrDefault(r.Id), clients)).OrderBy(r => r.Name, StringComparer.Ordinal).ToList());
    }

    /// <summary>Clientes que quem edita pode liberar ao papel: um usuario restrito so repassa os que ele mesmo ve.</summary>
    private static async Task<IResult> ClientOptionsAsync(CybereyesDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Clients.AsNoTracking().OrderBy(c => c.Name).Select(c => new ClientRef(c.Id, c.Name)).ToListAsync(ct));

    private static async Task<IResult> CreateAsync(SaveRoleRequest request, CybereyesDbContext db, RoleManager<AppRole> roleManager, IAuditService audit,
        CancellationToken ct)
    {
        var permissions = NormalizePermissions(request.Permissions, out var invalid);
        if (invalid.Count > 0)
        {
            return Problems.Validation("permissions", $"Permissoes desconhecidas: {string.Join(", ", invalid)}");
        }
        if (request.IsSuperuser && db.IsClientRestricted)
        {
            return Problems.Validation("isSuperuser", "Quem ve so alguns clientes nao cria papel de superusuario");
        }
        // Superusuario ve todos os clientes: a restricao nao se aplica e nao e gravada.
        var allClients = request.IsSuperuser || (request.AllClients ?? true);
        if (!request.IsSuperuser && await ClientAccess.ValidateGrantAsync(db, allClients, request.ClientIds, ct) is { } clientError)
        {
            return clientError;
        }

        var role = new AppRole { Name = request.Name.Trim(), IsSuperuser = request.IsSuperuser, Permissions = permissions, AllClients = allClients };
        var result = await roleManager.CreateAsync(role);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }
        if (!allClients)
        {
            await ReplaceClientsAsync(db, role.Id, request.ClientIds!, ct);
        }

        await audit.LogAsync("role.created", "role", role.Id.ToString(), $"Papel {role.Name} criado", cancellationToken: ct);
        return TypedResults.Created($"/api/roles/{role.Id}", ToDto(role, 0, await LoadClientsAsync(db, [role.Id], ct)));
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
        if (request.IsSuperuser && !role.IsSuperuser && db.IsClientRestricted)
        {
            return Problems.Validation("isSuperuser", "Quem ve so alguns clientes nao cria papel de superusuario");
        }
        if (role.IsSuperuser && !request.IsSuperuser &&
            await SuperuserGuard.CountActiveSuperusersAsync(db, excludeRoleId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }
        var allClients = request.AllClients ?? role.AllClients;
        var clientsChanged = !request.IsSuperuser && (request.AllClients is not null || request.ClientIds is not null);
        if (clientsChanged)
        {
            // Mesma regra dos usuarios: quem ve so alguns clientes nao libera todos, mas pode manter "todos" onde ja estava.
            var keepsAll = allClients && role.AllClients;
            var clientIds = request.ClientIds ?? (allClients ? null : await CurrentClientIdsAsync(db, id, ct));
            if (!keepsAll && await ClientAccess.ValidateGrantAsync(db, allClients, clientIds, ct) is { } clientError)
            {
                return clientError;
            }
        }

        role.Name = request.Name.Trim();
        role.IsSuperuser = request.IsSuperuser;
        role.Permissions = permissions;
        if (clientsChanged)
        {
            role.AllClients = allClients;
        }
        var result = await roleManager.UpdateAsync(role);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }
        if (clientsChanged)
        {
            await ReplaceClientsAsync(db, id, allClients ? [] : request.ClientIds ?? await CurrentClientIdsAsync(db, id, ct), ct);
        }

        await audit.LogAsync("role.updated", "role", id.ToString(), $"Papel {role.Name} alterado", cancellationToken: ct);
        var count = await db.UserRoles.CountAsync(ur => ur.RoleId == id, ct);
        return TypedResults.Ok(ToDto(role, count, await LoadClientsAsync(db, [id], ct)));
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

    private static Task<List<int>> CurrentClientIdsAsync(CybereyesDbContext db, Guid roleId, CancellationToken ct) =>
        db.RoleClients.Where(rc => rc.RoleId == roleId && db.Clients.Any(c => c.Id == rc.ClientId)).Select(rc => rc.ClientId).ToListAsync(ct);

    /// <summary>Troca os clientes do papel que quem edita enxerga; os demais (fora do escopo dele) ficam como estao.</summary>
    private static async Task ReplaceClientsAsync(CybereyesDbContext db, Guid roleId, IReadOnlyList<int> clientIds, CancellationToken ct)
    {
        var visible = db.Clients.Select(c => c.Id);
        await db.RoleClients.Where(rc => rc.RoleId == roleId && visible.Contains(rc.ClientId)).ExecuteDeleteAsync(ct);
        db.RoleClients.AddRange(clientIds.Distinct().Select(clientId => new RoleClient { RoleId = roleId, ClientId = clientId }));
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Clientes de cada papel que quem consulta enxerga.</summary>
    private static async Task<ILookup<Guid, ClientRef>> LoadClientsAsync(CybereyesDbContext db, List<Guid> roleIds, CancellationToken ct)
    {
        var rows = await (
            from rc in db.RoleClients.AsNoTracking()
            join c in db.Clients.AsNoTracking() on rc.ClientId equals c.Id
            where roleIds.Contains(rc.RoleId)
            select new { rc.RoleId, c.Id, c.Name }).ToListAsync(ct);
        return rows.ToLookup(r => r.RoleId, r => new ClientRef(r.Id, r.Name));
    }

    private static RoleDto ToDto(AppRole role, int userCount, ILookup<Guid, ClientRef> clients) =>
        new(role.Id, role.Name ?? string.Empty, role.IsSuperuser, role.Permissions, userCount, role.AllClients,
            role.AllClients ? [] : clients[role.Id].OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList());

    private static List<string> NormalizePermissions(IReadOnlyList<string>? permissions, out List<string> invalid)
    {
        var distinct = (permissions ?? []).Select(p => p.Trim()).Distinct(StringComparer.Ordinal).ToList();
        invalid = distinct.Where(p => !Permissions.IsKnown(p)).ToList();
        return distinct.Where(Permissions.IsKnown).OrderBy(p => p, StringComparer.Ordinal).ToList();
    }
}
