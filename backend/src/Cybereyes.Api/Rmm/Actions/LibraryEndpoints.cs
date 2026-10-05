using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Actions;

public sealed record ScriptDto(int Id, string Name, string Description, string Category, string Shell, string? Body,
    IReadOnlyList<string> DefaultArgs, IReadOnlyList<string> EnvVars, int DefaultTimeout, bool RunAsUser, IReadOnlyList<string> Platforms,
    string CreatedBy, DateTimeOffset UpdatedAt);

public sealed record SaveScriptRequest(
    [property: Required, StringLength(255, MinimumLength = 1)] string Name,
    [property: StringLength(1000)] string? Description,
    [property: StringLength(100)] string? Category,
    [property: Required] string Shell,
    [property: Required, StringLength(1_000_000, MinimumLength = 1)] string Body,
    IReadOnlyList<string>? DefaultArgs,
    IReadOnlyList<string>? EnvVars,
    [property: Range(5, 86400)] int DefaultTimeout,
    bool RunAsUser,
    IReadOnlyList<string>? Platforms);

public sealed record SnippetDto(int Id, string Name, string Description, string Shell, string Code);

public sealed record SaveSnippetRequest(
    [property: Required, StringLength(100, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_]+$")] string Name,
    [property: StringLength(1000)] string? Description,
    [property: Required] string Shell,
    [property: Required, StringLength(200_000, MinimumLength = 1)] string Code);

public sealed record KeyDto(int Id, string Name, string Value);

public sealed record SaveKeyRequest(
    [property: Required, StringLength(100, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_]+$")] string Name,
    [property: Required, StringLength(10000)] string Value);

public sealed record UrlActionDto(int Id, string Name, string Description, string Pattern);

public sealed record SaveUrlActionRequest(
    [property: Required, StringLength(100, MinimumLength = 1)] string Name,
    [property: StringLength(1000)] string? Description,
    [property: Required, StringLength(2000, MinimumLength = 1)] string Pattern);

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.ScriptsView);
        var manage = Policies.Permission(Permissions.ScriptsManage);
        var settings = Policies.Permission(Permissions.SettingsManage);

        var scripts = app.MapGroup("/api/scripts").WithTags("Scripts");
        scripts.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok((await db.Scripts.AsNoTracking().OrderBy(s => s.Category).ThenBy(s => s.Name).ToListAsync(ct)).Select(s => ToDto(s, false)).ToList()))
            .RequireAuthorization(view);
        scripts.MapGet("/{id:int}", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            await db.Scripts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct) is { } s ? TypedResults.Ok(ToDto(s, true)) : Problems.NotFound("Script"))
            .RequireAuthorization(view);
        scripts.MapPost("/", CreateScriptAsync).RequireAuthorization(manage);
        scripts.MapPut("/{id:int}", UpdateScriptAsync).RequireAuthorization(manage);
        scripts.MapDelete("/{id:int}", DeleteScriptAsync).RequireAuthorization(manage);

        scripts.MapGet("/snippets", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await db.ScriptSnippets.AsNoTracking().OrderBy(s => s.Name)
                .Select(s => new SnippetDto(s.Id, s.Name, s.Description, s.Shell, s.Code)).ToListAsync(ct))).RequireAuthorization(view);
        scripts.MapPost("/snippets", SaveSnippetAsync).RequireAuthorization(manage);
        scripts.MapPut("/snippets/{id:int}", SaveSnippetAsync).RequireAuthorization(manage);
        scripts.MapDelete("/snippets/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var deleted = await db.ScriptSnippets.Where(s => s.Id == id).ExecuteDeleteAsync(ct);
            if (deleted == 0)
            {
                return Problems.NotFound("Snippet");
            }
            await audit.LogAsync("snippet.deleted", "snippet", Id(id), "Snippet excluido", cancellationToken: ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(manage);

        var keys = app.MapGroup("/api/keystore").WithTags("Configuracoes").RequireAuthorization(settings);
        keys.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await db.GlobalKeys.AsNoTracking().OrderBy(k => k.Name).Select(k => new KeyDto(k.Id, k.Name, k.Value)).ToListAsync(ct)));
        keys.MapPost("/", SaveKeyAsync);
        keys.MapPut("/{id:int}", SaveKeyAsync);
        keys.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var deleted = await db.GlobalKeys.Where(k => k.Id == id).ExecuteDeleteAsync(ct);
            if (deleted == 0)
            {
                return Problems.NotFound("Chave");
            }
            await audit.LogAsync("keystore.deleted", "keystore", Id(id), "Chave global excluida", cancellationToken: ct);
            return TypedResults.NoContent();
        });

        var urls = app.MapGroup("/api/url-actions").WithTags("Configuracoes");
        urls.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await db.UrlActions.AsNoTracking().OrderBy(u => u.Name).Select(u => new UrlActionDto(u.Id, u.Name, u.Description, u.Pattern)).ToListAsync(ct)))
            .RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        urls.MapPost("/", SaveUrlActionAsync).RequireAuthorization(settings);
        urls.MapPut("/{id:int}", SaveUrlActionAsync).RequireAuthorization(settings);
        urls.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            await db.UrlActions.Where(u => u.Id == id).ExecuteDeleteAsync(ct) == 0 ? Problems.NotFound("URL action") : TypedResults.NoContent())
            .RequireAuthorization(settings);
        app.MapGet("/api/agents/{id:int}/url-actions/{actionId:int}", ResolveUrlActionAsync).WithTags("Configuracoes")
            .RequireAuthorization(Policies.Permission(Permissions.AgentsView));
    }

    private static string? ValidateScript(SaveScriptRequest r)
    {
        if (!ScriptShells.All.Contains(r.Shell))
        {
            return $"Shell invalido: use {string.Join(", ", ScriptShells.All)}";
        }
        if ((r.Platforms ?? []).Any(p => !ScriptShells.Platforms.Contains(p)))
        {
            return "Plataforma invalida: use windows, linux ou darwin";
        }
        return null;
    }

    private static void Apply(Script script, SaveScriptRequest r, string user)
    {
        script.Name = r.Name.Trim();
        script.Description = r.Description?.Trim() ?? string.Empty;
        script.Category = r.Category?.Trim() ?? string.Empty;
        script.Shell = r.Shell;
        script.Body = r.Body;
        script.DefaultArgs = [.. r.DefaultArgs ?? []];
        script.EnvVars = [.. r.EnvVars ?? []];
        script.DefaultTimeout = r.DefaultTimeout;
        script.RunAsUser = r.RunAsUser;
        script.Platforms = [.. (r.Platforms ?? []).Distinct(StringComparer.Ordinal)];
        script.CreatedBy = user;
        script.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static async Task<IResult> CreateScriptAsync(SaveScriptRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        IAuditService audit, CancellationToken ct)
    {
        if (ValidateScript(request) is { } error)
        {
            return Problems.BadRequest(error);
        }
        if (await db.Scripts.AnyAsync(s => s.Name == request.Name.Trim(), ct))
        {
            return Problems.Conflict("Ja existe um script com esse nome");
        }

        var script = new Script { Name = request.Name, Shell = request.Shell, Body = request.Body, CreatedBy = string.Empty };
        Apply(script, request, principal.Identity?.Name ?? "?");
        db.Scripts.Add(script);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("script.created", "script", Id(script.Id), $"Script {script.Name} criado", cancellationToken: ct);
        return TypedResults.Created($"/api/scripts/{script.Id}", ToDto(script, true));
    }

    private static async Task<IResult> UpdateScriptAsync(int id, SaveScriptRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        IAuditService audit, CancellationToken ct)
    {
        if (ValidateScript(request) is { } error)
        {
            return Problems.BadRequest(error);
        }
        var script = await db.Scripts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (script is null)
        {
            return Problems.NotFound("Script");
        }
        if (await db.Scripts.AnyAsync(s => s.Name == request.Name.Trim() && s.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um script com esse nome");
        }

        Apply(script, request, principal.Identity?.Name ?? "?");
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("script.updated", "script", Id(id), $"Script {script.Name} alterado", cancellationToken: ct);
        return TypedResults.Ok(ToDto(script, true));
    }

    private static async Task<IResult> DeleteScriptAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var script = await db.Scripts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (script is null)
        {
            return Problems.NotFound("Script");
        }
        db.Scripts.Remove(script);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("script.deleted", "script", Id(id), $"Script {script.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> SaveSnippetAsync(int? id, SaveSnippetRequest request, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (!ScriptShells.All.Contains(request.Shell))
        {
            return Problems.BadRequest("Shell invalido");
        }
        if (await db.ScriptSnippets.AnyAsync(s => s.Name == request.Name && s.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um snippet com esse nome");
        }

        var snippet = id is null ? new ScriptSnippet { Name = request.Name, Shell = request.Shell, Code = request.Code }
            : await db.ScriptSnippets.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (snippet is null)
        {
            return Problems.NotFound("Snippet");
        }
        snippet.Name = request.Name;
        snippet.Description = request.Description?.Trim() ?? string.Empty;
        snippet.Shell = request.Shell;
        snippet.Code = request.Code;
        if (id is null)
        {
            db.ScriptSnippets.Add(snippet);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "snippet.created" : "snippet.updated", "snippet", Id(snippet.Id), $"Snippet {snippet.Name}", cancellationToken: ct);
        var dto = new SnippetDto(snippet.Id, snippet.Name, snippet.Description, snippet.Shell, snippet.Code);
        return id is null ? TypedResults.Created($"/api/scripts/snippets/{snippet.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> SaveKeyAsync(int? id, SaveKeyRequest request, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (await db.GlobalKeys.AnyAsync(k => k.Name == request.Name && k.Id != id, ct))
        {
            return Problems.Conflict("Ja existe uma chave com esse nome");
        }
        var key = id is null ? new GlobalKey { Name = request.Name, Value = request.Value } : await db.GlobalKeys.FirstOrDefaultAsync(k => k.Id == id, ct);
        if (key is null)
        {
            return Problems.NotFound("Chave");
        }
        key.Name = request.Name;
        key.Value = request.Value;
        if (id is null)
        {
            db.GlobalKeys.Add(key);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "keystore.created" : "keystore.updated", "keystore", Id(key.Id), $"Chave global {key.Name}", cancellationToken: ct);
        var dto = new KeyDto(key.Id, key.Name, key.Value);
        return id is null ? TypedResults.Created($"/api/keystore/{key.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> SaveUrlActionAsync(int? id, SaveUrlActionRequest request, CybereyesDbContext db, CancellationToken ct)
    {
        if (!request.Pattern.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !request.Pattern.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.BadRequest("O endereco precisa comecar com http:// ou https://");
        }
        if (await db.UrlActions.AnyAsync(u => u.Name == request.Name.Trim() && u.Id != id, ct))
        {
            return Problems.Conflict("Ja existe uma URL action com esse nome");
        }
        var action = id is null ? new UrlAction { Name = request.Name, Pattern = request.Pattern } : await db.UrlActions.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (action is null)
        {
            return Problems.NotFound("URL action");
        }
        action.Name = request.Name.Trim();
        action.Description = request.Description?.Trim() ?? string.Empty;
        action.Pattern = request.Pattern.Trim();
        if (id is null)
        {
            db.UrlActions.Add(action);
        }
        await db.SaveChangesAsync(ct);
        var dto = new UrlActionDto(action.Id, action.Name, action.Description, action.Pattern);
        return id is null ? TypedResults.Created($"/api/url-actions/{action.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> ResolveUrlActionAsync(int id, int actionId, CybereyesDbContext db, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        var action = await db.UrlActions.AsNoTracking().FirstOrDefaultAsync(u => u.Id == actionId, ct);
        if (agent is null || action is null)
        {
            return Problems.NotFound(agent is null ? "Agente" : "URL action");
        }
        var resolve = await Variables.ResolverAsync(db, agent, urlEncode: true, ct);
        return TypedResults.Ok(new { url = resolve(action.Pattern) });
    }

    private static ScriptDto ToDto(Script s, bool withBody) => new(s.Id, s.Name, s.Description, s.Category, s.Shell, withBody ? s.Body : null,
        s.DefaultArgs, s.EnvVars, s.DefaultTimeout, s.RunAsUser, s.Platforms, s.CreatedBy, s.UpdatedAt);

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
