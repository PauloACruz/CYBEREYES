using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using WinCare.Api.Inventory;
using WinCare.Core.Audit;
using WinCare.Core.Identity;
using WinCare.Core.Persistence;
using WinCare.Core.Security;

namespace WinCare.Api.Sso;

public static class SsoErrors
{
    public const string ProviderError = "SSO_PROVIDER_ERROR";
    public const string InvalidState = "SSO_INVALID_STATE";
    public const string InvalidToken = "SSO_INVALID_TOKEN";
    public const string UserNotFound = "SSO_USER_NOT_FOUND";
    public const string UserDisabled = "SSO_USER_DISABLED";
    public const string DomainNotAllowed = "SSO_DOMAIN_NOT_ALLOWED";
    public const string PasswordLoginDisabled = "PASSWORD_LOGIN_DISABLED";
}

public sealed class SsoException(string code, string detail) : Exception(detail)
{
    public string Code { get; } = code;
}

/// <summary>Estado do login em andamento, guardado em cookie cifrado entre o inicio e o retorno do provedor.</summary>
public sealed record SsoState(int ProviderId, string State, string Nonce, string Verifier, string ReturnUrl, DateTimeOffset ExpiresAt);

public sealed record SsoIdentity(string Subject, string? Email, bool EmailVerified, string? Username, string? Name, IReadOnlyList<string> Amr);

