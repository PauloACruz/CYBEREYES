using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.Extensions.Options;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Infrastructure;

public static class Policies
{
    public const string Partial = "partial";
    public const string Agent = "agent";
    public const string Installer = "installer";
    public const string Tray = "tray";
    private const string PermissionPrefix = "perm:";

    public static string Permission(string permission) => PermissionPrefix + permission;

    internal static bool TryParsePermission(string policyName, out string permission)
    {
        permission = policyName.StartsWith(PermissionPrefix, StringComparison.Ordinal) ? policyName[PermissionPrefix.Length..] : string.Empty;
        return permission.Length > 0;
    }
}

public sealed class MfaRequirement : IAuthorizationRequirement;

public sealed record PermissionRequirement(string Permission) : IAuthorizationRequirement;

public static class PrincipalExtensions
{
    public static bool IsMfaSatisfied(this ClaimsPrincipal principal) =>
        principal.HasClaim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa) ||
        principal.Identities.Any(i => i.IsAuthenticated && i.AuthenticationType == CybereyesClaims.ApiKeyScheme);

    public static bool IsSuperuser(this ClaimsPrincipal principal) => principal.HasClaim(c => c.Type == CybereyesClaims.Superuser);

    public static bool HasPermission(this ClaimsPrincipal principal, string permission) =>
        principal.IsSuperuser() || principal.HasClaim(CybereyesClaims.Permission, permission);

    public static Guid? UserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    /// <summary>Clientes que o usuario pode ver, ou nulo quando ve todos.</summary>
    public static IReadOnlyList<int>? VisibleClientIds(this ClaimsPrincipal principal) =>
        principal.HasClaim(c => c.Type == CybereyesClaims.ClientScope)
            ? principal.FindAll(CybereyesClaims.Client)
                .Select(c => int.TryParse(c.Value, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : 0)
                .Where(id => id > 0).ToList()
            : null;

    /// <summary>Aplica ao contexto o escopo de clientes do usuario (sem efeito para quem ve todos).</summary>
    public static void ApplyClientScope(this CybereyesDbContext db, ClaimsPrincipal? principal)
    {
        if (principal?.VisibleClientIds() is { } ids && principal.UserId() is { } userId)
        {
            db.RestrictToClients(ids, userId, principal.Identity?.Name ?? string.Empty);
        }
    }
}

public sealed class MfaRequirementHandler : AuthorizationHandler<MfaRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, MfaRequirement requirement)
    {
        if (context.User.IsMfaSatisfied())
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

public sealed class PermissionRequirementHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        if (context.User.HasPermission(requirement.Permission))
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

public sealed class CybereyesPolicyProvider(IOptions<AuthorizationOptions> options) : DefaultAuthorizationPolicyProvider(options)
{
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (Policies.TryParsePermission(policyName, out var permission))
        {
            return new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .AddRequirements(new MfaRequirement(), new PermissionRequirement(permission))
                .Build();
        }
        return await base.GetPolicyAsync(policyName);
    }
}

public sealed class ProblemAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler fallback = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Challenged || (authorizeResult.Forbidden && context.User.Identity?.IsAuthenticated != true))
        {
            await Problems.Unauthorized("Autenticacao necessaria").ExecuteAsync(context);
            return;
        }

        if (authorizeResult.Forbidden)
        {
            var mfaMissing = authorizeResult.AuthorizationFailure?.FailedRequirements.OfType<MfaRequirement>().Any() == true;
            var result = mfaMissing
                ? Problems.Forbidden("Validacao em dois fatores necessaria", ErrorCodes.MfaRequired)
                : Problems.Forbidden("Sem permissao para esta acao");
            await result.ExecuteAsync(context);
            return;
        }

        await fallback.HandleAsync(next, context, policy, authorizeResult);
    }
}
