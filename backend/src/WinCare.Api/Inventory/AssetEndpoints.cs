using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Endpoints;
using WinCare.Api.Infrastructure;
using WinCare.Api.Tickets;
using WinCare.Core.Audit;
using WinCare.Core.Inventory;
using WinCare.Core.Persistence;
using WinCare.Core.Security;
using WinCare.Core.Tickets;

namespace WinCare.Api.Inventory;

public sealed record ResponsibleRef(int Id, string Name);

public sealed record AssetListItem(
    int Id, int ClientId, string ClientName, int? SiteId, string? SiteName, int? AgentId, string Type, string Name, string? Manufacturer, string? Model,
    string? SerialNumber, string? AssetTag, string Status, string? IpAddress, ResponsibleRef? Responsible, string? AgentStatus, DateTimeOffset UpdatedAt);

public sealed record SaveAssetRequest(
    int ClientId, int? SiteId, [property: Required] string Type, [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(200)] string? Manufacturer, [property: StringLength(200)] string? Model, [property: StringLength(200)] string? SerialNumber,
    [property: StringLength(100)] string? AssetTag, [property: Required] string Status, DateOnly? PurchaseDate, DateOnly? WarrantyUntil,
    [property: StringLength(200)] string? Location, string? IpAddress, string? MacAddress, [property: StringLength(5000)] string? Notes);

public sealed record ResponsibleRequest(int? PersonId, [property: StringLength(1000)] string? Notes);

public sealed record SavePersonRequest(
    int ClientId, [property: Required, StringLength(200, MinimumLength = 2)] string Name, [property: StringLength(256), EmailAddress] string? Email,
    [property: StringLength(64)] string? Phone, [property: StringLength(200)] string? Department, [property: StringLength(200)] string? JobTitle,
    [property: StringLength(256)] string? Username, bool Active);

public static class AssetEndpoints
{
    private sealed class AssetRow
    {
        public required Asset A { get; init; }
        public required string ClientName { get; init; }
        public string? SiteName { get; init; }
        public string? AgentStatus { get; init; }
        public int? PersonId { get; init; }
        public string? PersonName { get; init; }
    }

