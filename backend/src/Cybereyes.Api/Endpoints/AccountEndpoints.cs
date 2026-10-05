using Microsoft.AspNetCore.Identity;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Sso;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Endpoints;

/// <summary>Recuperacao de senha e aceite de convite por link enviado por e-mail (anonimos, com limite de tentativas).</summary>
public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this RouteGroupBuilder auth)
    {
        auth.MapPost("/password/forgot", ForgotPasswordAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        auth.MapPost("/password/reset", ResetPasswordAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        auth.MapGet("/invite", InviteInfoAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        auth.MapPost("/invite/accept", AcceptInviteAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
    }

    /// <summary>Responde 202 sempre, exista a conta ou nao, para nao revelar quais usuarios existem.</summary>
    private static async Task<IResult> ForgotPasswordAsync(ForgotPasswordRequest request, HttpContext ctx, IConfiguration config,
        UserManager<AppUser> userManager, AccountEmails emails, IAuditService audit, CybereyesDbContext db, CancellationToken ct)
    {
        var login = request.Login.Trim();
        var user = await userManager.FindByNameAsync(login) ?? (login.Contains('@') ? await userManager.FindByEmailAsync(login) : null);
        if (user is { IsActive: true, Email.Length: > 0 } && !await SsoPolicy.PasswordLoginBlockedAsync(user, db, ct) &&
            await emails.QueuePasswordResetAsync(user, InstallerEndpoints.PublicUrl(ctx, config), ct))
        {
            await audit.LogAsync(AccountEmails.ResetRequestedAction, "user", user.Id.ToString(), "Link de redefinicao de senha enviado por e-mail",
                user.UserName, ct);
        }
        return TypedResults.Accepted(default(string));
    }

    private static async Task<IResult> ResetPasswordAsync(ResetPasswordWithTokenRequest request, UserManager<AppUser> userManager,
        IAuditService audit, CybereyesDbContext db, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(request.UserId.ToString());
        if (user is null || !user.IsActive || await SsoPolicy.PasswordLoginBlockedAsync(user, db, ct))
        {
            return InvalidLink();
        }

        var result = await userManager.ResetPasswordAsync(user, request.Token, request.NewPassword);
        if (!result.Succeeded)
        {
            return result.Errors.Any(e => e.Code == nameof(IdentityErrorDescriber.InvalidToken)) ? InvalidLink() : Problems.FromIdentity(result, "newPassword");
        }

        await userManager.SetLockoutEndDateAsync(user, null);
        await userManager.ResetAccessFailedCountAsync(user);
        await audit.LogAsync("user.password-reset-self", "user", user.Id.ToString(), "Senha redefinida pelo link enviado por e-mail", user.UserName, ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> InviteInfoAsync(Guid uid, string token, UserManager<AppUser> userManager, AccountEmails emails)
    {
        var (user, problem) = await FindInvitedAsync(uid, token, userManager, emails);
        return problem ?? TypedResults.Ok(new InviteInfoDto(user!.UserName ?? string.Empty, user.FullName));
    }

    private static async Task<IResult> AcceptInviteAsync(AcceptInviteRequest request, UserManager<AppUser> userManager, AccountEmails emails,
        IAuditService audit, CancellationToken ct)
    {
        var (user, problem) = await FindInvitedAsync(request.UserId, request.Token, userManager, emails);
        if (problem is not null)
        {
            return problem;
        }

        // AddPassword troca o security stamp: o link do convite deixa de valer.
        var result = await userManager.AddPasswordAsync(user!, request.Password);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }
        user!.EmailConfirmed = true;
        await userManager.UpdateAsync(user);
        await audit.LogAsync("user.invite-accepted", "user", user.Id.ToString(), "Convite aceito e senha definida", user.UserName, ct);
        return TypedResults.NoContent();
    }

    private static async Task<(AppUser? User, IResult? Problem)> FindInvitedAsync(Guid userId, string token, UserManager<AppUser> userManager,
        AccountEmails emails)
    {
        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null || !user.IsActive)
        {
            return (null, InvalidLink());
        }
        if (user.PasswordHash is not null)
        {
            return (null, Problems.Create(StatusCodes.Status400BadRequest, "Este convite ja foi usado; entre com seu usuario e senha",
                ErrorCodes.InvalidToken));
        }
        return await emails.VerifyInviteAsync(user, token) ? (user, null) : (null, InvalidLink());
    }

    private static IResult InvalidLink() =>
        Problems.Create(StatusCodes.Status400BadRequest, "Link invalido ou expirado; peca um novo", ErrorCodes.InvalidToken);
}
