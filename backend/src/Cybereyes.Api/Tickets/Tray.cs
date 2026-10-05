using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tickets;

/// <summary>
/// Autentica o app de bandeja pelo token curto emitido ao agente ("Authorization: Tray &lt;token&gt;"), ou pela query
/// <c>access_token</c> no hub <c>/hubs/tray</c>, porque o WebSocket do navegador nao envia cabecalhos.
/// </summary>
public sealed class TrayTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    CybereyesDbContext db,
    TimeProvider time)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "TrayToken";
    public const string Prefix = "Tray ";
    public const string HubPath = "/hubs/tray";

    public static bool Matches(HttpRequest request) =>
        request.Headers.Authorization.ToString().StartsWith(Prefix, StringComparison.OrdinalIgnoreCase) ||
        (request.Path.StartsWithSegments(HubPath) && request.Query.ContainsKey("access_token"));

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        var token = header.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase) ? header[Prefix.Length..].Trim() : Request.Query["access_token"].ToString();
        if (string.IsNullOrEmpty(token))
        {
            return AuthenticateResult.NoResult();
        }
        var hash = AgentSecrets.Hash(token);
        var now = time.GetUtcNow();
        var session = await db.TrayTokens.AsNoTracking().Where(t => t.TokenHash == hash && t.ExpiresAt > now)
            .Select(t => new { t.AgentId, t.Username }).FirstOrDefaultAsync(Context.RequestAborted);
        if (session is null)
        {
            return AuthenticateResult.Fail("Token do app invalido ou expirado");
        }
        var identity = new ClaimsIdentity(
        [
            new Claim(CybereyesClaims.TrayAgent, session.AgentId.ToString(CultureInfo.InvariantCulture)),
            new Claim(CybereyesClaims.TrayUser, session.Username),
            new Claim(ClaimTypes.Name, $"tray:{session.Username}"),
        ], Scheme.Name);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }
}

[Authorize(Policy = Policies.Tray)]
public sealed class TrayHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        if (Tray.Session(Context.User!) is { } session)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, TicketService.TrayGroup(session.AgentId, session.Username));
        }
        await base.OnConnectedAsync();
    }
}

public sealed record TraySession(int AgentId, string Username);

public sealed record TrayMessageRequest([property: Required, StringLength(20000, MinimumLength = 1)] string Body);

public static class Tray
{
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(12);

    public static TraySession? Session(ClaimsPrincipal principal) =>
        int.TryParse(principal.FindFirstValue(CybereyesClaims.TrayAgent), NumberStyles.Integer, CultureInfo.InvariantCulture, out var agentId) &&
        principal.FindFirstValue(CybereyesClaims.TrayUser) is { Length: > 0 } user
            ? new TraySession(agentId, user)
            : null;

    /// <summary>Usuario normalizado: minusculas, sem espacos nas pontas, ate 256 caracteres.</summary>
    public static string? NormalizeUsername(string? username)
    {
        var value = username?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(value) || value.Length > 256 || value.Any(char.IsControl) ? null : value;
    }

