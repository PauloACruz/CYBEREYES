using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Assistant;

/// <summary>
/// Entrada do FAQ. Status nulo publica (quem tem docs.manage) ou mantem o atual; quem so tem docs.view sempre cria uma sugestao.
/// Public nulo mantem o atual (ou falso ao criar). A resposta so e obrigatoria para publicar.
/// </summary>
public sealed record SaveFaqRequest(
    int? ClientId,
    [property: Required, StringLength(300, MinimumLength = 3)] string Question,
    [property: StringLength(20000)] string? Answer,
    List<string>? Tags,
    bool Enabled = true,
    [property: StringLength(80)] string? Category = null,
    string? Status = null,
    bool? Public = null,
    int? SourceTicketId = null);

public sealed record FaqDto(int Id, int? ClientId, string? ClientName, string Question, string Answer, string? Category, IReadOnlyList<string> Tags,
    bool Enabled, bool Guides, string Status, bool Public, string Source, int? SourceTicketId, string? SuggestedBy, int Views, int HelpfulCount,
    int NotHelpfulCount, int UsedCount, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string UpdatedBy);

public sealed record FaqCategoryDto(string Name, int Count);

/// <summary>Pedido de rascunho ao assistente: a pergunta, um contexto livre e/ou o chamado de onde tirar a solucao.</summary>
public sealed record FaqDraftRequest([property: StringLength(300)] string? Question, [property: StringLength(20000)] string? Context, int? TicketId);