/// <summary>Fluxo OIDC (authorization code + PKCE) escrito sobre as bibliotecas de protocolo; a configuracao vem do banco, nao da inicializacao.</summary>
public sealed partial class SsoService(WinCareDbContext db, Vault vault, IHttpClientFactory http, IDataProtectionProvider protection,
    UserManager<AppUser> users, RoleManager<AppRole> roles, IConfiguration config, TimeProvider time, IAuditService audit)
{
    public const string StateCookie = "wincare.sso";
    public const string CallbackPath = "/api/auth/sso/callback";
    public static readonly string[] MfaMethods = ["mfa", "otp", "hwk", "swk", "fpt", "face"];
    private static readonly ConcurrentDictionary<string, ConfigurationManager<OpenIdConnectConfiguration>> Configs = new(StringComparer.Ordinal);

    [GeneratedRegex("[^A-Za-z0-9._@+-]")]
    private static partial Regex InvalidUserNameChars();

    public string RedirectUri => $"{(config["App:PublicUrl"] ?? string.Empty).TrimEnd('/')}{CallbackPath}";

    private IDataProtector Protector => protection.CreateProtector("WinCare.Sso.State");

    public Task<OpenIdConnectConfiguration> DiscoverAsync(string authority, CancellationToken ct)
    {
        var manager = Configs.GetOrAdd(authority.TrimEnd('/'), a =>
            new ConfigurationManager<OpenIdConnectConfiguration>($"{a}/.well-known/openid-configuration", new OpenIdConnectConfigurationRetriever(),
                new HttpDocumentRetriever(http.CreateClient("oidc")) { RequireHttps = a.StartsWith("https://", StringComparison.OrdinalIgnoreCase) })
            {
                AutomaticRefreshInterval = TimeSpan.FromHours(1),
            });
        return manager.GetConfigurationAsync(ct);
    }

    public static bool IsAllowedAuthority(string authority) =>
        Uri.TryCreate(authority, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)) &&
        string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);

    public static string SafeReturnUrl(string? returnUrl) =>
        returnUrl is { Length: > 0 and <= 500 } r && r[0] == '/' && !r.StartsWith("//", StringComparison.Ordinal) && !r.StartsWith("/\\", StringComparison.Ordinal) &&
        !r.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
            ? r
            : "/";

    private static string Random32() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    /// <summary>Monta a URL de autorizacao e o cookie de estado.</summary>
    public async Task<(string Url, string Cookie)> StartAsync(OidcProvider provider, string? returnUrl, CancellationToken ct)
    {
        var discovery = await DiscoverAsync(provider.Authority, ct);
        var state = new SsoState(provider.Id, Random32(), Random32(), Random32(), SafeReturnUrl(returnUrl), time.GetUtcNow().AddMinutes(10));
        var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(state.Verifier)));
        var url = QueryHelpers.AddQueryString(discovery.AuthorizationEndpoint, new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = provider.ClientId,
            ["redirect_uri"] = RedirectUri,
            ["scope"] = provider.Scopes,
            ["state"] = state.State,
            ["nonce"] = state.Nonce,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
        });
        return (url, Protector.Protect(JsonSerializer.Serialize(state)));
    }

    public SsoState ReadState(string? cookie, string? returnedState)
    {
        if (string.IsNullOrEmpty(cookie) || string.IsNullOrEmpty(returnedState))
        {
            throw new SsoException(SsoErrors.InvalidState, "Cookie de estado ausente");
        }
        SsoState? state;
        try
        {
            state = JsonSerializer.Deserialize<SsoState>(Protector.Unprotect(cookie));
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or FormatException)
        {
            throw new SsoException(SsoErrors.InvalidState, "Cookie de estado invalido");
        }
        if (state is null || state.ExpiresAt < time.GetUtcNow() ||
            !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(state.State), Encoding.ASCII.GetBytes(returnedState)))
        {
            throw new SsoException(SsoErrors.InvalidState, "Estado expirado ou diferente do enviado");
        }
        return state;
    }

    /// <summary>Troca o codigo pelo id_token e valida assinatura, emissor, audiencia, validade e nonce.</summary>
    public async Task<SsoIdentity> RedeemAsync(OidcProvider provider, SsoState state, string code, CancellationToken ct)
    {
        var discovery = await DiscoverAsync(provider.Authority, ct);
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = RedirectUri,
            ["client_id"] = provider.ClientId,
            ["code_verifier"] = state.Verifier,
        };
        if (provider.ClientSecretEncrypted is { } secret)
        {
            form["client_secret"] = vault.Decrypt(secret);
        }
        using var client = http.CreateClient("oidc");
        client.Timeout = TimeSpan.FromSeconds(15);
        using var response = await client.PostAsync(new Uri(discovery.TokenEndpoint), new FormUrlEncodedContent(form), ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new SsoException(SsoErrors.ProviderError, $"Endpoint de token respondeu {(int)response.StatusCode}: {Truncate(body)}");
        }
        string? idToken;
        try
        {
            using var doc = JsonDocument.Parse(body);
            idToken = doc.RootElement.TryGetProperty("id_token", out var t) ? t.GetString() : null;
        }
        catch (JsonException)
        {
            throw new SsoException(SsoErrors.ProviderError, "Resposta do endpoint de token nao e JSON");
        }
        if (string.IsNullOrEmpty(idToken))
        {
            throw new SsoException(SsoErrors.InvalidToken, "Resposta sem id_token");
        }

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(idToken, new TokenValidationParameters
        {
            ValidIssuer = discovery.Issuer,
            ValidAudience = provider.ClientId,
            IssuerSigningKeys = discovery.SigningKeys,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2),
            RequireSignedTokens = true,
        });
        if (!result.IsValid)
        {
            throw new SsoException(SsoErrors.InvalidToken, $"id_token rejeitado: {result.Exception?.Message}");
        }
        var claims = result.ClaimsIdentity;
        string? Claim(string type) => claims.FindFirst(type)?.Value;
        if (!string.Equals(Claim("nonce"), state.Nonce, StringComparison.Ordinal))
        {
            throw new SsoException(SsoErrors.InvalidToken, "nonce diferente do enviado");
        }
        var subject = Claim("sub");
        if (string.IsNullOrEmpty(subject))
        {
            throw new SsoException(SsoErrors.InvalidToken, "id_token sem sub");
        }
        return new SsoIdentity(subject, Claim("email"), string.Equals(Claim("email_verified"), "true", StringComparison.OrdinalIgnoreCase),
            Claim(provider.UsernameClaim), Claim("name"), claims.FindAll("amr").Select(c => c.Value).ToList());
    }

    /// <summary>Acha ou cria o usuario local para a identidade do provedor, conforme as regras do contrato.</summary>
    public async Task<AppUser> ResolveUserAsync(OidcProvider provider, SsoIdentity identity, CancellationToken ct)
    {
        if (provider.AllowedDomains.Count > 0 &&
            (identity.Email is not { } mail || !provider.AllowedDomains.Any(d => mail.EndsWith("@" + d.TrimStart('@'), StringComparison.OrdinalIgnoreCase))))
        {
            throw new SsoException(SsoErrors.DomainNotAllowed, $"E-mail {identity.Email} fora dos dominios permitidos");
        }

        var user = await users.FindByLoginAsync(provider.LoginProvider, identity.Subject);
        if (user is null && provider.LinkByEmail && identity.EmailVerified && identity.Email is { } email)
        {
            var normalized = users.NormalizeEmail(email);
            var matches = await db.Users.Where(u => u.NormalizedEmail == normalized).ToListAsync(ct);
            if (matches.Count == 1)
            {
                user = matches[0];
                await users.AddLoginAsync(user, new UserLoginInfo(provider.LoginProvider, identity.Subject, provider.Name));
                await audit.LogAsync("auth.sso.linked", "user", user.Id.ToString(), $"Vinculado ao provedor {provider.Name} pelo e-mail", user.UserName, ct);
            }
        }
        if (user is null && provider.AutoProvision)
        {
            user = await ProvisionAsync(provider, identity, ct);
        }
        if (user is null)
        {
            throw new SsoException(SsoErrors.UserNotFound, $"Nenhum usuario para sub {identity.Subject} ({identity.Email})");
        }
        if (!user.IsActive || await users.IsLockedOutAsync(user))
        {
            throw new SsoException(SsoErrors.UserDisabled, $"Usuario {user.UserName} inativo ou bloqueado");
        }
        return user;
    }

    private async Task<AppUser> ProvisionAsync(OidcProvider provider, SsoIdentity identity, CancellationToken ct)
    {
        var baseName = InvalidUserNameChars().Replace(identity.Username ?? identity.Email?.Split('@')[0] ?? "sso", string.Empty);
        if (baseName.Length == 0)
        {
            baseName = "sso";
        }
        baseName = baseName.Length > 60 ? baseName[..60] : baseName;
        var userName = baseName;
        for (var i = 2; await users.FindByNameAsync(userName) is not null; i++)
        {
            userName = $"{baseName}{i}";
        }
        var user = new AppUser
        {
            UserName = userName,
            Email = identity.Email,
            EmailConfirmed = identity.EmailVerified,
            FullName = identity.Name ?? userName,
            IsActive = true,
        };
        var created = await users.CreateAsync(user);
        if (!created.Succeeded)
        {
            throw new SsoException(SsoErrors.ProviderError, "Falha ao criar usuario: " + string.Join("; ", created.Errors.Select(e => e.Description)));
        }
        await users.AddLoginAsync(user, new UserLoginInfo(provider.LoginProvider, identity.Subject, provider.Name));
        if (provider.DefaultRoleId is { } roleId && await roles.FindByIdAsync(roleId.ToString()) is { Name: { } roleName })
        {
            await users.AddToRoleAsync(user, roleName);
        }
        await audit.LogAsync("auth.sso.provisioned", "user", user.Id.ToString(), $"Usuario criado pelo provedor {provider.Name}", user.UserName, ct);
        return user;
    }

    public bool ProviderMfaSatisfied(OidcProvider provider, SsoIdentity identity) =>
        provider.TrustProviderMfa && identity.Amr.Any(a => MfaMethods.Contains(a, StringComparer.OrdinalIgnoreCase));

    private static string Truncate(string text) => text.Length <= 300 ? text : text[..300];

    public static ClaimsPrincipal TwoFactorPrincipal(AppUser user)
    {
        var identity = new ClaimsIdentity(IdentityConstants.TwoFactorUserIdScheme);
        identity.AddClaim(new Claim(ClaimTypes.Name, user.Id.ToString()));
        return new ClaimsPrincipal(identity);
    }
}
