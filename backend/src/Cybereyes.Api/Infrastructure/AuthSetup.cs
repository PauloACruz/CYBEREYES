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