    public static void MapAssetEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.InventoryView);
        var manage = Policies.Permission(Permissions.InventoryManage);

        var assets = app.MapGroup("/api/assets").WithTags("Inventario");
        assets.MapGet("/", ListAsync).RequireAuthorization(view);
        assets.MapGet("/{id:int}", async (int id, WinCareDbContext db, TimeProvider time, CancellationToken ct) =>
            await SheetAsync(id, db, ct) is { } sheet ? TypedResults.Ok(sheet) : Problems.NotFound("Ativo")).RequireAuthorization(view);
        assets.MapPost("/", (SaveAssetRequest r, ClaimsPrincipal p, WinCareDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct) =>
            SaveAsync(null, r, db, audit, time, ct)).RequireAuthorization(manage);
        assets.MapPut("/{id:int}", (int id, SaveAssetRequest r, ClaimsPrincipal p, WinCareDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct) =>
            SaveAsync(id, r, db, audit, time, ct)).RequireAuthorization(manage);
        assets.MapDelete("/{id:int}", DeleteAsync).RequireAuthorization(manage);
        assets.MapPut("/{id:int}/responsible", ResponsibleAsync).RequireAuthorization(manage);

        app.MapGet("/api/agents/{id:int}/asset", async (int id, WinCareDbContext db, TimeProvider time, CancellationToken ct) =>
        {
            if (!await db.Agents.AnyAsync(a => a.Id == id, ct))
            {
                return Problems.NotFound("Agente");
            }
            await AssetSync.SyncAsync(db, id, time, ct);
            var assetId = await db.Assets.Where(a => a.AgentId == id).Select(a => a.Id).FirstAsync(ct);
            return TypedResults.Ok(new { assetId });
        }).WithTags("Inventario").RequireAuthorization(view);

        var people = app.MapGroup("/api/people").WithTags("Inventario");
        people.MapGet("/", PeopleAsync).RequireAuthorization(view);
        people.MapGet("/{id:int}", PersonAsync).RequireAuthorization(view);
        people.MapPost("/", (SavePersonRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct) => SavePersonAsync(null, r, db, audit, ct))
            .RequireAuthorization(manage);
        people.MapPut("/{id:int}", (int id, SavePersonRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct) => SavePersonAsync(id, r, db, audit, ct))
            .RequireAuthorization(manage);
        people.MapDelete("/{id:int}", DeletePersonAsync).RequireAuthorization(manage);
    }

    private static IQueryable<AssetRow> Rows(WinCareDbContext db) =>
        from a in db.Assets.AsNoTracking()
        join c in db.Clients on a.ClientId equals c.Id
        join s in db.Sites on a.SiteId equals s.Id into sg
        from s in sg.DefaultIfEmpty()
        join ag in db.Agents on a.AgentId equals ag.Id into agg
        from ag in agg.DefaultIfEmpty()
        let open = db.AssetAssignments.Where(x => x.AssetId == a.Id && x.UnassignedAt == null).Select(x => new { x.PersonId }).FirstOrDefault()
        let person = open == null ? null : db.People.Where(p => p.Id == open.PersonId).Select(p => new { p.Id, p.Name }).FirstOrDefault()
        select new AssetRow
        {
            A = a, ClientName = c.Name, SiteName = s.Name, AgentStatus = ag.Status,
            PersonId = person == null ? null : person.Id, PersonName = person == null ? null : person.Name,
        };

    private static AssetListItem ToItem(AssetRow r) => new(r.A.Id, r.A.ClientId, r.ClientName, r.A.SiteId, r.SiteName, r.A.AgentId, r.A.Type, r.A.Name,
        r.A.Manufacturer, r.A.Model, r.A.SerialNumber, r.A.AssetTag, r.A.Status, r.A.IpAddress,
        r.PersonId is { } pid ? new ResponsibleRef(pid, r.PersonName!) : null, r.A.AgentId is null ? null : r.AgentStatus, r.A.UpdatedAt);

    private static async Task<IResult> ListAsync(WinCareDbContext db, CancellationToken ct, int? clientId = null, int? siteId = null, string? type = null,
        string? status = null, int? personId = null, string? search = null, int page = 1, int pageSize = 50)
    {
        var size = Math.Clamp(pageSize, 1, 200);
        var p = Math.Max(page, 1);
        var query = Rows(db);
        if (clientId is not null)
        {
            query = query.Where(r => r.A.ClientId == clientId);
        }
        if (siteId is not null)
        {
            query = query.Where(r => r.A.SiteId == siteId);
        }
        if (!string.IsNullOrWhiteSpace(type))
        {
            query = query.Where(r => r.A.Type == type);
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(r => r.A.Status == status);
        }
        if (personId is not null)
        {
            query = query.Where(r => r.PersonId == personId);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(r => EF.Functions.ILike(r.A.Name, term) || (r.A.AssetTag != null && EF.Functions.ILike(r.A.AssetTag, term)) ||
                (r.A.SerialNumber != null && EF.Functions.ILike(r.A.SerialNumber, term)) || (r.A.Model != null && EF.Functions.ILike(r.A.Model, term)) ||
                (r.A.IpAddress != null && EF.Functions.ILike(r.A.IpAddress, term)));
        }
        var total = await query.CountAsync(ct);
        var rows = await query.OrderBy(r => r.A.Name).ThenBy(r => r.A.Id).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        return TypedResults.Ok(new Paged<AssetListItem>(rows.Select(ToItem).ToList(), total, p, size));
    }

    public static async Task<object?> SheetAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var row = await Rows(db).FirstOrDefaultAsync(r => r.A.Id == id, ct);
        if (row is null)
        {
            return null;
        }
        var a = row.A;
        var item = ToItem(row);

        var history = await (
            from h in db.AssetAssignments.AsNoTracking()
            where h.AssetId == id
            join p in db.People on h.PersonId equals p.Id
            orderby h.AssignedAt descending, h.Id descending
            select new { h.Id, h.PersonId, PersonName = p.Name, h.AssignedAt, h.UnassignedAt, h.AssignedBy, h.Notes }).ToListAsync(ct);
        var current = history.FirstOrDefault(h => h.UnassignedAt is null);
        object? responsible = null;
        if (current is not null)
        {
            var person = await db.People.AsNoTracking().FirstAsync(x => x.Id == current.PersonId, ct);
            responsible = new { personId = person.Id, person.Name, person.Email, person.Phone, person.Department, current.AssignedAt, current.AssignedBy };
        }

        var agent = a.AgentId is { } agentId
            ? await db.Agents.AsNoTracking().Where(x => x.Id == agentId).Select(x => new
            {
                x.Id, x.Hostname, x.Status, x.Plat, x.LastSeen, x.WmiDetail, x.TotalRam, x.OperatingSystem, x.LastLoggedInUser, x.LoggedInUsername, x.BootTime,
            }).FirstOrDefaultAsync(ct)
            : null;
        var hardware = agent is null
            ? null
            : Hardware.Parse(agent.WmiDetail, agent.Plat, agent.TotalRam, agent.OperatingSystem, LastUser(agent.LoggedInUsername, agent.LastLoggedInUser), agent.BootTime);

        object? suggested = null;
        if (current is null && agent is not null && UserPart(LastUser(agent.LoggedInUsername, agent.LastLoggedInUser)) is { } login)
        {
            suggested = (await db.People.AsNoTracking().Where(x => x.ClientId == a.ClientId && x.Active && x.Username != null)
                    .Select(x => new { x.Id, x.Name, x.Username }).ToListAsync(ct))
                .Where(x => string.Equals(UserPart(x.Username), login, StringComparison.OrdinalIgnoreCase))
                .Select(x => new { x.Id, x.Name }).FirstOrDefault();
        }

        var software = agent is null
            ? null
            : await db.AgentSoftware.AsNoTracking().Where(s => s.AgentId == agent.Id).Select(s => new { s.Software, s.UpdatedAt }).FirstOrDefaultAsync(ct);
        object? softwareSummary = software is null ? null : new { count = SoftwareCount(software.Software), software.UpdatedAt };

        var ipRecords = await (
            from ip in db.IpRecords.AsNoTracking()
            where ip.AssetId == id
            join n in db.Networks on ip.NetworkId equals n.Id
            select new { networkId = n.Id, networkName = n.Name, n.Cidr, n.VlanId, address = ip.Address, kind = ip.Kind }).ToListAsync(ct);
        var addresses = new List<System.Net.IPAddress>();
        if (NetUtil.ParseIp(a.IpAddress) is { } own)
        {
            addresses.Add(own);
        }
        addresses.AddRange((hardware?.LocalIps ?? []).Select(NetUtil.ParseHostAddress).OfType<System.Net.IPAddress>());
        var networks = await db.Networks.AsNoTracking().Where(n => n.ClientId == a.ClientId).ToListAsync(ct);
        var inferred = networks
            .SelectMany(n => NetUtil.ParseCidr(n.Cidr) is { } cidr
                ? addresses.Where(cidr.Contains).Select(ip => new { networkId = n.Id, networkName = n.Name, n.Cidr, n.VlanId, address = ip.ToString(), kind = (string?)null })
                : [])
            .Where(x => !ipRecords.Any(r => r.networkId == x.networkId && r.address == x.address));

        var credentials = await db.Credentials.AsNoTracking().Where(c => c.AssetId == id).OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name, c.Username, c.Url }).ToListAsync(ct);
        var attachments = await db.DocAttachments.AsNoTracking().Where(x => x.OwnerType == DocOwner.Asset && x.OwnerId == id).OrderBy(x => x.Id)
            .Select(x => new { x.Id, x.FileName, x.ContentType, x.Size, x.CreatedAt }).ToListAsync(ct);
        var tickets = a.AgentId is { } aid
            ? await db.Tickets.AsNoTracking().Where(t => t.AgentId == aid).OrderByDescending(t => t.CreatedAt).Take(10)
                .Select(t => new { t.Id, t.Title, t.Status, t.CreatedAt }).ToListAsync(ct)
            : [];
        var openTickets = a.AgentId is { } aid2 ? await db.Tickets.CountAsync(t => t.AgentId == aid2 && TicketStatus.Open.Contains(t.Status), ct) : 0;
        var snmp = await db.SnmpDevices.AsNoTracking().Where(d => d.AssetId == id).OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, d.Host, d.Status, d.LastPolledAt, d.LastError, d.SysName, d.UptimeSeconds }).ToListAsync(ct);

        return new
        {
            asset = new
            {
                item.Id, item.ClientId, item.ClientName, item.SiteId, item.SiteName, item.AgentId, item.Type, item.Name, item.Manufacturer, item.Model,
                item.SerialNumber, item.AssetTag, item.Status, item.IpAddress, item.Responsible, item.AgentStatus, item.UpdatedAt,
                a.PurchaseDate, a.WarrantyUntil, a.Location, a.MacAddress, a.Notes, a.CreatedAt, a.FromAgent,
            },
            responsible,
            suggestedPerson = suggested,
            history,
            hardware,
            software = softwareSummary,
            agent = agent is null ? null : new { agent.Id, agent.Hostname, agent.Status, agent.Plat, agent.LastSeen },
            network = ipRecords.Concat(inferred).ToList(),
            credentials,
            attachments,
            tickets = new { open = openTickets, recent = tickets },
            snmp,
        };
    }

    private static string? LastUser(string? loggedIn, string? last) =>
        !string.IsNullOrWhiteSpace(loggedIn) && loggedIn != "None" ? loggedIn : string.IsNullOrWhiteSpace(last) ? null : last;

    /// <summary>Login sem o dominio: "EMPRESA\maria" e "maria@empresa" viram "maria".</summary>
    public static string? UserPart(string? username)
    {
        var value = username?.Trim();
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }
        var slash = value.LastIndexOf('\\');
        if (slash >= 0)
        {
            value = value[(slash + 1)..];
        }
        var at = value.IndexOf('@', StringComparison.Ordinal);
        return at > 0 ? value[..at] : value;
    }

    private static int SoftwareCount(string json)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array ? doc.RootElement.GetArrayLength() : 0;
        }
        catch (System.Text.Json.JsonException)
        {
            return 0;
        }
    }

    private static async Task<IResult?> ValidateAsync(SaveAssetRequest r, WinCareDbContext db, CancellationToken ct)
    {
        if (!AssetType.All.Contains(r.Type))
        {
            return Problems.Validation("type", "Tipo invalido");
        }
        if (!AssetStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Status invalido");
        }
        if (!await db.Clients.AnyAsync(c => c.Id == r.ClientId, ct))
        {
            return Problems.Validation("clientId", "Cliente inexistente");
        }
        if (r.SiteId is { } siteId && !await db.Sites.AnyAsync(s => s.Id == siteId && s.ClientId == r.ClientId, ct))
        {
            return Problems.Validation("siteId", "O site nao pertence ao cliente");
        }
        if (!string.IsNullOrWhiteSpace(r.IpAddress) && NetUtil.ParseIp(r.IpAddress) is null)
        {
            return Problems.Validation("ipAddress", "Endereco IP invalido");
        }
        if (!string.IsNullOrWhiteSpace(r.MacAddress) && NetUtil.NormalizeMac(r.MacAddress) is null)
        {
            return Problems.Validation("macAddress", "Endereco MAC invalido");
        }
        if (r.PurchaseDate is { } bought && r.WarrantyUntil is { } until && until < bought)
        {
            return Problems.Validation("warrantyUntil", "A garantia termina antes da compra");
        }
        return null;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<IResult> SaveAsync(int? id, SaveAssetRequest r, WinCareDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (await ValidateAsync(r, db, ct) is { } invalid)
        {
            return invalid;
        }
        Asset asset;
        if (id is null)
        {
            asset = new Asset { Name = r.Name.Trim(), CreatedAt = time.GetUtcNow() };
            db.Assets.Add(asset);
        }
        else
        {
            var found = await db.Assets.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Ativo");
            }
            asset = found;
        }

        if (asset.AgentId is null)
        {
            asset.Name = r.Name.Trim();
            asset.Type = r.Type;
            asset.ClientId = r.ClientId;
            asset.SiteId = r.SiteId;
            asset.Manufacturer = Clean(r.Manufacturer);
            asset.Model = Clean(r.Model);
            asset.SerialNumber = Clean(r.SerialNumber);
        }
        else
        {
            if (r.Type == AssetType.Laptop || asset.Type == AssetType.Laptop)
            {
                asset.Type = r.Type == AssetType.Laptop ? AssetType.Laptop : asset.Type == AssetType.Laptop ? AssetType.Workstation : asset.Type;
            }
            asset.Manufacturer = Clean(r.Manufacturer) ?? asset.Manufacturer;
            asset.Model = Clean(r.Model) ?? asset.Model;
            asset.SerialNumber = Clean(r.SerialNumber) ?? asset.SerialNumber;
        }
        asset.AssetTag = Clean(r.AssetTag);
        asset.Status = r.Status;
        asset.PurchaseDate = r.PurchaseDate;
        asset.WarrantyUntil = r.WarrantyUntil;
        asset.Location = Clean(r.Location);
        asset.IpAddress = NetUtil.ParseIp(r.IpAddress)?.ToString();
        asset.MacAddress = NetUtil.NormalizeMac(r.MacAddress);
        asset.Notes = Clean(r.Notes);
        asset.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "asset.create" : "asset.update", "asset", Id(asset.Id), $"Ativo {asset.Name}", cancellationToken: ct);
        var sheet = await SheetAsync(asset.Id, db, ct);
        return id is null ? TypedResults.Created($"/api/assets/{asset.Id}", sheet) : TypedResults.Ok(sheet);
    }

    private static async Task<IResult> DeleteAsync(int id, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        var asset = await db.Assets.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (asset is null)
        {
            return Problems.NotFound("Ativo");
        }
        if (asset.AgentId is not null)
        {
            return Problems.Conflict("Este ativo pertence a um agente ativo; exclua o agente ou marque o ativo como baixado");
        }
        await db.DocAttachments.Where(x => x.OwnerType == DocOwner.Asset && x.OwnerId == id).ExecuteDeleteAsync(ct);
        db.Assets.Remove(asset);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("asset.delete", "asset", Id(id), $"Ativo {asset.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ResponsibleAsync(int id, ResponsibleRequest r, ClaimsPrincipal principal, WinCareDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        var asset = await db.Assets.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (asset is null)
        {
            return Problems.NotFound("Ativo");
        }
        Person? person = null;
        if (r.PersonId is { } personId)
        {
            person = await db.People.AsNoTracking().FirstOrDefaultAsync(x => x.Id == personId, ct);
            if (person is null || person.ClientId != asset.ClientId)
            {
                return Problems.Validation("personId", "A pessoa precisa ser do mesmo cliente do ativo");
            }
            if (!person.Active)
            {
                return Problems.Validation("personId", "Pessoa desativada");
            }
        }

        var now = time.GetUtcNow();
        var open = await db.AssetAssignments.FirstOrDefaultAsync(x => x.AssetId == id && x.UnassignedAt == null, ct);
        if (open?.PersonId == r.PersonId)
        {
            return TypedResults.Ok(await SheetAsync(id, db, ct));
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (open is not null)
        {
            open.UnassignedAt = now;
            await db.SaveChangesAsync(ct);
        }
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        if (person is not null)
        {
            db.AssetAssignments.Add(new AssetAssignment { AssetId = id, PersonId = person.Id, AssignedAt = now, AssignedBy = actor, Notes = Clean(r.Notes) });
        }
        await db.Assets.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAt, now), ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        await audit.LogAsync("asset.responsible", "asset", Id(id), person is null ? $"Responsavel removido de {asset.Name}" : $"{person.Name} responsavel por {asset.Name}",
            cancellationToken: ct);
        return TypedResults.Ok(await SheetAsync(id, db, ct));
    }

    private static async Task<IResult> PeopleAsync(WinCareDbContext db, CancellationToken ct, int? clientId = null, string? search = null, bool? active = null,
        int page = 1, int pageSize = 50)
    {
        var size = Math.Clamp(pageSize, 1, 200);
        var p = Math.Max(page, 1);
        var query = from x in db.People.AsNoTracking()
                    join c in db.Clients on x.ClientId equals c.Id
                    select new { P = x, ClientName = c.Name };
        if (clientId is not null)
        {
            query = query.Where(r => r.P.ClientId == clientId);
        }
        if (active is not null)
        {
            query = query.Where(r => r.P.Active == active);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(r => EF.Functions.ILike(r.P.Name, term) || (r.P.Email != null && EF.Functions.ILike(r.P.Email, term)) ||
                (r.P.Username != null && EF.Functions.ILike(r.P.Username, term)) || (r.P.Department != null && EF.Functions.ILike(r.P.Department, term)));
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(r => r.P.Name).Skip((p - 1) * size).Take(size).Select(r => new
        {
            r.P.Id, r.P.ClientId, r.ClientName, r.P.Name, r.P.Email, r.P.Phone, r.P.Department, r.P.JobTitle, r.P.Username, r.P.Active,
            AssetCount = db.AssetAssignments.Count(x => x.PersonId == r.P.Id && x.UnassignedAt == null),
        }).ToListAsync(ct);
        return TypedResults.Ok(new { items, total, page = p, pageSize = size });
    }

    private static async Task<IResult> PersonAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var person = await (from x in db.People.AsNoTracking()
                            where x.Id == id
                            join c in db.Clients on x.ClientId equals c.Id
                            select new { x.Id, x.ClientId, ClientName = c.Name, x.Name, x.Email, x.Phone, x.Department, x.JobTitle, x.Username, x.Active, x.CreatedAt })
            .FirstOrDefaultAsync(ct);
        if (person is null)
        {
            return Problems.NotFound("Pessoa");
        }
        var history = await (from h in db.AssetAssignments.AsNoTracking()
                             where h.PersonId == id
                             join a in db.Assets on h.AssetId equals a.Id
                             orderby h.AssignedAt descending
                             select new { h.Id, assetId = a.Id, assetName = a.Name, assetType = a.Type, h.AssignedAt, h.UnassignedAt, h.AssignedBy, h.Notes })
            .ToListAsync(ct);
        return TypedResults.Ok(new
        {
            person.Id, person.ClientId, person.ClientName, person.Name, person.Email, person.Phone, person.Department, person.JobTitle, person.Username,
            person.Active, person.CreatedAt,
            assets = history.Where(h => h.UnassignedAt is null).Select(h => new { id = h.assetId, name = h.assetName, type = h.assetType, h.AssignedAt }),
            history,
        });
    }

    private static async Task<IResult> SavePersonAsync(int? id, SavePersonRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (!await db.Clients.AnyAsync(c => c.Id == r.ClientId, ct))
        {
            return Problems.Validation("clientId", "Cliente inexistente");
        }
        Person person;
        if (id is null)
        {
            person = new Person { Name = r.Name.Trim(), ClientId = r.ClientId };
            db.People.Add(person);
        }
        else
        {
            var found = await db.People.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Pessoa");
            }
            if (found.ClientId != r.ClientId && await db.AssetAssignments.AnyAsync(x => x.PersonId == found.Id && x.UnassignedAt == null, ct))
            {
                return Problems.Conflict("Remova os ativos atribuidos antes de mudar a pessoa de cliente");
            }
            person = found;
        }
        person.ClientId = r.ClientId;
        person.Name = r.Name.Trim();
        person.Email = Clean(r.Email);
        person.Phone = Clean(r.Phone);
        person.Department = Clean(r.Department);
        person.JobTitle = Clean(r.JobTitle);
        person.Username = Clean(r.Username);
        person.Active = r.Active;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "person.create" : "person.update", "person", Id(person.Id), $"Pessoa {person.Name}", cancellationToken: ct);
        var body = new { person.Id, person.ClientId, person.Name, person.Email, person.Phone, person.Department, person.JobTitle, person.Username, person.Active };
        return id is null ? TypedResults.Created($"/api/people/{person.Id}", body) : TypedResults.Ok(body);
    }

    private static async Task<IResult> DeletePersonAsync(int id, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        var person = await db.People.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (person is null)
        {
            return Problems.NotFound("Pessoa");
        }
        if (await db.AssetAssignments.AnyAsync(x => x.PersonId == id && x.UnassignedAt == null, ct))
        {
            return Problems.Conflict("A pessoa tem ativos atribuidos; desative em vez de excluir");
        }
        db.People.Remove(person);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("person.delete", "person", Id(id), $"Pessoa {person.Name} excluida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