    /// <summary>Rota do agente: emite o token curto do app de bandeja para o usuario que o agente identificou pelo IPC local.</summary>
    public static async Task<IResult> IssueTokenAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var agentPk = int.Parse(principal.FindFirstValue(CybereyesClaims.AgentPk)!, CultureInfo.InvariantCulture);
        var username = NormalizeUsername(body.ValueKind == JsonValueKind.Object && body.TryGetProperty("username", out var u) && u.ValueKind == JsonValueKind.String
            ? u.GetString()
            : null);
        if (username is null)
        {
            return Results.Json("username obrigatorio", statusCode: StatusCodes.Status400BadRequest);
        }
        var now = time.GetUtcNow();
        await db.TrayTokens.Where(t => t.AgentId == agentPk && t.ExpiresAt <= now).ExecuteDeleteAsync(ct);
        var token = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var expiresAt = now.Add(TokenLifetime);
        db.TrayTokens.Add(new TrayToken { AgentId = agentPk, Username = username, TokenHash = AgentSecrets.Hash(token), ExpiresAt = expiresAt, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        return Results.Json(new { token, expires_at = expiresAt });
    }

    public static void MapTrayEndpoints(this IEndpointRouteBuilder app)
    {
        var tray = app.MapGroup("/api/tray").WithTags("App de bandeja").RequireAuthorization(Policies.Tray);
        tray.MapGet("/me", MeAsync);
        tray.MapGet("/tickets", ListAsync);
        tray.MapPost("/tickets", CreateAsync).DisableAntiforgery();
        tray.MapGet("/tickets/{id:int}", GetAsync);
        tray.MapPost("/tickets/{id:int}/messages", MessageAsync);
        tray.MapGet("/tickets/{id:int}/attachments/{attachmentId:long}", DownloadAsync);
        app.MapHub<TrayHub>(TrayTokenAuthenticationHandler.HubPath);
    }

    private static IQueryable<Ticket> Mine(CybereyesDbContext db, TraySession s) =>
        db.Tickets.Where(t => t.AgentId == s.AgentId && t.RequesterUsername == s.Username);

    private static async Task<IResult> MeAsync(ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Session(principal)!;
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == s.AgentId)
            .Select(a => new { a.Hostname, ClientName = a.Site!.Client!.Name, SiteName = a.Site.Name }).FirstOrDefaultAsync(ct);
        return agent is null
            ? Problems.NotFound("Agente")
            : TypedResults.Ok(new { agent.Hostname, username = s.Username, agent.ClientName, agent.SiteName });
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Session(principal)!;
        var rows = await (
            from t in Mine(db, s).AsNoTracking()
            join u in db.Users on t.AssignedToId equals u.Id into ug
            from u in ug.DefaultIfEmpty()
            orderby t.UpdatedAt descending
            select new { T = t, Name = u == null ? null : (u.FullName != "" ? u.FullName : u.UserName) }).Take(50).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => TicketService.ToTray(r.T, r.Name)));
    }

    private static async Task<IResult> CreateAsync([FromForm] string? title, [FromForm] string? description, [FromForm] IFormFile? screenshot,
        ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc, CancellationToken ct)
    {
        var s = Session(principal)!;
        var cleanTitle = title?.Trim() ?? string.Empty;
        if (cleanTitle.Length is < 3 or > 200)
        {
            return Problems.Validation("title", "O titulo deve ter entre 3 e 200 caracteres");
        }
        if (description is { Length: > 20000 })
        {
            return Problems.Validation("description", "A descricao deve ter no maximo 20000 caracteres");
        }
        if (screenshot is { Length: > Attachments.MaxBytes })
        {
            return Problems.Create(StatusCodes.Status413PayloadTooLarge, "Arquivo maior que 10 MB", ErrorCodes.Validation);
        }
        if (screenshot is { Length: > 0 })
        {
            var head = new byte[16];
            await using var stream = screenshot.OpenReadStream();
            var read = await stream.ReadAtLeastAsync(head, head.Length, false, ct);
            if (Attachments.DetectImage(head.AsSpan(0, read)) is null)
            {
                return Problems.Validation("screenshot", "A captura deve ser uma imagem PNG, JPEG, GIF ou WEBP");
            }
        }

        var ticket = await svc.CreateAsync(new NewTicket(cleanTitle, description?.Trim() ?? string.Empty, TicketType.Request, TicketPriority.Medium, null,
            s.AgentId, s.Username, s.Username, null, null, null, TicketSource.Tray, null), ct);
        if (screenshot is { Length: > 0 })
        {
            var (_, error) = await Attachments.StoreAsync(db, ticket.Id, null, screenshot, s.Username, false, true, ct);
            if (error is not null)
            {
                return error;
            }
        }
        return TypedResults.Created($"/api/tray/tickets/{ticket.Id}", TicketService.ToTray(ticket, null));
    }

    private static async Task<IResult> GetAsync(int id, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc, CancellationToken ct)
    {
        var s = Session(principal)!;
        var ticket = await Mine(db, s).AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        var summary = await svc.TrayTicketAsync(ticket, ct);
        var messages = (await svc.MessagesAsync(id, false, ct))
            .Select(m => new TrayMessageDto(m.Id, m.AuthorType, m.AuthorName, m.Body, m.CreatedAt, m.Attachments)).ToList();
        var loose = (await db.TicketAttachments.AsNoTracking().Where(a => a.TicketId == id && a.MessageId == null && !a.Internal).OrderBy(a => a.Id)
            .ToListAsync(ct)).Select(Attachments.ToDto).ToList();
        return TypedResults.Ok(new
        {
            summary.Id, summary.Title, summary.Status, summary.Priority, summary.CreatedAt, summary.UpdatedAt, summary.AssignedToName,
            summary.ChatEnabled, summary.LastMessageAt, ticket.Description, messages, attachments = loose,
        });
    }

    private static async Task<IResult> MessageAsync(int id, TrayMessageRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        CancellationToken ct)
    {
        var s = Session(principal)!;
        var ticket = await Mine(db, s).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        if (ticket.AssignedToId is null || ticket.Status == TicketStatus.Closed)
        {
            return Problems.Create(StatusCodes.Status409Conflict, "O chat e liberado quando um tecnico assume o chamado", ErrorCodes.ChatLocked);
        }
        var message = await svc.AddMessageAsync(ticket, MessageAuthor.Requester, null, s.Username, r.Body.Trim(), false, ct);
        return TypedResults.Created($"/api/tray/tickets/{id}/messages/{message.Id}",
            new TrayMessageDto(message.Id, message.AuthorType, message.AuthorName, message.Body, message.CreatedAt, message.Attachments));
    }

    private static async Task<IResult> DownloadAsync(int id, long attachmentId, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Session(principal)!;
        if (!await Mine(db, s).AnyAsync(t => t.Id == id, ct))
        {
            return Problems.NotFound("Anexo");
        }
        var attachment = await db.TicketAttachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == attachmentId && a.TicketId == id && !a.Internal, ct);
        return attachment is null ? Problems.NotFound("Anexo") : await Attachments.DownloadAsync(db, attachment, ct);
    }
}
