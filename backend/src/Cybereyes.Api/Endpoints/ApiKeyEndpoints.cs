using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

public static class ApiKeyEndpoints
{
    public static void MapApiKeyEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/apikeys").WithTags("Chaves de API").RequireAuthorization(Policies.Permission(Permissions.ApiKeysManage));

        group.MapGet("/", ListAsync);
        group.MapPost("/", CreateAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var keys = await db.ApiKeys.AsNoTracking()
            .OrderByDescending(k => k.CreatedAt)
            .Select(k => new ApiKeyDto(k.Id, k.Name, k.Prefix, k.User!.UserName!, k.ExpiresAt, k.CreatedAt, k.LastUsedAt))
            .ToListAsync(ct);
        return TypedResults.Ok(keys);
    }

    private static async Task<IResult> CreateAsync(CreateApiKeyRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (request.ExpiresAt is { } expires && expires <= time.GetUtcNow())
        {
            return Problems.Validation("expiresAt", "A data de expiracao precisa estar no futuro");
        }
        if (principal.UserId() is not { } userId)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }

        var ownerId = userId;
        var ownerName = principal.Identity?.Name ?? string.Empty;
        if (request.UserId is { } target && target != userId)
        {
            // A chave age com as permissoes do dono: so quem ja pode tudo cria chave para outra pessoa.
            if (!principal.IsSuperuser())
            {
                return Problems.Forbidden("Somente superusuarios criam chaves para outro usuario");
            }
            var owner = await db.Users.AsNoTracking().Where(u => u.Id == target).Select(u => new { u.UserName, u.IsActive }).FirstOrDefaultAsync(ct);
            if (owner is null || !owner.IsActive)
            {
                return Problems.Validation("userId", "Usuario inexistente ou inativo");
            }
            ownerId = target;
            ownerName = owner.UserName ?? string.Empty;
        }

        var (key, prefix, hash) = ApiKeyGenerator.Create();
        var apiKey = new ApiKey { Name = request.Name.Trim(), Prefix = prefix, KeyHash = hash, UserId = ownerId, ExpiresAt = request.ExpiresAt?.ToUniversalTime() };
        db.ApiKeys.Add(apiKey);
        await db.SaveChangesAsync(ct);

        await audit.LogAsync("apikey.created", "apikey", apiKey.Id.ToString(),
            ownerId == userId ? $"Chave {apiKey.Name} criada" : $"Chave {apiKey.Name} criada para {ownerName}", cancellationToken: ct);
        return TypedResults.Created($"/api/apikeys/{apiKey.Id}", new CreatedApiKeyDto(apiKey.Id, apiKey.Name, apiKey.Prefix,
            ownerName, apiKey.ExpiresAt, apiKey.CreatedAt, apiKey.LastUsedAt, key));
    }

    private static async Task<IResult> DeleteAsync(Guid id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == id, ct);
        if (key is null)
        {
            return Problems.NotFound("Chave de API");
        }

        db.ApiKeys.Remove(key);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("apikey.deleted", "apikey", id.ToString(), $"Chave {key.Name} revogada", cancellationToken: ct);
        return TypedResults.NoContent();
    }
}
