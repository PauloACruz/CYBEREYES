using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

public static class AuthEndpoints
{
    private const string Issuer = "Cybereyes";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Autenticacao");

        group.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapPost("/login/2fa", LoginTwoFactorAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapPost("/login/recovery", LoginRecoveryAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapGet("/2fa/setup", SetupTwoFactorAsync).RequireAuthorization(Policies.Partial);
        group.MapPost("/2fa/enable", EnableTwoFactorAsync).RequireAuthorization(Policies.Partial).RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization(Policies.Partial);
        group.MapGet("/me", MeAsync).RequireAuthorization(Policies.Partial);
        group.MapPost("/password", ChangePasswordAsync).RequireAuthorization();
        group.MapAccountEndpoints();
    }

    private static async Task<IResult> LoginAsync(LoginRequest request, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager, IAuditService audit, Cybereyes.Core.Persistence.CybereyesDbContext db, CancellationToken ct)
    {
        var user = await userManager.FindByNameAsync(request.Username);
        if (user is null || !user.IsActive)
        {
            await audit.LogAsync("login.failed", "user", null, "Usuario inexistente ou inativo", request.Username, ct);
            return Problems.Unauthorized("Usuario ou senha incorretos", ErrorCodes.InvalidCredentials);
        }

        if (await Sso.SsoPolicy.PasswordLoginBlockedAsync(user, db, ct))
        {
            await audit.LogAsync("login.failed", "user", user.Id.ToString(), "Login por senha desativado (use o SSO)", user.UserName, ct);
            return Problems.Forbidden("O login por senha esta desativado; entre pelo SSO", Sso.SsoErrors.PasswordLoginDisabled);
        }

        var result = await signInManager.PasswordSignInAsync(user, request.Password, request.RememberMe ?? false, lockoutOnFailure: true);
        if (result.IsLockedOut)
        {
            await audit.LogAsync("login.locked", "user", user.Id.ToString(), "Conta bloqueada por tentativas", user.UserName, ct);
            return Problems.Forbidden("Conta bloqueada temporariamente por excesso de tentativas", ErrorCodes.LockedOut);
        }
        if (result.RequiresTwoFactor)
        {
            return TypedResults.Ok(new LoginResponse("requires2fa"));
        }
        if (result.Succeeded)
        {
            await audit.LogAsync("login.partial", "user", user.Id.ToString(), "Senha validada, 2FA pendente de configuracao", user.UserName, ct);
            return TypedResults.Ok(new LoginResponse("requires2faSetup"));
        }

        await audit.LogAsync("login.failed", "user", user.Id.ToString(), "Senha incorreta", user.UserName, ct);
        return Problems.Unauthorized("Usuario ou senha incorretos", ErrorCodes.InvalidCredentials);
    }

    private static async Task<IResult> LoginTwoFactorAsync(TwoFactorRequest request, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();
        if (user is null)
        {
            return Problems.Unauthorized("Sessao de login expirada, entre novamente");
        }

        var result = await signInManager.TwoFactorAuthenticatorSignInAsync(NormalizeCode(request.Code), request.RememberMe ?? false, rememberClient: false);
        return await CompleteTwoFactorAsync(result, user, userManager, audit, time, "codigo do autenticador", ct);
    }

    private static async Task<IResult> LoginRecoveryAsync(RecoveryRequest request, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();
        if (user is null)
        {
            return Problems.Unauthorized("Sessao de login expirada, entre novamente");
        }

        var result = await signInManager.TwoFactorRecoveryCodeSignInAsync(request.RecoveryCode.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant());
        return await CompleteTwoFactorAsync(result, user, userManager, audit, time, "codigo de recuperacao", ct);
    }

    private static async Task<IResult> CompleteTwoFactorAsync(SignInResult result, AppUser user, UserManager<AppUser> userManager,
        IAuditService audit, TimeProvider time, string method, CancellationToken ct)
    {
        if (result.IsLockedOut)
        {
            await audit.LogAsync("login.locked", "user", user.Id.ToString(), "Conta bloqueada por tentativas", user.UserName, ct);
            return Problems.Forbidden("Conta bloqueada temporariamente por excesso de tentativas", ErrorCodes.LockedOut);
        }
        if (!result.Succeeded)
        {
            await audit.LogAsync("2fa.failed", "user", user.Id.ToString(), $"Falha no {method}", user.UserName, ct);
            return Problems.Unauthorized("Codigo invalido", ErrorCodes.InvalidCode);
        }

        user.LastLoginAt = time.GetUtcNow();
        await userManager.UpdateAsync(user);
        await audit.LogAsync("login.success", "user", user.Id.ToString(), $"Login com {method}", user.UserName, ct);
        return TypedResults.Ok(new LoginResponse("ok"));
    }

    private static async Task<IResult> SetupTwoFactorAsync(ClaimsPrincipal principal, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        if (user.TwoFactorEnabled)
        {
            return Problems.Conflict("A verificacao em dois fatores ja esta configurada");
        }

        var key = await userManager.GetAuthenticatorKeyAsync(user);
        if (string.IsNullOrEmpty(key))
        {
            await userManager.ResetAuthenticatorKeyAsync(user);
            await signInManager.RefreshSignInAsync(user);
            key = await userManager.GetAuthenticatorKeyAsync(user) ?? string.Empty;
        }

        var label = Uri.EscapeDataString($"{Issuer}:{user.UserName}");
        var uri = $"otpauth://totp/{label}?secret={key}&issuer={Uri.EscapeDataString(Issuer)}&digits=6";
        return TypedResults.Ok(new TwoFactorSetupResponse(key, uri));
    }

    private static async Task<IResult> EnableTwoFactorAsync(CodeRequest request, ClaimsPrincipal principal, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        if (user.TwoFactorEnabled)
        {
            return Problems.Conflict("A verificacao em dois fatores ja esta configurada");
        }

        var valid = await userManager.VerifyTwoFactorTokenAsync(user, userManager.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(request.Code));
        if (!valid)
        {
            await audit.LogAsync("2fa.failed", "user", user.Id.ToString(), "Codigo invalido na ativacao", user.UserName, ct);
            return Problems.Unauthorized("Codigo invalido", ErrorCodes.InvalidCode);
        }

        await userManager.SetTwoFactorEnabledAsync(user, true);
        var codes = await userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 10) ?? [];
        user.LastLoginAt = time.GetUtcNow();
        await userManager.UpdateAsync(user);
        await signInManager.SignInWithClaimsAsync(user, isPersistent: false, [new Claim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa)]);
        await audit.LogAsync("2fa.enabled", "user", user.Id.ToString(), "Verificacao em dois fatores ativada", user.UserName, ct);
        return TypedResults.Ok(new EnableTwoFactorResponse("ok", codes.ToList()));
    }

    private static async Task<IResult> LogoutAsync(ClaimsPrincipal principal, SignInManager<AppUser> signInManager, IAuditService audit, CancellationToken ct)
    {
        await signInManager.SignOutAsync();
        await audit.LogAsync("logout", "user", principal.UserId()?.ToString(), null, principal.Identity?.Name, ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> MeAsync(ClaimsPrincipal principal, UserManager<AppUser> userManager)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }

        var roles = await userManager.GetRolesAsync(user);
        var permissions = principal.IsSuperuser()
            ? Permissions.Catalog.Select(p => p.Key).ToList()
            : principal.FindAll(CybereyesClaims.Permission).Select(c => c.Value).Distinct(StringComparer.Ordinal).ToList();

        return TypedResults.Ok(new MeDto(user.Id, user.UserName ?? string.Empty, user.Email, user.FullName, principal.IsSuperuser(),
            roles.ToList(), permissions, user.TwoFactorEnabled, principal.IsMfaSatisfied()));
    }

    private static async Task<IResult> ChangePasswordAsync(ChangePasswordRequest request, ClaimsPrincipal principal,
        UserManager<AppUser> userManager, SignInManager<AppUser> signInManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result, "newPassword");
        }

        await signInManager.RefreshSignInAsync(user);
        await audit.LogAsync("password.changed", "user", user.Id.ToString(), null, user.UserName, ct);
        return TypedResults.NoContent();
    }

    private static string NormalizeCode(string code) => code.Replace(" ", string.Empty, StringComparison.Ordinal)
        .Replace("-", string.Empty, StringComparison.Ordinal);
}
