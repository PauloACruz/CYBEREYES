using Microsoft.EntityFrameworkCore;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Infrastructure;

/// <summary>Papel de um usuario como o escopo de clientes o enxerga.</summary>
public sealed record RoleScope(Guid Id, string Name, bool IsSuperuser, bool AllClients);

/// <summary>
/// Clientes que cada usuario ve. Restringem o proprio usuario (<see cref="AppUser.AllClients"/>) e os papeis dele
/// (<see cref="AppRole.AllClients"/>), e vale o que os dois liberam. Os papeis se somam como as permissoes: basta um papel sem
/// restricao para eles liberarem todos os clientes. Superusuario ve todos.
/// </summary>
public static class ClientAccess
{
    private const string BeyondEditor = "Voce so pode liberar os clientes que tem acesso";

    /// <summary>Escopo de cada usuario existente entre os informados; nulo quando ele ve todos os clientes.</summary>
    public static async Task<Dictionary<Guid, IReadOnlySet<int>?>> ScopesAsync(CybereyesDbContext db, IReadOnlyCollection<Guid> userIds,
        CancellationToken ct)
    {
        var ids = userIds.Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.AllClients }).ToListAsync(ct);
        var roles = await RolesAsync(db, ids, ct);
        return await ResolveAsync(db, users.Select(u => (u.Id, u.AllClients, (IReadOnlyCollection<RoleScope>)roles[u.Id].ToList())).ToList(), ct);
    }

    /// <summary>Escopo de um usuario cujos papeis ja foram lidos; nulo quando ele ve todos os clientes.</summary>
    public static async Task<IReadOnlySet<int>?> ScopeAsync(CybereyesDbContext db, Guid userId, bool userAllClients, IReadOnlyCollection<RoleScope> roles,
        CancellationToken ct) =>
        (await ResolveAsync(db, [(userId, userAllClients, roles)], ct))[userId];

    public static bool Sees(this IReadOnlySet<int>? scope, int clientId) => scope is null || scope.Contains(clientId);

    /// <summary>Papeis restringem quando todos os do usuario sao restritos; sem papel nenhum, nao restringem.</summary>
    public static bool RolesRestrict(IReadOnlyCollection<RoleScope> roles) =>
        roles.Count > 0 && !roles.Any(r => r.IsSuperuser) && roles.All(r => !r.AllClients);

    /// <summary>
    /// Libera ao usuario restrito o cliente que ele acabou de criar: na lista dele, se ele e restrito, e nos papeis dele, se sao os
    /// papeis que o restringem. Devolve os papeis alterados (os demais usuarios desses papeis passam a ver o cliente tambem).
    /// </summary>
    public static async Task<IReadOnlyList<string>> GrantCreatedClientAsync(CybereyesDbContext db, Guid userId, int clientId, CancellationToken ct)
    {
        var allClients = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => (bool?)u.AllClients).FirstOrDefaultAsync(ct);
        if (allClients is null)
        {
            return [];
        }
        var roles = (await RolesAsync(db, [userId], ct))[userId].ToList();
        if (roles.Any(r => r.IsSuperuser))
        {
            return [];
        }
        if (allClients == false)
        {
            db.UserClients.Add(new UserClient { UserId = userId, ClientId = clientId });
        }
        var granted = RolesRestrict(roles) ? roles : [];
        db.RoleClients.AddRange(granted.Select(r => new RoleClient { RoleId = r.Id, ClientId = clientId }));
        await db.SaveChangesAsync(ct);
        return granted.Select(r => r.Name).Order(StringComparer.Ordinal).ToList();
    }

    /// <summary>
    /// Nulo quando quem edita pode liberar esses clientes a um usuario ou papel: os clientes passam pelo escopo dele, e quem ve
    /// so alguns nao libera todos.
    /// </summary>
    public static async Task<IResult?> ValidateGrantAsync(CybereyesDbContext db, bool allClients, IReadOnlyList<int>? clientIds, CancellationToken ct)
    {
        if (allClients)
        {
            return db.IsClientRestricted ? Problems.Validation("allClients", BeyondEditor) : null;
        }
        var ids = (clientIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return Problems.Validation("clientIds", "Selecione ao menos um cliente");
        }
        return await db.Clients.CountAsync(c => ids.Contains(c.Id), ct) == ids.Count
            ? null
            : Problems.Validation("clientIds", "Um ou mais clientes nao existem");
    }

    /// <summary>
    /// Nulo quando o usuario, com os clientes e papeis pedidos, nao passa a ver cliente que quem edita nao ve. So pesa para quem edita
    /// restrito: sem isso, dar a alguem um papel sem restricao (ou de superusuario) liberaria clientes fora do escopo de quem edita.
    /// </summary>
    public static async Task<IResult?> ValidateUserScopeAsync(CybereyesDbContext db, Guid? userId, bool allClients, IReadOnlyCollection<int> clientIds,
        IReadOnlyCollection<Guid> roleIds, CancellationToken ct)
    {
        if (db.VisibleClientIds is not { } visible)
        {
            return null;
        }
        IReadOnlySet<int>? before = new HashSet<int>();
        if (userId is { } id && (await ScopesAsync(db, [id], ct)).TryGetValue(id, out var current))
        {
            before = current;
        }
        if (before is null)
        {
            return null;
        }

        var editor = visible.ToList();
        var ids = roleIds.Distinct().ToList();
        var roles = await db.Roles.AsNoTracking().Where(r => ids.Contains(r.Id))
            .Select(r => new RoleScope(r.Id, r.Name ?? string.Empty, r.IsSuperuser, r.AllClients)).ToListAsync(ct);
        // Os clientes do usuario que quem edita nao ve continuam com ele (a troca so mexe nos que quem edita enxerga).
        var kept = userId is { } owner && !allClients
            ? await db.UserClients.AsNoTracking().Where(uc => uc.UserId == owner && !editor.Contains(uc.ClientId)).Select(uc => uc.ClientId).ToListAsync(ct)
            : [];
        var after = Combine(allClients ? null : clientIds.Concat(kept), roles, await RoleClientsAsync(db, RestrictingRoles(roles), ct));
        return after is not null && after.All(c => before.Contains(c) || editor.Contains(c)) ? null : Problems.Validation("roleIds", BeyondEditor);
    }

    private static async Task<ILookup<Guid, RoleScope>> RolesAsync(CybereyesDbContext db, List<Guid> userIds, CancellationToken ct) =>
        (await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where userIds.Contains(ur.UserId)
            select new { ur.UserId, r.Id, r.Name, r.IsSuperuser, r.AllClients }).ToListAsync(ct))
        .ToLookup(r => r.UserId, r => new RoleScope(r.Id, r.Name ?? string.Empty, r.IsSuperuser, r.AllClients));

    private static IEnumerable<Guid> RestrictingRoles(IReadOnlyCollection<RoleScope> roles) => RolesRestrict(roles) ? roles.Select(r => r.Id) : [];

    private static async Task<ILookup<Guid, int>> RoleClientsAsync(CybereyesDbContext db, IEnumerable<Guid> roleIds, CancellationToken ct)
    {
        var ids = roleIds.Distinct().ToList();
        return (ids.Count == 0 ? [] : await db.RoleClients.AsNoTracking().Where(rc => ids.Contains(rc.RoleId)).ToListAsync(ct))
            .ToLookup(rc => rc.RoleId, rc => rc.ClientId);
    }

    private static async Task<Dictionary<Guid, IReadOnlySet<int>?>> ResolveAsync(CybereyesDbContext db,
        IReadOnlyList<(Guid Id, bool AllClients, IReadOnlyCollection<RoleScope> Roles)> users, CancellationToken ct)
    {
        // So le as listas de clientes de quem e restrito: no caso comum (ninguem restrito) nao ha consulta nenhuma.
        var restrictedUsers = users.Where(u => !u.AllClients && !u.Roles.Any(r => r.IsSuperuser)).Select(u => u.Id).Distinct().ToList();
        var ofUsers = (restrictedUsers.Count == 0 ? [] : await db.UserClients.AsNoTracking().Where(uc => restrictedUsers.Contains(uc.UserId)).ToListAsync(ct))
            .ToLookup(uc => uc.UserId, uc => uc.ClientId);
        var ofRoles = await RoleClientsAsync(db, users.SelectMany(u => RestrictingRoles(u.Roles)), ct);
        return users.ToDictionary(u => u.Id, IReadOnlySet<int>? (u) => Combine(u.AllClients ? null : ofUsers[u.Id], u.Roles, ofRoles));
    }

    /// <summary>Clientes do usuario (nulo: todos) cruzados com a soma dos clientes dos papeis, quando os papeis restringem.</summary>
    private static HashSet<int>? Combine(IEnumerable<int>? own, IReadOnlyCollection<RoleScope> roles, ILookup<Guid, int> ofRoles)
    {
        if (roles.Any(r => r.IsSuperuser))
        {
            return null;
        }
        var scope = own?.ToHashSet();
        if (RolesRestrict(roles))
        {
            var byRoles = roles.SelectMany(r => ofRoles[r.Id]);
            if (scope is null)
            {
                scope = byRoles.ToHashSet();
            }
            else
            {
                scope.IntersectWith(byRoles);
            }
        }
        return scope;
    }
}
