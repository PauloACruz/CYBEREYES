using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Infrastructure;

public static class AuthSetup
{
    private const string SelectorScheme = "Cybereyes";
    public const string AuthRateLimitPolicy = "auth";

    /// <summary>Por quanto tempo um aparelho que passou pelo 2FA deixa de pedir o codigo (app do tecnico: uma vez por mes).</summary>
    public static readonly TimeSpan RememberDeviceLifespan = TimeSpan.FromDays(30);

    /// <summary>A origem do navegador tem de ser o endereco publico do console (ou o da propria requisicao, sem App:PublicUrl).</summary>
    private static bool PasskeyOriginAllowed(PasskeyOriginValidationContext ctx, IConfiguration config)
    {
        if (ctx.CrossOrigin || !Uri.TryCreate(ctx.Origin, UriKind.Absolute, out var origin))
        {
            return false;
        }
        var expected = Rmm.InstallerEndpoints.PublicUrl(ctx.HttpContext, config);
        return Uri.TryCreate(expected, UriKind.Absolute, out var allowed)
            && string.Equals(origin.GetLeftPart(UriPartial.Authority), allowed.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
    }

    public static IServiceCollection AddCybereyesAuth(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddIdentity<AppUser, AppRole>(o =>
            {
                o.Password.RequiredLength = 12;
                o.Password.RequireDigit = false;
                o.Password.RequireLowercase = false;
                o.Password.RequireUppercase = false;
                o.Password.RequireNonAlphanumeric = false;
                o.Lockout.MaxFailedAccessAttempts = 5;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                o.Lockout.AllowedForNewUsers = true;
                o.User.RequireUniqueEmail = true;
                // Versao 3 do esquema do Identity: tabela AspNetUserPasskeys (entrada por biometria, ADR-027).
                o.Stores.SchemaVersion = IdentitySchemaVersions.Version3;
            })
            .AddEntityFrameworkStores<CybereyesDbContext>()
            .AddDefaultTokenProviders()
            .AddTokenProvider<InviteTokenProvider>(InviteTokenProviderOptions.ProviderName);
        // Provedor padrao: redefinicao de senha por e-mail (o link vale 2 h); o convite usa o provedor proprio (72 h).
        services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = AccountEmails.ResetLifespan);
        services.AddScoped<AccountEmails>();

        var secureCookies = configuration.GetValue("Auth:SecureCookies", true)
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;

        services.ConfigureApplicationCookie(o =>
        {
            o.Cookie.Name = "cybereyes.auth";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = secureCookies;
            o.ExpireTimeSpan = TimeSpan.FromHours(8);
            o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = ctx => Problems.Unauthorized("Autenticacao necessaria").ExecuteAsync(ctx.HttpContext);
            o.Events.OnRedirectToAccessDenied = ctx => Problems.Forbidden("Sem permissao para esta acao").ExecuteAsync(ctx.HttpContext);
        });

        services.ConfigureExternalCookie(o => o.Cookie.SecurePolicy = secureCookies);
        services.Configure<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>(IdentityConstants.TwoFactorUserIdScheme, o =>
        {
            o.Cookie.Name = "cybereyes.2fa";
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = secureCookies;
        });

        // Aparelho lembrado: prazo fixo (sem renovar a cada uso) e preso ao carimbo de seguranca da conta; trocar a senha ou o
        // autenticador invalida todos os aparelhos (validador de carimbo do proprio Identity neste esquema).
        services.Configure<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>(IdentityConstants.TwoFactorRememberMeScheme, o =>
        {
            o.Cookie.Name = "cybereyes.2fa-aparelho";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = secureCookies;
            o.ExpireTimeSpan = RememberDeviceLifespan;
            o.SlidingExpiration = false;
        });

        // Biometria do celular (WebAuthn): so o autenticador do proprio aparelho, com verificacao do usuario (digital, rosto ou
        // PIN do aparelho) e credencial guardada nele, para entrar sem digitar o usuario. Origem e dominio vem de App:PublicUrl.
        services.AddOptions<IdentityPasskeyOptions>().Configure<IConfiguration>((o, config) =>
        {
            o.AuthenticatorAttachment = "platform";
            o.ResidentKeyRequirement = "required";
            o.UserVerificationRequirement = "required";
            o.AuthenticatorTimeout = TimeSpan.FromMinutes(2);
            if (Uri.TryCreate(config["App:PublicUrl"], UriKind.Absolute, out var publicUrl))
            {
                o.ServerDomain = publicUrl.Host;
            }
            o.ValidateOrigin = ctx => ValueTask.FromResult(PasskeyOriginAllowed(ctx, config));
        });

        services.Configure<SecurityStampValidatorOptions>(o =>
        {
            o.ValidationInterval = TimeSpan.FromMinutes(1);
            o.OnRefreshingPrincipal = ctx =>
            {
                if (ctx.NewPrincipal?.Identity is System.Security.Claims.ClaimsIdentity identity &&
                    ctx.CurrentPrincipal?.HasClaim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa) == true &&
                    !identity.HasClaim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa))
                {
                    identity.AddClaim(new System.Security.Claims.Claim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa));
                }
                return Task.CompletedTask;
            };
        });

        services.AddAuthentication(o =>
            {
                o.DefaultScheme = SelectorScheme;
                o.DefaultAuthenticateScheme = SelectorScheme;
                o.DefaultChallengeScheme = SelectorScheme;
                o.DefaultForbidScheme = SelectorScheme;
            })
            .AddPolicyScheme(SelectorScheme, SelectorScheme, o =>
            {
                o.ForwardDefaultSelector = ctx =>
                {
                    if (Rmm.Remote.RemoteForwardAuthenticationHandler.Matches(ctx.Request))
                    {
                        return Rmm.Remote.RemoteForwardAuthenticationHandler.SchemeName;
                    }
                    if (ctx.Request.Headers.ContainsKey(ApiKeyAuthenticationHandler.HeaderName))
                    {
                        return CybereyesClaims.ApiKeyScheme;
                    }
                    if (Tickets.TrayTokenAuthenticationHandler.Matches(ctx.Request))
                    {
                        return Tickets.TrayTokenAuthenticationHandler.SchemeName;
                    }
                    return Rmm.AgentTokenAuthenticationHandler.HasTokenHeader(ctx.Request)
                        ? CybereyesClaims.AgentTokenScheme
                        : IdentityConstants.ApplicationScheme;
                };
            })
            .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(CybereyesClaims.ApiKeyScheme, null)
            .AddScheme<AuthenticationSchemeOptions, Rmm.AgentTokenAuthenticationHandler>(CybereyesClaims.AgentTokenScheme, null)
            .AddScheme<AuthenticationSchemeOptions, Tickets.TrayTokenAuthenticationHandler>(Tickets.TrayTokenAuthenticationHandler.SchemeName, null)
            .AddScheme<AuthenticationSchemeOptions, Rmm.Remote.RemoteForwardAuthenticationHandler>(Rmm.Remote.RemoteForwardAuthenticationHandler.SchemeName, null);

        services.AddScoped<IClaimsTransformation, PermissionClaimsTransformation>();
        services.AddSingleton<IAuthorizationPolicyProvider, CybereyesPolicyProvider>();
        services.AddSingleton<IAuthorizationHandler, MfaRequirementHandler>();
        services.AddSingleton<IAuthorizationHandler, PermissionRequirementHandler>();
        services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler, ProblemAuthorizationResultHandler>();

        services.AddAuthorizationBuilder()
            .SetDefaultPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(new MfaRequirement()).Build())
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(new MfaRequirement()).Build())
            .AddPolicy(Policies.Partial, p => p.RequireAuthenticatedUser())
            .AddPolicy(Policies.Agent, p => p.RequireClaim(CybereyesClaims.AgentPk))
            .AddPolicy(Policies.Tray, p => p.RequireClaim(CybereyesClaims.TrayAgent).RequireClaim(CybereyesClaims.TrayUser))
            .AddPolicy(Policies.Installer, p => p.RequireAssertion(ctx =>
                ctx.User.HasClaim(c => c.Type == CybereyesClaims.Installer) ||
                (ctx.User.Identities.Any(i => i.IsAuthenticated && i.AuthenticationType == CybereyesClaims.ApiKeyScheme) &&
                 ctx.User.HasPermission(Permissions.AgentsInstall))));

        var permitPerMinute = configuration.GetValue("RateLimiting:AuthPermitPerMinute", 10);
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(AuthRateLimitPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = permitPerMinute, Window = TimeSpan.FromMinutes(1) }));
            o.OnRejected = (ctx, _) => new ValueTask(
                Problems.Create(StatusCodes.Status429TooManyRequests, "Muitas tentativas, aguarde um minuto", ErrorCodes.RateLimited)
                    .ExecuteAsync(ctx.HttpContext));
        });

        return services;
    }

}
