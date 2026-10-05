using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Inventory;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Inventory;

public sealed record SaveNetworkRequest(
    int ClientId, int? SiteId, [property: Required, StringLength(200, MinimumLength = 1)] string Name, [property: Required] string Cidr,
    [property: Range(1, 4094)] int? VlanId, [property: StringLength(100)] string? VlanName, string? Gateway, [property: StringLength(500)] string? DnsServers,
    [property: StringLength(200)] string? DhcpRange, [property: StringLength(5000)] string? Description);

public sealed record SaveIpRequest([property: Required] string Address, int? AssetId, [property: StringLength(200)] string? Hostname, string? MacAddress,
    [property: Required] string Kind, [property: StringLength(1000)] string? Description);

public sealed record SaveDiagramRequest(int ClientId, int? SiteId, [property: Required, StringLength(200, MinimumLength = 1)] string Name, JsonElement Data);

public sealed record SaveCredentialRequest(
    int ClientId, int? SiteId, int? AssetId, [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(256)] string? Username, [property: StringLength(10000)] string? Secret, [property: StringLength(2000)] string? Url,
    [property: StringLength(5000)] string? Notes);

public sealed record SavePageRequest(int ClientId, int? SiteId, [property: Required, StringLength(200, MinimumLength = 2)] string Title,
    [property: StringLength(200000)] string? Body);

public static class DocsEndpoints
{
    private const int MaxDiagramBytes = 2 * 1024 * 1024;

