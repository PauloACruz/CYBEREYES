using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Sso;

public sealed record SaveOidcProvider(
    [property: Required, StringLength(100, MinimumLength = 1)] string Name,
    [property: Required, StringLength(500)] string Authority,
    [property: Required, StringLength(255, MinimumLength = 1)] string ClientId,
    [property: StringLength(1000)] string? ClientSecret,
    [property: StringLength(500)] string? Scopes,
    [property: StringLength(100)] string? UsernameClaim,
    bool LinkByEmail,
    bool AutoProvision,
    Guid? DefaultRoleId,
    List<string>? AllowedDomains,
    bool TrustProviderMfa,
    bool Enabled);

public sealed record OidcProviderDto(int Id, string Name, string Authority, string ClientId, bool HasClientSecret, string Scopes, string UsernameClaim,
    bool LinkByEmail, bool AutoProvision, Guid? DefaultRoleId, List<string> AllowedDomains, bool TrustProviderMfa, bool Enabled, string RedirectUri,
    int UserCount);

public sealed record SsoSettingsDto(bool DisablePasswordLogin);

public sealed record AuthorityRequest([property: Required] string Authority);

public static partial class SsoEndpoints
{
    public static void MapSsoEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth/sso").WithTags("Autenticacao").AllowAnonymous();
        auth.MapGet("/providers", async (CybereyesDbContext db, CancellationToken ct) =>
        {
            var providers = await db.OidcProviders.AsNoTracking().Where(p => p.Enabled).OrderBy(p => p.Name).Select(p => new { p.Id, p.Name }).ToListAsync(ct);
            var settings = await SettingsStore.GetAsync(db, ct);
            return TypedResults.Ok(new { providers, passwordLoginEnabled = !settings.DisablePasswordLogin });
        });
        auth.MapGet("/{id:int}/start", StartAsync).RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        auth.MapGet("/callback", CallbackAsync).RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);

        var manage = Policies.Permission(Permissions.SettingsManage);
        var g = app.MapGroup("/api/sso").WithTags("SSO").RequireAuthorization(manage);
        g.MapGet("/providers", async (CybereyesDbContext db, SsoService svc, CancellationToken ct) =>
        {
            var list = await db.OidcProviders.AsNoTracking().OrderBy(p => p.Name).ToListAsync(ct);
            var counts = await db.UserLogins.Where(l => l.LoginProvider.StartsWith("oidc:")).GroupBy(l => l.LoginProvider)
                .Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            return TypedResults.Ok(list.Select(p => ToDto(p, svc.RedirectUri, counts.GetValueOrDefault(p.LoginProvider))));
        });
        g.MapPost("/providers", (SaveOidcProvider r, CybereyesDbContext db, Vault vault, SsoService svc, IAuditService audit, CancellationToken ct) =>
            SaveAsync(null, r, db, vault, svc, audit, ct));
        g.MapPut("/providers/{id:int}", (int id, SaveOidcProvider r, CybereyesDbContext db, Vault vault, SsoService svc, IAuditService audit, CancellationToken ct) =>
            SaveAsync(id, r, db, vault, svc, audit, ct));
        g.MapDelete("/providers/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var provider = await db.OidcProviders.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (provider is null)
            {
                return Problems.NotFound("Provedor");
            }
            await db.UserLogins.Where(l => l.LoginProvider == provider.LoginProvider).ExecuteDeleteAsync(ct);
            db.OidcProviders.Remove(provider);
            await db.SaveChangesAsync(ct);
            await audit.LogAsync("sso.provider.deleted", "oidc_provider", id.ToString(CultureInfo.InvariantCulture), $"Provedor {provider.Name} excluido", cancellationToken: ct);
            return TypedResults.NoContent();
        });
        g.MapPost("/providers/test", async (AuthorityRequest r, SsoService svc, CancellationToken ct) =>
        {
            if (!SsoService.IsAllowedAuthority(r.Authority))
            {
                return Problems.Validation("authority", "Use uma URL https (http so para localhost)");
            }
            try
            {
                var d = await svc.DiscoverAsync(r.Authority, ct);
                return Results.Ok(new { ok = true, issuer = d.Issuer, authorizationEndpoint = d.AuthorizationEndpoint, error = (string?)null });
            }
            catch (Exception ex) when (ex is InvalidOperationException or IOException or HttpRequestException or TaskCanceledException)
            {
                return Results.Ok(new { ok = false, issuer = (string?)null, authorizationEndpoint = (string?)null, error = (string?)(ex.InnerException?.Message ?? ex.Message) });
            }
        });
        g.MapGet("/settings", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(new SsoSettingsDto((await SettingsStore.GetAsync(db, ct)).DisablePasswordLogin)));
        g.MapPut("/settings", async (SsoSettingsDto r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var s = await SettingsStore.GetAsync(db, ct);
            s.DisablePasswordLogin = r.DisablePasswordLogin;
            await db.SaveChangesAsync(ct);
            await audit.LogAsync("sso.settings", "settings", null, $"Login por senha {(r.DisablePasswordLogin ? "desativado (exceto superusuarios)" : "ativo")}", cancellationToken: ct);
            return TypedResults.Ok(r);
        });

        app.MapDelete("/api/users/{id:guid}/sso/{providerId:int}", async (Guid id, int providerId, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var key = $"oidc:{providerId}";
            var removed = await db.UserLogins.Where(l => l.UserId == id && l.LoginProvider == key).ExecuteDeleteAsync(ct);
            if (removed == 0)
            {
                return Problems.NotFound("Vinculo");
            }
            await audit.LogAsync("auth.sso.unlinked", "user", id.ToString(), $"Vinculo com o provedor {providerId} removido", cancellationToken: ct);
            return TypedResults.NoContent();
        }).WithTags("Usuarios").RequireAuthorization(Policies.Permission(Permissions.UsersManage));
    }

    private static OidcProviderDto ToDto(OidcProvider p, string redirectUri, int userCount) => new(p.Id, p.Name, p.Authority, p.ClientId,
        p.ClientSecretEncrypted is not null, p.Scopes, p.UsernameClaim, p.LinkByEmail, p.AutoProvision, p.DefaultRoleId, p.AllowedDomains,
        p.TrustProviderMfa, p.Enabled, redirectUri, userCount);

    private static async Task<IResult> SaveAsync(int? id, SaveOidcProvider r, CybereyesDbContext db, Vault vault, SsoService svc, IAuditService audit,
        CancellationToken ct)
    {
        var authority = r.Authority.Trim().TrimEnd('/');
        if (!SsoService.IsAllowedAuthority(authority))
        {
            return Problems.Validation("authority", "Use uma URL https (http so para localhost)");
        }
        var scopes = string.IsNullOrWhiteSpace(r.Scopes) ? "openid profile email" : string.Join(' ', r.Scopes.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (!scopes.Split(' ').Contains("openid"))
        {
            return Problems.Validation("scopes", "Inclua o escopo openid");
        }
        if (r.DefaultRoleId is { } roleId && !await db.Roles.AnyAsync(x => x.Id == roleId, ct))
        {
            return Problems.Validation("defaultRoleId", "Papel nao encontrado");
        }
        if (r.AutoProvision && r.DefaultRoleId is null)
        {
            return Problems.Validation("defaultRoleId", "Escolha o papel dos usuarios criados automaticamente");
        }
        var domains = (r.AllowedDomains ?? []).Select(d => d.Trim().TrimStart('@').ToLowerInvariant()).Where(d => d.Length > 0).Distinct().ToList();
        if (domains.Count > 20 || domains.Any(d => d.Length > 200 || !d.Contains('.', StringComparison.Ordinal)))
        {
            return Problems.Validation("allowedDomains", "Informe ate 20 dominios validos (ex.: empresa.com.br)");
        }
        if (await db.OidcProviders.AnyAsync(p => p.Name == r.Name.Trim() && p.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um provedor com esse nome");
        }
        var provider = id is null ? new OidcProvider { Name = r.Name, Authority = authority, ClientId = r.ClientId }
            : await db.OidcProviders.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (provider is null)
        {
            return Problems.NotFound("Provedor");
        }
        if (!string.IsNullOrEmpty(r.ClientSecret))
        {
            if (!vault.Enabled)
            {
                return Problems.BadRequest("O cofre esta sem chave (VAULT_KEY); nao e possivel guardar o segredo do cliente");
            }
            provider.ClientSecretEncrypted = vault.Encrypt(r.ClientSecret);
        }
        provider.Name = r.Name.Trim();
        provider.Authority = authority;
        provider.ClientId = r.ClientId.Trim();
        provider.Scopes = scopes;
        provider.UsernameClaim = string.IsNullOrWhiteSpace(r.UsernameClaim) ? "preferred_username" : r.UsernameClaim.Trim();
        provider.LinkByEmail = r.LinkByEmail;
        provider.AutoProvision = r.AutoProvision;
        provider.DefaultRoleId = r.DefaultRoleId;
        provider.AllowedDomains = domains;
        provider.TrustProviderMfa = r.TrustProviderMfa;
        provider.Enabled = r.Enabled;
        if (id is null)
        {
            db.OidcProviders.Add(provider);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "sso.provider.created" : "sso.provider.updated", "oidc_provider", provider.Id.ToString(CultureInfo.InvariantCulture),
            $"Provedor {provider.Name} ({provider.Authority})", cancellationToken: ct);
        var count = await db.UserLogins.CountAsync(l => l.LoginProvider == provider.LoginProvider, ct);
        var dto = ToDto(provider, svc.RedirectUri, count);
        return id is null ? TypedResults.Created($"/api/sso/providers/{provider.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> StartAsync(int id, string? returnUrl, HttpContext http, CybereyesDbContext db, SsoService svc,
        ILogger<SsoService> logger, CancellationToken ct)
    {
        var provider = await db.OidcProviders.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.Enabled, ct);
        if (provider is null)
        {
            return Problems.NotFound("Provedor");
        }
        try
        {
            var (url, cookie) = await svc.StartAsync(provider, returnUrl, ct);
            http.Response.Cookies.Append(SsoService.StateCookie, cookie, StateCookieOptions(TimeSpan.FromMinutes(10)));
            return Results.Redirect(url);
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException or HttpRequestException or TaskCanceledException)
        {
            LogStartFailed(logger, ex, provider.Name);
            return Results.Redirect($"/login?ssoError={SsoErrors.ProviderError}");
        }
    }

    private static CookieOptions StateCookieOptions(TimeSpan maxAge) => new()
    {
        HttpOnly = true,
        Secure = true,
        // Lax: o retorno do provedor e uma navegacao vinda de outro site; com Strict o navegador nao enviaria o cookie.
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth/sso",
        MaxAge = maxAge,
        IsEssential = true,
    };

    private static async Task<IResult> CallbackAsync(HttpContext http, CybereyesDbContext db, SsoService svc, SignInManager<AppUser> signIn,
        UserManager<AppUser> users, IAuditService audit, TimeProvider time, ILogger<SsoService> logger, CancellationToken ct)
    {
        var query = http.Request.Query;
        var cookie = http.Request.Cookies[SsoService.StateCookie];
        http.Response.Cookies.Delete(SsoService.StateCookie, StateCookieOptions(TimeSpan.Zero));
        OidcProvider? provider = null;
        try
        {
            var state = svc.ReadState(cookie, query["state"]);
            provider = await db.OidcProviders.AsNoTracking().FirstOrDefaultAsync(p => p.Id == state.ProviderId && p.Enabled, ct)
                ?? throw new SsoException(SsoErrors.InvalidState, "Provedor inexistente ou inativo");
            if (!string.IsNullOrEmpty(query["error"]))
            {
                throw new SsoException(SsoErrors.ProviderError, $"Provedor devolveu erro {query["error"]}: {query["error_description"]}");
            }
            if (string.IsNullOrEmpty(query["code"]))
            {
                throw new SsoException(SsoErrors.ProviderError, "Retorno sem codigo de autorizacao");
            }
            var identity = await svc.RedeemAsync(provider, state, query["code"]!, ct);
            var user = await svc.ResolveUserAsync(provider, identity, ct);

            if (svc.ProviderMfaSatisfied(provider, identity))
            {
                await signIn.SignInWithClaimsAsync(user, isPersistent: false, [new System.Security.Claims.Claim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa)]);
                user.LastLoginAt = time.GetUtcNow();
                await users.UpdateAsync(user);
                await audit.LogAsync("login.success", "user", user.Id.ToString(), $"Login pelo provedor {provider.Name} (MFA do provedor)", user.UserName, ct);
                return Results.Redirect(state.ReturnUrl);
            }
            if (user.TwoFactorEnabled)
            {
                await http.SignInAsync(IdentityConstants.TwoFactorUserIdScheme, SsoService.TwoFactorPrincipal(user));
                await audit.LogAsync("login.partial", "user", user.Id.ToString(), $"Provedor {provider.Name} validado, codigo 2FA pendente", user.UserName, ct);
                return Results.Redirect("/login?sso=2fa");
            }
            await signIn.SignInAsync(user, isPersistent: false);
            await audit.LogAsync("login.partial", "user", user.Id.ToString(), $"Provedor {provider.Name} validado, 2FA pendente de configuracao", user.UserName, ct);
            return Results.Redirect("/login?sso=setup");
        }
        catch (SsoException ex)
        {
            LogCallbackFailed(logger, ex.Code, ex.Message);
            await audit.LogAsync("auth.sso.failed", "oidc_provider", provider?.Id.ToString(CultureInfo.InvariantCulture), $"{ex.Code}: {ex.Message}", cancellationToken: ct);
            return Results.Redirect($"/login?ssoError={ex.Code}");
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException or HttpRequestException or TaskCanceledException or System.Security.Cryptography.CryptographicException)
        {
            LogCallbackFailed(logger, SsoErrors.ProviderError, ex.Message);
            await audit.LogAsync("auth.sso.failed", "oidc_provider", provider?.Id.ToString(CultureInfo.InvariantCulture), $"{SsoErrors.ProviderError}: {ex.Message}", cancellationToken: ct);
            return Results.Redirect($"/login?ssoError={SsoErrors.ProviderError}");
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao iniciar o SSO com {Provider}")]
    private static partial void LogStartFailed(ILogger logger, Exception ex, string provider);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Retorno do SSO recusado ({Code}): {Detail}")]
    private static partial void LogCallbackFailed(ILogger logger, string code, string detail);
}
