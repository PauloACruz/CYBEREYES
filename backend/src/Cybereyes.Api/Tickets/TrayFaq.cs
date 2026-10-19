using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Tickets;

public sealed record TrayFaqFeedbackRequest(bool Helpful);

public sealed record TrayFaqSuggestionRequest([property: Required, StringLength(300, MinimumLength = 3)] string Question);

public sealed record TrayFaqItemDto(int Id, string Question, string? Category, string Excerpt);

public sealed record TrayFaqEntryDto(int Id, string Question, string Answer, string? Category, DateTimeOffset UpdatedAt);

/// <summary>
/// Ajuda do app EYES: o usuario consulta as entradas publicadas e marcadas para o app (as gerais e as do cliente da maquina),
/// diz se a resposta resolveu e sugere perguntas que a equipe responde.
/// </summary>
public static class TrayFaq
{
    /// <summary>Sugestoes por usuario e maquina numa hora.</summary>
    public const int MaxSuggestionsPerHour = 5;

    private const int ExcerptLength = 160;

    public static void Map(RouteGroupBuilder tray)
    {
        tray.MapGet("/faq", ListAsync);
        tray.MapGet("/faq/{id:int}", GetAsync);
        tray.MapPost("/faq/{id:int}/feedback", FeedbackAsync);
        tray.MapPost("/faq/suggestions", SuggestAsync);
    }

    /// <summary>Entradas que o usuario desta maquina pode ver.</summary>
    public static IQueryable<FaqEntry> Visible(CybereyesDbContext db, int? clientId) =>
        db.FaqEntries.Where(f => f.Status == FaqStatus.Published && f.Enabled && f.Public && (f.ClientId == null || f.ClientId == clientId));

    public static Task<int?> ClientIdAsync(CybereyesDbContext db, int agentId, CancellationToken ct) =>
        db.Agents.AsNoTracking().Where(a => a.Id == agentId).Select(a => (int?)a.Site!.ClientId).FirstOrDefaultAsync(ct);

    private static string Excerpt(string answer)
    {
        var flat = string.Join(' ', answer.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return flat.Length <= ExcerptLength ? flat : flat[..ExcerptLength].TrimEnd() + "…";
    }

    private static async Task<IResult> ListAsync(string? search, string? category, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Tray.Session(principal)!;
        var visible = Visible(db, await ClientIdAsync(db, s.AgentId, ct)).AsNoTracking();
        var categories = await visible.Where(f => f.Category != null).Select(f => f.Category!).Distinct().ToListAsync(ct);
        var query = visible;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = Logs.LogEndpoints.Like(search.Trim());
            query = query.Where(f => EF.Functions.ILike(f.Question, pattern) || EF.Functions.ILike(f.Answer, pattern) ||
                (f.Category != null && EF.Functions.ILike(f.Category, pattern)));
        }
        if (!string.IsNullOrWhiteSpace(category))
        {
            var name = category.Trim();
            query = query.Where(f => f.Category == name);
        }
        // As mais uteis primeiro: as que mais ajudaram e as mais abertas.
        var rows = await query.OrderByDescending(f => f.HelpfulCount - f.NotHelpfulCount).ThenByDescending(f => f.Views).ThenBy(f => f.Question)
            .Take(100).Select(f => new { f.Id, f.Question, f.Category, f.Answer }).ToListAsync(ct);
        return TypedResults.Ok(new
        {
            categories = categories.Order(StringComparer.CurrentCultureIgnoreCase),
            entries = rows.Select(r => new TrayFaqItemDto(r.Id, r.Question, r.Category, Excerpt(r.Answer))),
        });
    }

    private static async Task<IResult> GetAsync(int id, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Tray.Session(principal)!;
        var visible = Visible(db, await ClientIdAsync(db, s.AgentId, ct)).Where(f => f.Id == id);
        var entry = await visible.AsNoTracking().Select(f => new TrayFaqEntryDto(f.Id, f.Question, f.Answer, f.Category, f.UpdatedAt)).FirstOrDefaultAsync(ct);
        if (entry is null)
        {
            return Problems.NotFound("Pergunta");
        }
        await visible.ExecuteUpdateAsync(x => x.SetProperty(f => f.Views, f => f.Views + 1), ct);
        return TypedResults.Ok(entry);
    }

    private static async Task<IResult> FeedbackAsync(int id, TrayFaqFeedbackRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var s = Tray.Session(principal)!;
        var visible = Visible(db, await ClientIdAsync(db, s.AgentId, ct)).Where(f => f.Id == id);
        var updated = r.Helpful
            ? await visible.ExecuteUpdateAsync(x => x.SetProperty(f => f.HelpfulCount, f => f.HelpfulCount + 1), ct)
            : await visible.ExecuteUpdateAsync(x => x.SetProperty(f => f.NotHelpfulCount, f => f.NotHelpfulCount + 1), ct);
        return updated == 0 ? Problems.NotFound("Pergunta") : TypedResults.NoContent();
    }

    /// <summary>Pergunta do usuario sem resposta ainda: vira uma sugestao do cliente da maquina para a equipe responder.</summary>
    private static async Task<IResult> SuggestAsync(TrayFaqSuggestionRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time,
        CancellationToken ct)
    {
        var s = Tray.Session(principal)!;
        var question = string.Join(' ', r.Question.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (question.Length < 3)
        {
            return Problems.Validation("question", "Escreva a pergunta");
        }
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == s.AgentId).Select(a => new { a.Hostname, a.Site!.ClientId }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var by = $"{s.Username} em {agent.Hostname}";
        var now = time.GetUtcNow();
        var hourAgo = now.AddHours(-1);
        if (await db.FaqEntries.CountAsync(f => f.Source == FaqSource.Requester && f.SuggestedBy == by && f.CreatedAt >= hourAgo, ct) >= MaxSuggestionsPerHour)
        {
            return Problems.Create(StatusCodes.Status429TooManyRequests, "Voce ja enviou varias perguntas agora ha pouco. Tente mais tarde.", ErrorCodes.RateLimited);
        }
        var entry = new FaqEntry
        {
            ClientId = agent.ClientId,
            Question = question,
            Status = FaqStatus.Proposed,
            Source = FaqSource.Requester,
            SuggestedBy = by,
            CreatedAt = now,
            UpdatedAt = now,
            UpdatedBy = by,
        };
        db.FaqEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/tray/faq/suggestions/{entry.Id.ToString(CultureInfo.InvariantCulture)}", new { entry.Id });
    }
}
