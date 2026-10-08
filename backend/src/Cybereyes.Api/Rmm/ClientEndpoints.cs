using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

public sealed record SiteDto(int Id, int ClientId, string Name, int AgentCount);

public sealed record ClientDto(int Id, string Name, int AgentCount, IReadOnlyList<SiteDto> Sites);

public sealed record SaveNameRequest([property: Required, StringLength(255, MinimumLength = 1)] string Name);

public sealed record CreateClientRequest(
    [property: Required, StringLength(255, MinimumLength = 1)] string Name,
    [property: Required, StringLength(255, MinimumLength = 1)] string SiteName);

public static class ClientEndpoints
{
    public static void MapClientEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.ClientsView);
        var manage = Policies.Permission(Permissions.ClientsManage);

        var clients = app.MapGroup("/api/clients").WithTags("Clientes");
        clients.MapGet("/", ListAsync).RequireAuthorization(view);
        clients.MapPost("/", CreateAsync).RequireAuthorization(manage);
        clients.MapPut("/{id:int}", RenameClientAsync).RequireAuthorization(manage);
        clients.MapDelete("/{id:int}", DeleteClientAsync).RequireAuthorization(manage);
        clients.MapPost("/{id:int}/sites", CreateSiteAsync).RequireAuthorization(manage);

        var sites = app.MapGroup("/api/sites").WithTags("Clientes");
        sites.MapPut("/{id:int}", RenameSiteAsync).RequireAuthorization(manage);
        sites.MapDelete("/{id:int}", DeleteSiteAsync).RequireAuthorization(manage);
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var sites = await db.Sites.AsNoTracking()
            .Select(s => new SiteDto(s.Id, s.ClientId, s.Name, s.Agents.Count))
            .ToListAsync(ct);
        var clients = await db.Clients.AsNoTracking().OrderBy(c => c.Name).Select(c => new { c.Id, c.Name }).ToListAsync(ct);
        var byClient = sites.ToLookup(s => s.ClientId);
        return TypedResults.Ok(clients.Select(c =>
        {
            var clientSites = byClient[c.Id].OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
            return new ClientDto(c.Id, c.Name, clientSites.Sum(s => s.AgentCount), clientSites);
        }).ToList());
    }

    private static async Task<IResult> CreateAsync(CreateClientRequest request, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (await db.Clients.IgnoreQueryFilters().AnyAsync(c => c.Name == name, ct))
        {
            return Problems.Conflict("Ja existe um cliente com esse nome");
        }

        var client = new Client { Name = name, Sites = [new Site { Name = request.SiteName.Trim() }] };
        db.Clients.Add(client);
        await db.SaveChangesAsync(ct);
        if (db.IsClientRestricted && principal.UserId() is { } userId)
        {
            // Quem ve so alguns clientes passa a ver tambem o que acabou de criar.
            db.UserClients.Add(new UserClient { UserId = userId, ClientId = client.Id });
            await db.SaveChangesAsync(ct);
        }
        await audit.LogAsync("client.created", "client", Id(client.Id), $"Cliente {name} criado", cancellationToken: ct);
        var site = client.Sites[0];
        return TypedResults.Created($"/api/clients/{client.Id}",
            new ClientDto(client.Id, client.Name, 0, [new SiteDto(site.Id, client.Id, site.Name, 0)]));
    }

    private static async Task<IResult> RenameClientAsync(int id, SaveNameRequest request, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var client = await db.Clients.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (client is null)
        {
            return Problems.NotFound("Cliente");
        }
        var name = request.Name.Trim();
        if (await db.Clients.IgnoreQueryFilters().AnyAsync(c => c.Name == name && c.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um cliente com esse nome");
        }

        client.Name = name;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("client.updated", "client", Id(id), $"Cliente renomeado para {name}", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> DeleteClientAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var client = await db.Clients.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (client is null)
        {
            return Problems.NotFound("Cliente");
        }
        if (await db.Agents.AnyAsync(a => a.Site!.ClientId == id, ct))
        {
            return Problems.Conflict("Remova ou mova os agentes deste cliente antes de exclui-lo");
        }

        db.Sites.RemoveRange(db.Sites.Where(s => s.ClientId == id));
        db.Clients.Remove(client);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("client.deleted", "client", Id(id), $"Cliente {client.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> CreateSiteAsync(int id, SaveNameRequest request, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (!await db.Clients.AnyAsync(c => c.Id == id, ct))
        {
            return Problems.NotFound("Cliente");
        }
        var name = request.Name.Trim();
        if (await db.Sites.AnyAsync(s => s.ClientId == id && s.Name == name, ct))
        {
            return Problems.Conflict("Ja existe um site com esse nome neste cliente");
        }

        var site = new Site { ClientId = id, Name = name };
        db.Sites.Add(site);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("site.created", "site", Id(site.Id), $"Site {name} criado", cancellationToken: ct);
        return TypedResults.Created($"/api/sites/{site.Id}", new SiteDto(site.Id, id, name, 0));
    }

    private static async Task<IResult> RenameSiteAsync(int id, SaveNameRequest request, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (site is null)
        {
            return Problems.NotFound("Site");
        }
        var name = request.Name.Trim();
        if (await db.Sites.AnyAsync(s => s.ClientId == site.ClientId && s.Name == name && s.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um site com esse nome neste cliente");
        }

        site.Name = name;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("site.updated", "site", Id(id), $"Site renomeado para {name}", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> DeleteSiteAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (site is null)
        {
            return Problems.NotFound("Site");
        }
        if (await db.Agents.AnyAsync(a => a.SiteId == id, ct))
        {
            return Problems.Conflict("Remova ou mova os agentes deste site antes de exclui-lo");
        }
        if (await db.Sites.CountAsync(s => s.ClientId == site.ClientId, ct) == 1)
        {
            return Problems.Conflict("O cliente precisa ter ao menos um site");
        }

        db.Sites.Remove(site);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("site.deleted", "site", Id(id), $"Site {site.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
