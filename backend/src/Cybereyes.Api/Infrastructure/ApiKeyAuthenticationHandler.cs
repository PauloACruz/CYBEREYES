using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Infrastructure;

public sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    CybereyesDbContext db,
    TimeProvider timeProvider)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string HeaderName = "X-API-KEY";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(HeaderName, out var values) || string.IsNullOrWhiteSpace(values.ToString()))
        {
            return AuthenticateResult.NoResult();
        }

        var hash = ApiKeyGenerator.Hash(values.ToString().Trim());
        var key = await db.ApiKeys.Include(k => k.User).FirstOrDefaultAsync(k => k.KeyHash == hash, Context.RequestAborted);
        var now = timeProvider.GetUtcNow();
        if (key?.User is null || !key.User.IsActive || (key.ExpiresAt is { } expires && expires <= now))
        {
            return AuthenticateResult.Fail("Chave de API invalida");
        }

        if (key.LastUsedAt is null || now - key.LastUsedAt > TimeSpan.FromMinutes(1))
        {
            key.LastUsedAt = now;
            await db.SaveChangesAsync(Context.RequestAborted);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, key.UserId.ToString()),
            new Claim(ClaimTypes.Name, key.User.UserName ?? string.Empty),
        ], Scheme.Name);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }
}
