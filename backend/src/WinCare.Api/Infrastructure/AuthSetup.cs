using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using WinCare.Core.Identity;
using WinCare.Core.Persistence;
using WinCare.Core.Security;

namespace WinCare.Api.Infrastructure;

public static class AuthSetup
{
    private const string SelectorScheme = "WinCare";
    public const string AuthRateLimitPolicy = "auth";

    public static IServiceCollection AddWinCareAuth(this IServiceCollection services, IConfiguration configuration)
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
            .AddEntityFrameworkStores<WinCareDbContext>()
            .AddDefaultTokenProviders();

        var secureCookies = configuration.GetValue("Auth:SecureCookies", true)
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;

        services.ConfigureApplicationCookie(o =>
        {
            o.Cookie.Name = "wincare.auth";
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
            o.Cookie.Name = "wincare.2fa";
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = secureCookies;
        });

        services.Configure<SecurityStampValidatorOptions>(o =>
        {
            o.ValidationInterval = TimeSpan.FromMinutes(1);
            o.OnRefreshingPrincipal = ctx =>
            {
                if (ctx.NewPrincipal?.Identity is System.Security.Claims.ClaimsIdentity identity &&
                    ctx.CurrentPrincipal?.HasClaim(WinCareClaims.AuthMethods, WinCareClaims.Mfa) == true &&
                    !identity.HasClaim(WinCareClaims.AuthMethods, WinCareClaims.Mfa))
                {
                    identity.AddClaim(new System.Security.Claims.Claim(WinCareClaims.AuthMethods, WinCareClaims.Mfa));
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
                    if (ctx.Request.Headers.ContainsKey(ApiKeyAuthenticationHandler.HeaderName))
                    {
                        return WinCareClaims.ApiKeyScheme;
                    }
                    return Rmm.AgentTokenAuthenticationHandler.HasTokenHeader(ctx.Request)
                        ? WinCareClaims.AgentTokenScheme
                        : IdentityConstants.ApplicationScheme;
                };
            })
            .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(WinCareClaims.ApiKeyScheme, null)
            .AddScheme<AuthenticationSchemeOptions, Rmm.AgentTokenAuthenticationHandler>(WinCareClaims.AgentTokenScheme, null);

        services.AddScoped<IClaimsTransformation, PermissionClaimsTransformation>();
        services.AddSingleton<IAuthorizationPolicyProvider, WinCarePolicyProvider>();
        services.AddSingleton<IAuthorizationHandler, MfaRequirementHandler>();
        services.AddSingleton<IAuthorizationHandler, PermissionRequirementHandler>();
        services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler, ProblemAuthorizationResultHandler>();

        services.AddAuthorizationBuilder()
            .SetDefaultPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(new MfaRequirement()).Build())
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().AddRequirements(new MfaRequirement()).Build())
            .AddPolicy(Policies.Partial, p => p.RequireAuthenticatedUser())
            .AddPolicy(Policies.Agent, p => p.RequireClaim(WinCareClaims.AgentPk))
            .AddPolicy(Policies.Installer, p => p.RequireAssertion(ctx =>
                ctx.User.HasClaim(c => c.Type == WinCareClaims.Installer) ||
                (ctx.User.Identities.Any(i => i.IsAuthenticated && i.AuthenticationType == WinCareClaims.ApiKeyScheme) &&
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