    public static void MapDocsEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.DocsView);
        var manage = Policies.Permission(Permissions.DocsManage);

        var networks = app.MapGroup("/api/networks").WithTags("Documentacao");
        networks.MapGet("/", NetworksAsync).RequireAuthorization(view);
        networks.MapGet("/{id:int}", NetworkAsync).RequireAuthorization(view);
        networks.MapPost("/", (SaveNetworkRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveNetworkAsync(null, r, db, audit, ct))
            .RequireAuthorization(manage);
        networks.MapPut("/{id:int}", (int id, SaveNetworkRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveNetworkAsync(id, r, db, audit, ct))
            .RequireAuthorization(manage);
        networks.MapDelete("/{id:int}", DeleteNetworkAsync).RequireAuthorization(manage);
        networks.MapPost("/{id:int}/ips", (int id, SaveIpRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveIpAsync(id, null, r, db, audit, ct))
            .RequireAuthorization(manage);
        networks.MapPut("/{id:int}/ips/{ipId:long}", (int id, long ipId, SaveIpRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
            SaveIpAsync(id, ipId, r, db, audit, ct)).RequireAuthorization(manage);
        networks.MapDelete("/{id:int}/ips/{ipId:long}", DeleteIpAsync).RequireAuthorization(manage);

        var diagrams = app.MapGroup("/api/diagrams").WithTags("Documentacao");
        diagrams.MapGet("/", async (CybereyesDbContext db, CancellationToken ct, int? clientId) => TypedResults.Ok(await (
            from d in db.Diagrams.AsNoTracking()
            where clientId == null || d.ClientId == clientId
            join c in db.Clients on d.ClientId equals c.Id
            orderby c.Name, d.Name
            select new { d.Id, d.ClientId, ClientName = c.Name, d.SiteId, d.Name, d.UpdatedAt, d.UpdatedBy }).ToListAsync(ct))).RequireAuthorization(view);
        diagrams.MapGet("/{id:int}", DiagramAsync).RequireAuthorization(view);
        diagrams.MapPost("/", (SaveDiagramRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SaveDiagramAsync(null, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        diagrams.MapPut("/{id:int}", (int id, SaveDiagramRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SaveDiagramAsync(id, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        diagrams.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
            await DeleteAsync(db.Diagrams.Where(d => d.Id == id), "diagram", id, audit, ct)).RequireAuthorization(manage);

        var credentials = app.MapGroup("/api/credentials").WithTags("Documentacao");
        credentials.MapGet("/", CredentialsAsync).RequireAuthorization(view);
        credentials.MapPost("/{id:int}/reveal", RevealAsync).RequireAuthorization(Policies.Permission(Permissions.CredentialsReveal));
        var credManage = Policies.Permission(Permissions.CredentialsManage);
        credentials.MapPost("/", (SaveCredentialRequest r, ClaimsPrincipal p, CybereyesDbContext db, Vault vault, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SaveCredentialAsync(null, r, p, db, vault, audit, t, ct)).RequireAuthorization(credManage);
        credentials.MapPut("/{id:int}", (int id, SaveCredentialRequest r, ClaimsPrincipal p, CybereyesDbContext db, Vault vault, IAuditService audit, TimeProvider t,
            CancellationToken ct) => SaveCredentialAsync(id, r, p, db, vault, audit, t, ct)).RequireAuthorization(credManage);
        credentials.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
            await DeleteAsync(db.Credentials.Where(c => c.Id == id), "credential", id, audit, ct)).RequireAuthorization(credManage);

        var pages = app.MapGroup("/api/doc-pages").WithTags("Documentacao");
        pages.MapGet("/", async (CybereyesDbContext db, CancellationToken ct, int? clientId, string? search) =>
        {
            var term = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";
            return TypedResults.Ok(await (
                from d in db.DocPages.AsNoTracking()
                where (clientId == null || d.ClientId == clientId) && (term == null || EF.Functions.ILike(d.Title, term) || EF.Functions.ILike(d.Body, term))
                join c in db.Clients on d.ClientId equals c.Id
                orderby c.Name, d.Title
                select new { d.Id, d.ClientId, ClientName = c.Name, d.SiteId, d.Title, d.UpdatedAt, d.UpdatedBy }).ToListAsync(ct));
        }).RequireAuthorization(view);
        pages.MapGet("/{id:int}", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            await (from d in db.DocPages.AsNoTracking()
                   where d.Id == id
                   join c in db.Clients on d.ClientId equals c.Id
                   select new { d.Id, d.ClientId, ClientName = c.Name, d.SiteId, d.Title, d.Body, d.UpdatedAt, d.UpdatedBy }).FirstOrDefaultAsync(ct) is { } page
                ? TypedResults.Ok(page)
                : Problems.NotFound("Pagina")).RequireAuthorization(view);
        pages.MapPost("/", (SavePageRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SavePageAsync(null, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        pages.MapPut("/{id:int}", (int id, SavePageRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SavePageAsync(id, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        pages.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            await db.DocAttachments.Where(x => x.OwnerType == DocOwner.Page && x.OwnerId == id).ExecuteDeleteAsync(ct);
            return await DeleteAsync(db.DocPages.Where(d => d.Id == id), "doc-page", id, audit, ct);
        }).RequireAuthorization(manage);

        var files = app.MapGroup("/api/doc-attachments").WithTags("Documentacao");
        files.MapGet("/", ListAttachmentsAsync);
        files.MapGet("/{id:long}", DownloadAttachmentAsync);
        files.MapPost("/", UploadAttachmentAsync).DisableAntiforgery();
        files.MapDelete("/{id:long}", DeleteAttachmentAsync);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Id(long id) => id.ToString(CultureInfo.InvariantCulture);

    private static async Task<IResult?> ValidatePlaceAsync(int clientId, int? siteId, CybereyesDbContext db, CancellationToken ct)
    {
        if (!await db.Clients.AnyAsync(c => c.Id == clientId, ct))
        {
            return Problems.Validation("clientId", "Cliente inexistente");
        }
        if (siteId is { } site && !await db.Sites.AnyAsync(s => s.Id == site && s.ClientId == clientId, ct))
        {
            return Problems.Validation("siteId", "O site nao pertence ao cliente");
        }
        return null;
    }

    private static async Task<IResult> DeleteAsync<T>(IQueryable<T> query, string type, int id, IAuditService audit, CancellationToken ct)
    {
        if (await query.ExecuteDeleteAsync(ct) == 0)
        {
            return Problems.NotFound("Registro");
        }
        await audit.LogAsync($"{type}.delete", type, Id(id), $"{type} {id} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    // Redes e IPs

    private static async Task<IResult> NetworksAsync(CybereyesDbContext db, CancellationToken ct, int? clientId = null, int? siteId = null)
    {
        var rows = await (
            from n in db.Networks.AsNoTracking()
            where (clientId == null || n.ClientId == clientId) && (siteId == null || n.SiteId == siteId)
            join c in db.Clients on n.ClientId equals c.Id
            join s in db.Sites on n.SiteId equals s.Id into sg
            from s in sg.DefaultIfEmpty()
            orderby c.Name, n.Name
            select new { N = n, ClientName = c.Name, SiteName = s.Name, Used = db.IpRecords.Count(i => i.NetworkId == n.Id) }).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => new
        {
            r.N.Id, r.N.ClientId, r.ClientName, r.N.SiteId, r.SiteName, r.N.Name, r.N.Cidr, r.N.VlanId, r.N.VlanName, r.N.Gateway, r.N.DnsServers, r.N.DhcpRange,
            r.N.Description, usedCount = r.Used, totalHosts = NetUtil.ParseCidr(r.N.Cidr)?.TotalHosts ?? 0,
        }));
    }

    private static async Task<IResult> NetworkAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var network = await db.Networks.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id, ct);
        if (network is null)
        {
            return Problems.NotFound("Rede");
        }
        var cidr = NetUtil.ParseCidr(network.Cidr)!;
        var ips = (await (
            from i in db.IpRecords.AsNoTracking()
            where i.NetworkId == id
            join a in db.Assets on i.AssetId equals a.Id into ag
            from a in ag.DefaultIfEmpty()
            select new { i.Id, i.NetworkId, i.Address, i.AssetId, AssetName = a.Name, i.Hostname, i.MacAddress, i.Kind, i.Description }).ToListAsync(ct))
            .OrderBy(i => NetUtil.ParseIp(i.Address) is { } ip ? NetUtil.ToNumber(ip) : default).ToList();
        var recorded = ips.Select(i => i.Address).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var discovered = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        var assets = await db.Assets.AsNoTracking().Where(a => a.ClientId == network.ClientId && a.Status != AssetStatus.Retired)
            .Select(a => new { a.Id, a.Name, a.IpAddress, a.AgentId }).ToListAsync(ct);
        foreach (var asset in assets.Where(a => a.IpAddress is not null))
        {
            if (NetUtil.ParseIp(asset.IpAddress) is { } ip && cidr.Contains(ip) && !recorded.Contains(ip.ToString()))
            {
                discovered.TryAdd(ip.ToString(), new { address = ip.ToString(), assetId = (int?)asset.Id, assetName = asset.Name, source = "asset" });
            }
        }
        var agentIds = assets.Where(a => a.AgentId is not null).ToDictionary(a => a.AgentId!.Value);
        var agents = await db.Agents.AsNoTracking().Where(a => a.Site!.ClientId == network.ClientId && a.WmiDetail != null)
            .Select(a => new { a.Id, a.Hostname, a.Plat, a.WmiDetail }).ToListAsync(ct);
        foreach (var agent in agents)
        {
            var hw = Hardware.Parse(agent.WmiDetail, agent.Plat, null, null, null, null);
            foreach (var ip in (hw?.LocalIps ?? []).Select(NetUtil.ParseHostAddress).OfType<System.Net.IPAddress>())
            {
                if (cidr.Contains(ip) && !recorded.Contains(ip.ToString()))
                {
                    var asset = agentIds.GetValueOrDefault(agent.Id);
                    discovered.TryAdd(ip.ToString(), new { address = ip.ToString(), assetId = asset?.Id, assetName = asset?.Name ?? agent.Hostname, source = "agent" });
                }
            }
        }

        return TypedResults.Ok(new
        {
            network.Id, network.ClientId, network.SiteId, network.Name, network.Cidr, network.VlanId, network.VlanName, network.Gateway, network.DnsServers,
            network.DhcpRange, network.Description, usedCount = ips.Count, totalHosts = cidr.TotalHosts, ips, discovered = discovered.Values.ToList(),
        });
    }

    private static async Task<IResult> SaveNetworkAsync(int? id, SaveNetworkRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (await ValidatePlaceAsync(r.ClientId, r.SiteId, db, ct) is { } invalid)
        {
            return invalid;
        }
        if (NetUtil.ParseCidr(r.Cidr) is not { } cidr)
        {
            return Problems.Validation("cidr", "Informe a rede no formato 192.168.1.0/24");
        }
        string? gateway = null;
        if (!string.IsNullOrWhiteSpace(r.Gateway))
        {
            if (NetUtil.ParseIp(r.Gateway) is not { } gw || !cidr.Contains(gw))
            {
                return Problems.Validation("gateway", "O gateway precisa ser um IP dentro da rede");
            }
            gateway = gw.ToString();
        }
        Network network;
        if (id is null)
        {
            network = new Network { Name = r.Name.Trim(), Cidr = cidr.ToString() };
            db.Networks.Add(network);
        }
        else
        {
            var found = await db.Networks.FirstOrDefaultAsync(n => n.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Rede");
            }
            if (found.Cidr != cidr.ToString())
            {
                var addresses = await db.IpRecords.Where(i => i.NetworkId == found.Id).Select(i => i.Address).ToListAsync(ct);
                if (addresses.Any(a => NetUtil.ParseIp(a) is not { } ip || !cidr.Contains(ip)))
                {
                    return Problems.Conflict("Ha IPs registrados fora da nova faixa");
                }
            }
            network = found;
        }
        network.ClientId = r.ClientId;
        network.SiteId = r.SiteId;
        network.Name = r.Name.Trim();
        network.Cidr = cidr.ToString();
        network.VlanId = r.VlanId;
        network.VlanName = Clean(r.VlanName);
        network.Gateway = gateway;
        network.DnsServers = Clean(r.DnsServers);
        network.DhcpRange = Clean(r.DhcpRange);
        network.Description = Clean(r.Description);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "network.create" : "network.update", "network", Id(network.Id), $"Rede {network.Name} {network.Cidr}", cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/networks/{network.Id}", network) : TypedResults.Ok(network);
    }

    private static async Task<IResult> DeleteNetworkAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        await db.DocAttachments.Where(x => x.OwnerType == DocOwner.Network && x.OwnerId == id).ExecuteDeleteAsync(ct);
        return await DeleteAsync(db.Networks.Where(n => n.Id == id), "network", id, audit, ct);
    }

    private static async Task<IResult> SaveIpAsync(int networkId, long? ipId, SaveIpRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var network = await db.Networks.AsNoTracking().FirstOrDefaultAsync(n => n.Id == networkId, ct);
        if (network is null)
        {
            return Problems.NotFound("Rede");
        }
        if (!IpKind.All.Contains(r.Kind))
        {
            return Problems.Validation("kind", "Tipo invalido (static, reserved ou dhcp)");
        }
        if (NetUtil.ParseIp(r.Address) is not { } ip || !NetUtil.ParseCidr(network.Cidr)!.Contains(ip))
        {
            return Problems.Validation("address", $"O endereco precisa estar dentro de {network.Cidr}");
        }
        if (!string.IsNullOrWhiteSpace(r.MacAddress) && NetUtil.NormalizeMac(r.MacAddress) is null)
        {
            return Problems.Validation("macAddress", "Endereco MAC invalido");
        }
        if (r.AssetId is { } assetId && !await db.Assets.AnyAsync(a => a.Id == assetId && a.ClientId == network.ClientId, ct))
        {
            return Problems.Validation("assetId", "O ativo precisa ser do mesmo cliente da rede");
        }
        var address = ip.ToString();
        if (await db.IpRecords.AnyAsync(i => i.NetworkId == networkId && i.Address == address && i.Id != ipId, ct))
        {
            return Problems.Conflict("Este IP ja esta registrado na rede");
        }
        IpRecord record;
        if (ipId is null)
        {
            record = new IpRecord { NetworkId = networkId, Address = address };
            db.IpRecords.Add(record);
        }
        else
        {
            var found = await db.IpRecords.FirstOrDefaultAsync(i => i.Id == ipId && i.NetworkId == networkId, ct);
            if (found is null)
            {
                return Problems.NotFound("IP");
            }
            record = found;
        }
        record.Address = address;
        record.AssetId = r.AssetId;
        record.Hostname = Clean(r.Hostname);
        record.MacAddress = NetUtil.NormalizeMac(r.MacAddress);
        record.Kind = r.Kind;
        record.Description = Clean(r.Description);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("network.ip", "network", Id(networkId), $"IP {address} em {network.Name}", cancellationToken: ct);
        return ipId is null ? TypedResults.Created($"/api/networks/{networkId}/ips/{record.Id}", record) : TypedResults.Ok(record);
    }

    private static async Task<IResult> DeleteIpAsync(int id, long ipId, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (await db.IpRecords.Where(i => i.Id == ipId && i.NetworkId == id).ExecuteDeleteAsync(ct) == 0)
        {
            return Problems.NotFound("IP");
        }
        await audit.LogAsync("network.ip-delete", "network", Id(id), $"IP {ipId} removido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    // Diagramas

    private static async Task<IResult> DiagramAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var d = await db.Diagrams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return d is null
            ? Problems.NotFound("Diagrama")
            : TypedResults.Ok(new { d.Id, d.ClientId, d.SiteId, d.Name, data = JsonDocument.Parse(d.Data).RootElement, d.UpdatedAt, d.UpdatedBy });
    }

    private static async Task<IResult> SaveDiagramAsync(int? id, SaveDiagramRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if (await ValidatePlaceAsync(r.ClientId, r.SiteId, db, ct) is { } invalid)
        {
            return invalid;
        }
        if (r.Data.ValueKind != JsonValueKind.Object ||
            (r.Data.TryGetProperty("nodes", out var nodes) && nodes.ValueKind != JsonValueKind.Array) ||
            (r.Data.TryGetProperty("edges", out var edges) && edges.ValueKind != JsonValueKind.Array))
        {
            return Problems.Validation("data", "O diagrama deve ser um objeto com listas nodes e edges");
        }
        var raw = r.Data.GetRawText();
        if (raw.Length > MaxDiagramBytes)
        {
            return Problems.Create(StatusCodes.Status413PayloadTooLarge, "Diagrama maior que 2 MB", ErrorCodes.Validation);
        }
        Diagram diagram;
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        if (id is null)
        {
            diagram = new Diagram { Name = r.Name.Trim(), UpdatedBy = actor };
            db.Diagrams.Add(diagram);
        }
        else
        {
            var found = await db.Diagrams.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Diagrama");
            }
            diagram = found;
        }
        diagram.ClientId = r.ClientId;
        diagram.SiteId = r.SiteId;
        diagram.Name = r.Name.Trim();
        diagram.Data = raw;
        diagram.UpdatedAt = time.GetUtcNow();
        diagram.UpdatedBy = actor;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "diagram.create" : "diagram.update", "diagram", Id(diagram.Id), $"Diagrama {diagram.Name}", cancellationToken: ct);
        var body = new { diagram.Id, diagram.ClientId, diagram.SiteId, diagram.Name, data = r.Data, diagram.UpdatedAt, diagram.UpdatedBy };
        return id is null ? TypedResults.Created($"/api/diagrams/{diagram.Id}", body) : TypedResults.Ok(body);
    }

    // Credenciais

    private static async Task<IResult> CredentialsAsync(CybereyesDbContext db, Vault vault, CancellationToken ct, int? clientId = null, int? assetId = null,
        string? search = null)
    {
        if (!vault.Enabled)
        {
            return VaultDisabled();
        }
        var term = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";
        return TypedResults.Ok(await (
            from x in db.Credentials.AsNoTracking()
            where (clientId == null || x.ClientId == clientId) && (assetId == null || x.AssetId == assetId) &&
                  (term == null || EF.Functions.ILike(x.Name, term) || (x.Username != null && EF.Functions.ILike(x.Username, term)) ||
                   (x.Url != null && EF.Functions.ILike(x.Url, term)))
            join c in db.Clients on x.ClientId equals c.Id
            join a in db.Assets on x.AssetId equals a.Id into ag
            from a in ag.DefaultIfEmpty()
            orderby c.Name, x.Name
            select new { x.Id, x.ClientId, ClientName = c.Name, x.SiteId, x.AssetId, AssetName = a.Name, x.Name, x.Username, x.Url, x.Notes, x.UpdatedAt, x.UpdatedBy })
            .ToListAsync(ct));
    }

    private static IResult VaultDisabled() =>
        Problems.Create(StatusCodes.Status503ServiceUnavailable, "Cofre de credenciais sem chave configurada (VAULT_KEY)", "VAULT_DISABLED");

    private static async Task<IResult> RevealAsync(int id, CybereyesDbContext db, Vault vault, IAuditService audit, CancellationToken ct)
    {
        if (!vault.Enabled)
        {
            return VaultDisabled();
        }
        var credential = await db.Credentials.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (credential is null)
        {
            return Problems.NotFound("Credencial");
        }
        string secret;
        try
        {
            secret = vault.Decrypt(credential.SecretEncrypted);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return Problems.Create(StatusCodes.Status500InternalServerError, "Nao foi possivel decifrar: a chave do cofre mudou?", "VAULT_KEY_MISMATCH");
        }
        await audit.LogAsync("credential.reveal", "credential", Id(id), $"Senha revelada: {credential.Name}", cancellationToken: ct);
        return TypedResults.Ok(new { secret });
    }

    private static async Task<IResult> SaveCredentialAsync(int? id, SaveCredentialRequest r, ClaimsPrincipal principal, CybereyesDbContext db, Vault vault,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (!vault.Enabled)
        {
            return VaultDisabled();
        }
        if (await ValidatePlaceAsync(r.ClientId, r.SiteId, db, ct) is { } invalid)
        {
            return invalid;
        }
        if (r.AssetId is { } assetId && !await db.Assets.AnyAsync(a => a.Id == assetId && a.ClientId == r.ClientId, ct))
        {
            return Problems.Validation("assetId", "O ativo precisa ser do mesmo cliente");
        }
        if (!string.IsNullOrWhiteSpace(r.Url) && (!Uri.TryCreate(r.Url.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is "javascript" or "data" or "file"))
        {
            return Problems.Validation("url", "URL invalida");
        }
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        Credential credential;
        if (id is null)
        {
            if (string.IsNullOrEmpty(r.Secret))
            {
                return Problems.Validation("secret", "Informe a senha ou segredo");
            }
            credential = new Credential { Name = r.Name.Trim(), SecretEncrypted = vault.Encrypt(r.Secret), UpdatedBy = actor };
            db.Credentials.Add(credential);
        }
        else
        {
            var found = await db.Credentials.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Credencial");
            }
            credential = found;
            if (!string.IsNullOrEmpty(r.Secret))
            {
                credential.SecretEncrypted = vault.Encrypt(r.Secret);
            }
        }
        credential.ClientId = r.ClientId;
        credential.SiteId = r.SiteId;
        credential.AssetId = r.AssetId;
        credential.Name = r.Name.Trim();
        credential.Username = Clean(r.Username);
        credential.Url = Clean(r.Url);
        credential.Notes = Clean(r.Notes);
        credential.UpdatedAt = time.GetUtcNow();
        credential.UpdatedBy = actor;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "credential.create" : "credential.update", "credential", Id(credential.Id), $"Credencial {credential.Name}",
            cancellationToken: ct);
        var body = new
        {
            credential.Id, credential.ClientId, credential.SiteId, credential.AssetId, credential.Name, credential.Username, credential.Url, credential.Notes,
            credential.UpdatedAt, credential.UpdatedBy,
        };
        return id is null ? TypedResults.Created($"/api/credentials/{credential.Id}", body) : TypedResults.Ok(body);
    }

    // Paginas

    private static async Task<IResult> SavePageAsync(int? id, SavePageRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if (await ValidatePlaceAsync(r.ClientId, r.SiteId, db, ct) is { } invalid)
        {
            return invalid;
        }
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        DocPage page;
        if (id is null)
        {
            page = new DocPage { Title = r.Title.Trim(), UpdatedBy = actor };
            db.DocPages.Add(page);
        }
        else
        {
            var found = await db.DocPages.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Pagina");
            }
            page = found;
        }
        page.ClientId = r.ClientId;
        page.SiteId = r.SiteId;
        page.Title = r.Title.Trim();
        page.Body = r.Body ?? string.Empty;
        page.UpdatedAt = time.GetUtcNow();
        page.UpdatedBy = actor;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "doc-page.create" : "doc-page.update", "doc-page", Id(page.Id), $"Pagina {page.Title}", cancellationToken: ct);
        var body = new { page.Id, page.ClientId, page.SiteId, page.Title, page.Body, page.UpdatedAt, page.UpdatedBy };
        return id is null ? TypedResults.Created($"/api/doc-pages/{page.Id}", body) : TypedResults.Ok(body);
    }

    // Anexos

    private static (string Read, string Write)? OwnerPermissions(string ownerType) => ownerType switch
    {
        DocOwner.Asset => (Permissions.InventoryView, Permissions.InventoryManage),
        DocOwner.Network or DocOwner.Page => (Permissions.DocsView, Permissions.DocsManage),
        _ => null,
    };

    private static Task<bool> OwnerExistsAsync(string ownerType, int ownerId, CybereyesDbContext db, CancellationToken ct) => ownerType switch
    {
        DocOwner.Asset => db.Assets.AnyAsync(a => a.Id == ownerId, ct),
        DocOwner.Network => db.Networks.AnyAsync(n => n.Id == ownerId, ct),
        _ => db.DocPages.AnyAsync(p => p.Id == ownerId, ct),
    };

    private static async Task<IResult> ListAttachmentsAsync(string ownerType, int ownerId, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        if (OwnerPermissions(ownerType) is not { } perms)
        {
            return Problems.Validation("ownerType", "Tipo de dono invalido");
        }
        if (!principal.HasPermission(perms.Read))
        {
            return Problems.Forbidden("Sem permissao");
        }
        return TypedResults.Ok(await db.DocAttachments.AsNoTracking().Where(x => x.OwnerType == ownerType && x.OwnerId == ownerId).OrderBy(x => x.Id)
            .Select(x => new { x.Id, x.OwnerType, x.OwnerId, x.FileName, x.ContentType, x.Size, x.UploadedBy, x.CreatedAt }).ToListAsync(ct));
    }

    private static async Task<IResult> DownloadAttachmentAsync(long id, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var attachment = await db.DocAttachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (attachment is null || OwnerPermissions(attachment.OwnerType) is not { } perms)
        {
            return Problems.NotFound("Anexo");
        }
        if (!principal.HasPermission(perms.Read))
        {
            return Problems.Forbidden("Sem permissao");
        }
        var content = await db.DocAttachmentData.AsNoTracking().Where(d => d.AttachmentId == id).Select(d => d.Content).FirstOrDefaultAsync(ct);
        if (content is null)
        {
            return Problems.NotFound("Anexo");
        }
        return attachment.ContentType.StartsWith("image/", StringComparison.Ordinal)
            ? Results.File(content, attachment.ContentType)
            : Results.File(content, "application/octet-stream", attachment.FileName);
    }

    private static async Task<IResult> UploadAttachmentAsync([FromForm] string? ownerType, [FromForm] int? ownerId, [FromForm] IFormFile? file,
        ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (ownerType is null || OwnerPermissions(ownerType) is not { } perms || ownerId is not { } owner)
        {
            return Problems.Validation("ownerType", "Informe ownerType (asset, network ou page) e ownerId");
        }
        if (!principal.HasPermission(perms.Write))
        {
            return Problems.Forbidden("Sem permissao");
        }
        if (!await OwnerExistsAsync(ownerType, owner, db, ct))
        {
            return Problems.NotFound("Dono do anexo");
        }
        if (file is null || file.Length == 0)
        {
            return Problems.Validation("file", "Envie um arquivo");
        }
        if (file.Length > Attachments.MaxBytes)
        {
            return Problems.Create(StatusCodes.Status413PayloadTooLarge, "Arquivo maior que 10 MB", ErrorCodes.Validation);
        }
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var content = buffer.ToArray();
        var name = Path.GetFileName(file.FileName);
        var attachment = new DocAttachment
        {
            OwnerType = ownerType, OwnerId = owner, FileName = string.IsNullOrWhiteSpace(name) ? "arquivo" : name[..Math.Min(name.Length, 255)],
            ContentType = Attachments.DetectImage(content) ?? "application/octet-stream", Size = content.Length,
            UploadedBy = await TicketEndpoints.ActorNameAsync(principal, db, ct),
        };
        db.DocAttachments.Add(attachment);
        await db.SaveChangesAsync(ct);
        db.DocAttachmentData.Add(new DocAttachmentData { AttachmentId = attachment.Id, Content = content });
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("doc-attachment.create", ownerType, Id(owner), $"Anexo {attachment.FileName}", cancellationToken: ct);
        return TypedResults.Created($"/api/doc-attachments/{attachment.Id}",
            new { attachment.Id, attachment.OwnerType, attachment.OwnerId, attachment.FileName, attachment.ContentType, attachment.Size, attachment.UploadedBy, attachment.CreatedAt });
    }

    private static async Task<IResult> DeleteAttachmentAsync(long id, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var attachment = await db.DocAttachments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (attachment is null || OwnerPermissions(attachment.OwnerType) is not { } perms)
        {
            return Problems.NotFound("Anexo");
        }
        if (!principal.HasPermission(perms.Write))
        {
            return Problems.Forbidden("Sem permissao");
        }
        db.DocAttachments.Remove(attachment);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("doc-attachment.delete", attachment.OwnerType, Id(attachment.OwnerId), $"Anexo {attachment.FileName} removido", cancellationToken: ct);
        return TypedResults.NoContent();
    }
}