public static class FaqEndpoints
{
    public static void MapFaqEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.DocsView);
        var manage = Policies.Permission(Permissions.DocsManage);
        var faq = app.MapGroup("/api/faq").WithTags("FAQ");
        faq.MapGet("/", ListAsync).RequireAuthorization(view);
        faq.MapGet("/overview", OverviewAsync).RequireAuthorization(view);
        faq.MapGet("/{id:int}", GetAsync).RequireAuthorization(view);
        faq.MapPost("/", (SaveFaqRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService a, TimeProvider t, CancellationToken ct) =>
            SaveAsync(null, r, p, db, a, t, ct)).RequireAuthorization(view);
        faq.MapPut("/{id:int}", (int id, SaveFaqRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService a, TimeProvider t, CancellationToken ct) =>
            SaveAsync(id, r, p, db, a, t, ct)).RequireAuthorization(manage);
        faq.MapDelete("/{id:int}", DeleteAsync).RequireAuthorization(manage);
        faq.MapPost("/{id:int}/used", UsedAsync).RequireAuthorization(view);
        faq.MapPost("/draft", DraftAsync).RequireAuthorization(manage);
    }

    /// <summary>Tags em minusculas, sem repeticao, ate 20 de ate 40 caracteres.</summary>
    public static List<string> NormalizeTags(IEnumerable<string>? tags) =>
        (tags ?? []).Select(t => t.Trim().ToLowerInvariant()).Where(t => t.Length is > 0 and <= 40).Distinct(StringComparer.Ordinal).Take(20).ToList();

    /// <summary>Categoria sem espacos repetidos; reaproveita a grafia de uma categoria que ja existe (sem diferenciar maiusculas).</summary>
    public static async Task<string?> NormalizeCategoryAsync(CybereyesDbContext db, string? category, CancellationToken ct)
    {
        var clean = string.Join(' ', (category ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (clean.Length == 0)
        {
            return null;
        }
        clean = clean.Length <= 80 ? clean : clean[..80].TrimEnd();
        var existing = await db.FaqEntries.AsNoTracking().Where(f => f.Category != null).Select(f => f.Category!).Distinct().ToListAsync(ct);
        return existing.FirstOrDefault(c => string.Equals(c, clean, StringComparison.OrdinalIgnoreCase)) ?? clean;
    }

    private static async Task<IResult> ListAsync(int? clientId, string? search, string? tag, string? category, bool? uncategorized, string? status,
        bool? @public, CybereyesDbContext db, CancellationToken ct)
    {
        var query = db.FaqEntries.AsNoTracking();
        if (clientId is { } c)
        {
            query = query.Where(f => f.ClientId == null || f.ClientId == c);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = Logs.LogEndpoints.Like(search.Trim());
            query = query.Where(f => EF.Functions.ILike(f.Question, pattern) || EF.Functions.ILike(f.Answer, pattern) ||
                (f.Category != null && EF.Functions.ILike(f.Category, pattern)));
        }
        if (!string.IsNullOrWhiteSpace(tag))
        {
            var t = tag.Trim().ToLowerInvariant();
            query = query.Where(f => f.Tags.Contains(t));
        }
        if (!string.IsNullOrWhiteSpace(category))
        {
            var name = category.Trim();
            query = query.Where(f => f.Category == name);
        }
        else if (uncategorized == true)
        {
            query = query.Where(f => f.Category == null);
        }
        if (FaqStatus.All.Contains(status))
        {
            query = query.Where(f => f.Status == status);
        }
        if (@public is { } p)
        {
            query = query.Where(f => f.Public == p);
        }
        var ordered = status == FaqStatus.Proposed ? query.OrderByDescending(f => f.CreatedAt) : query.OrderBy(f => f.Question);
        var rows = await (
            from f in ordered
            join cl in db.Clients on f.ClientId equals cl.Id into cg
            from cl in cg.DefaultIfEmpty()
            select new { F = f, ClientName = cl == null ? null : cl.Name }).Take(500).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(x => ToDto(x.F, x.ClientName)));
    }

    /// <summary>Categorias das entradas publicadas, quantas sugestoes aguardam revisao e se o assistente pode escrever rascunhos.</summary>
    private static async Task<IResult> OverviewAsync(int? clientId, CybereyesDbContext db, CancellationToken ct)
    {
        var query = db.FaqEntries.AsNoTracking();
        if (clientId is { } c)
        {
            query = query.Where(f => f.ClientId == null || f.ClientId == c);
        }
        var categories = await query.Where(f => f.Status == FaqStatus.Published).GroupBy(f => f.Category)
            .Select(g => new { Name = g.Key, Count = g.Count() }).ToListAsync(ct);
        var all = await query.Where(f => f.Category != null).Select(f => f.Category!).Distinct().ToListAsync(ct);
        var proposed = await query.CountAsync(f => f.Status == FaqStatus.Proposed, ct);
        var published = categories.Sum(x => x.Count);
        var settings = await SettingsStore.GetAsync(db, ct);
        return TypedResults.Ok(new
        {
            published,
            proposed,
            uncategorized = categories.FirstOrDefault(x => x.Name is null)?.Count ?? 0,
            categories = categories.Where(x => x.Name is not null).OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(x => new FaqCategoryDto(x.Name!, x.Count)),
            allCategories = all.Order(StringComparer.CurrentCultureIgnoreCase),
            assistant = settings.AnthropicKeyProtected is not null && AssistantProfiles.AnyAgentEnabled(settings),
        });
    }

    private static async Task<IResult> GetAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var row = await (
            from f in db.FaqEntries.AsNoTracking()
            where f.Id == id
            join cl in db.Clients on f.ClientId equals cl.Id into cg
            from cl in cg.DefaultIfEmpty()
            select new { F = f, ClientName = cl == null ? null : cl.Name }).FirstOrDefaultAsync(ct);
        return row is null ? Problems.NotFound("Entrada do FAQ") : TypedResults.Ok(ToDto(row.F, row.ClientName));
    }

    public static FaqDto ToDto(FaqEntry f, string? clientName) =>
        new(f.Id, f.ClientId, clientName, f.Question, f.Answer, f.Category, f.Tags, f.Enabled, f.Guides, f.Status, f.Public, f.Source, f.SourceTicketId,
            f.SuggestedBy, f.Views, f.HelpfulCount, f.NotHelpfulCount, f.UsedCount, f.CreatedAt, f.UpdatedAt, f.UpdatedBy);

    private static async Task<IResult> SaveAsync(int? id, SaveFaqRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if (r.Status is not null && !FaqStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Situacao invalida");
        }
        var canPublish = principal.HasPermission(Permissions.DocsManage);
        string? clientName = null;
        if (r.ClientId is { } clientId)
        {
            clientName = await db.Clients.AsNoTracking().Where(c => c.Id == clientId).Select(c => c.Name).FirstOrDefaultAsync(ct);
            if (clientName is null)
            {
                return Problems.Validation("clientId", "Cliente nao encontrado");
            }
        }
        else if (db.IsClientRestricted)
        {
            return Problems.Validation("clientId", "Escolha um dos seus clientes; entradas para todos os clientes exigem acesso a todos eles");
        }
        if (r.SourceTicketId is { } ticketId && !await db.Tickets.AnyAsync(t => t.Id == ticketId, ct))
        {
            return Problems.Validation("sourceTicketId", "Chamado nao encontrado");
        }
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        var now = time.GetUtcNow();
        FaqEntry entry;
        string previousStatus;
        if (id is null)
        {
            entry = new FaqEntry
            {
                Question = r.Question.Trim(), UpdatedBy = actor, CreatedAt = now, Source = FaqSource.Team, Public = r.Public ?? false,
                SourceTicketId = r.SourceTicketId,
                Status = canPublish ? r.Status ?? FaqStatus.Published : FaqStatus.Proposed,
            };
            if (entry.Status == FaqStatus.Proposed)
            {
                entry.SuggestedBy = actor;
            }
            previousStatus = entry.Status;
            db.FaqEntries.Add(entry);
        }
        else
        {
            var found = await db.FaqEntries.FirstOrDefaultAsync(f => f.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Entrada do FAQ");
            }
            if (found.ClientId is null && db.IsClientRestricted)
            {
                return Problems.Forbidden("Entradas para todos os clientes exigem acesso a todos eles");
            }
            entry = found;
            previousStatus = entry.Status;
            entry.Status = r.Status ?? entry.Status;
            entry.Public = r.Public ?? entry.Public;
            entry.SourceTicketId = r.SourceTicketId ?? entry.SourceTicketId;
        }
        var answer = r.Answer?.Trim() ?? string.Empty;
        if (entry.Status == FaqStatus.Published && answer.Length == 0)
        {
            return Problems.Validation("answer", "Escreva a resposta antes de publicar");
        }
        entry.ClientId = r.ClientId;
        entry.Question = r.Question.Trim();
        entry.Answer = answer;
        entry.Category = await NormalizeCategoryAsync(db, r.Category, ct);
        entry.Tags = NormalizeTags(r.Tags);
        entry.Enabled = r.Enabled;
        entry.UpdatedAt = now;
        entry.UpdatedBy = actor;
        await db.SaveChangesAsync(ct);
        var action = id is null
            ? entry.Status == FaqStatus.Proposed ? "faq.suggest" : "faq.create"
            : previousStatus == FaqStatus.Proposed && entry.Status == FaqStatus.Published ? "faq.publish" : "faq.update";
        await audit.LogAsync(action, "faq", entry.Id.ToString(CultureInfo.InvariantCulture), $"FAQ {entry.Question}", cancellationToken: ct);
        var dto = ToDto(entry, clientName);
        return id is null ? TypedResults.Created($"/api/faq/{entry.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> DeleteAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var entry = await db.FaqEntries.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (entry is null)
        {
            return Problems.NotFound("Entrada do FAQ");
        }
        if (entry.ClientId is null && db.IsClientRestricted)
        {
            return Problems.Forbidden("Entradas para todos os clientes exigem acesso a todos eles");
        }
        db.FaqEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(entry.Status == FaqStatus.Proposed ? "faq.discard" : "faq.delete", "faq", id.ToString(CultureInfo.InvariantCulture),
            $"FAQ {entry.Question}", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    /// <summary>Um tecnico inseriu a resposta numa conversa: conta como uso da entrada.</summary>
    private static async Task<IResult> UsedAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var updated = await db.FaqEntries.Where(f => f.Id == id && f.Status == FaqStatus.Published)
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.UsedCount, f => f.UsedCount + 1), ct);
        return updated == 0 ? Problems.NotFound("Entrada do FAQ") : TypedResults.NoContent();
    }

    private static async Task<IResult> DraftAsync(FaqDraftRequest r, CybereyesDbContext db, FaqWriter writer, IDataProtectionProvider protection,
        CancellationToken ct)
    {
        var question = r.Question?.Trim();
        if (string.IsNullOrEmpty(question) && r.TicketId is null)
        {
            return Problems.Validation("question", "Informe a pergunta ou o chamado");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        if (AssistantKey.Read(settings, protection) is not { } apiKey)
        {
            return Problems.BadRequest("Cadastre a chave da API da Anthropic em Configurações para o assistente escrever rascunhos");
        }
        if (!AssistantProfiles.AnyAgentEnabled(settings))
        {
            return Problems.BadRequest("Ative o agente nativo ou o agente da Anthropic em Configurações para o assistente escrever rascunhos");
        }
        FaqTicketContext? ticket = null;
        if (r.TicketId is { } ticketId)
        {
            ticket = await writer.TicketContextAsync(ticketId, ct);
            if (ticket is null)
            {
                return Problems.NotFound("Chamado");
            }
        }
        try
        {
            var draft = await writer.DraftAsync(apiKey, settings, question, r.Context?.Trim(), ticket, ct);
            return TypedResults.Ok(draft);
        }
        catch (AssistantException ex)
        {
            return Problems.Create(StatusCodes.Status502BadGateway, ex.Message, ErrorCodes.Internal);
        }
    }
}
