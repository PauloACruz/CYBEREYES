using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm;

/// <summary>
/// Autentica o agente Go pelo cabecalho "Authorization: Token &lt;token&gt;", que serve tanto para o token
/// do agente quanto para o token de instalacao, no mesmo formato usado pelo Tactical RMM.
/// </summary>
public sealed class AgentTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    WinCareDbContext db,
    TimeProvider timeProvider)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Prefix = "Token ";

    public static bool HasTokenHeader(HttpRequest request) =>
        request.Headers.Authorization.ToString().StartsWith(Prefix, StringComparison.OrdinalIgnoreCase);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        var parts = header.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || !parts[0].Equals("Token", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var hash = AgentSecrets.Hash(parts[1]);
        var agent = await db.Agents.AsNoTracking()
            .Where(a => a.TokenHash == hash)
            .Select(a => new { a.Id, a.AgentId })
            .FirstOrDefaultAsync(Context.RequestAborted);
        if (agent is not null)
        {
            return Success(
                new Claim(WinCareClaims.AgentPk, agent.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Claim(WinCareClaims.AgentIdentifier, agent.AgentId),
                new Claim(ClaimTypes.Name, $"agent:{agent.AgentId}"));
        }

        var now = timeProvider.GetUtcNow();
        var installer = await db.InstallerTokens.AsNoTracking()
            .Where(t => t.TokenHash == hash && t.ExpiresAt > now)
            .Select(t => new { t.Id, t.CreatedBy })
            .FirstOrDefaultAsync(Context.RequestAborted);
        if (installer is not null)
        {
            return Success(
                new Claim(WinCareClaims.Installer, installer.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Claim(ClaimTypes.Name, installer.CreatedBy));
        }

        return AuthenticateResult.Fail("Token invalido ou expirado");
    }

    private AuthenticateResult Success(params Claim[] claims) =>
        AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name));
}
