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
    Assistant.AgentRunTokens runTokens,
    TimeProvider timeProvider)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string HeaderName = "X-API-KEY";
    public const string BearerPrefix = "Bearer ";

    /// <summary>A chave tambem vale como "Authorization: Bearer", formato que clientes MCP (agentes da Anthropic) enviam.</summary>
    public static bool Matches(HttpRequest request) =>
        request.Headers.ContainsKey(HeaderName) || request.Headers.Authorization.ToString().StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorization = Request.Headers.Authorization.ToString();
        var value = Request.Headers.TryGetValue(HeaderName, out var values)
            ? values.ToString()
            : authorization.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase) ? authorization[BearerPrefix.Length..] : string.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return AuthenticateResult.NoResult();
        }
        // Credencial de uma execucao do agente de IA no console: tecnico que pediu + agente que executa.
        if (Assistant.AgentRunTokens.IsRunToken(value.Trim()))
        {
            return runTokens.Authenticate(value.Trim(), Scheme.Name) is { } run
                ? AuthenticateResult.Success(new AuthenticationTicket(run, Scheme.Name))
                : AuthenticateResult.Fail("Execucao do agente encerrada");
        }

        var hash = ApiKeyGenerator.Hash(value.Trim());
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
