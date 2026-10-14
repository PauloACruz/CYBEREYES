using System.Buffers.Text;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

/// <summary>
/// Entrada por biometria do celular (passkeys do Identity, WebAuthn). A biometria substitui a senha; o codigo do autenticador
/// continua sendo pedido quando o aparelho nao passou pelo 2FA nos ultimos 30 dias (ADR-027).
/// </summary>
public static class PasskeyEndpoints
{
    /// <summary>Limite por conta: um por aparelho, com folga para troca de celular.</summary>
    public const int MaxPerUser = 10;

    public static void MapPasskeyEndpoints(this RouteGroupBuilder auth)
    {
        var group = auth.MapGroup("/passkeys");
        group.MapGet("/", ListAsync);
        group.MapPost("/register/options", RegisterOptionsAsync).RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapPost("/register", RegisterAsync).RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapDelete("/{id}", DeleteAsync);
        group.MapPost("/login/options", LoginOptionsAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
        group.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting(AuthSetup.AuthRateLimitPolicy);
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, UserManager<AppUser> userManager)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        var passkeys = await userManager.GetPasskeysAsync(user);
        return TypedResults.Ok(passkeys.OrderBy(p => p.CreatedAt).Select(ToDto).ToList());
    }

    /// <summary>Opcoes para o navegador criar a credencial no autenticador do aparelho (JSON do WebAuthn).</summary>
    private static async Task<IResult> RegisterOptionsAsync(ClaimsPrincipal principal, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        if ((await userManager.GetPasskeysAsync(user)).Count >= MaxPerUser)
        {
            return Problems.Conflict($"Limite de {MaxPerUser} aparelhos com biometria; remova um antes de cadastrar outro");
        }

        var name = user.UserName ?? user.Id.ToString();
        var options = await signInManager.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity
        {
            Id = user.Id.ToString(),
            Name = name,
            DisplayName = string.IsNullOrWhiteSpace(user.FullName) ? name : user.FullName,
        });
        return Results.Content(options, "application/json");
    }

    private static async Task<IResult> RegisterAsync(PasskeyRegisterRequest request, HttpContext context, ClaimsPrincipal principal,
        UserManager<AppUser> userManager, SignInManager<AppUser> signInManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        if (request.Credential.ValueKind != System.Text.Json.JsonValueKind.Object)
        {
            return Problems.Validation("credential", "Credencial ausente");
        }
        if ((await userManager.GetPasskeysAsync(user)).Count >= MaxPerUser)
        {
            return Problems.Conflict($"Limite de {MaxPerUser} aparelhos com biometria; remova um antes de cadastrar outro");
        }

        PasskeyAttestationResult attestation;
        try
        {
            attestation = await signInManager.PerformPasskeyAttestationAsync(request.Credential.GetRawText());
        }
        catch (InvalidOperationException)
        {
            // Sem pedido em andamento: o cookie do pedido expirou ou ja foi usado.
            return Problems.BadRequest("O pedido de cadastro expirou; tente de novo");
        }
        if (!attestation.Succeeded || attestation.UserEntity.Id != user.Id.ToString())
        {
            await audit.LogAsync("passkey.failed", "user", user.Id.ToString(), "Cadastro de biometria recusado", user.UserName, ct);
            return Problems.BadRequest("Nao foi possivel cadastrar a biometria deste aparelho");
        }

        var passkey = attestation.Passkey;
        passkey.Name = string.IsNullOrWhiteSpace(request.Name) ? DeviceName(context.Request.Headers.UserAgent.ToString()) : request.Name.Trim();
        var saved = await userManager.AddOrUpdatePasskeyAsync(user, passkey);
        if (!saved.Succeeded)
        {
            return Problems.FromIdentity(saved);
        }
        await audit.LogAsync("passkey.registered", "user", user.Id.ToString(), $"Biometria cadastrada: {passkey.Name}", user.UserName, ct);
        return TypedResults.Created($"/api/auth/passkeys/{Base64Url.EncodeToString(passkey.CredentialId)}", ToDto(passkey));
    }

    private static async Task<IResult> DeleteAsync(string id, ClaimsPrincipal principal, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Problems.Unauthorized("Autenticacao necessaria");
        }
        var credentialId = DecodeId(id);
        var passkey = credentialId is null ? null : await userManager.GetPasskeyAsync(user, credentialId);
        if (passkey is null)
        {
            return Problems.NotFound("Aparelho com biometria");
        }

        var removed = await userManager.RemovePasskeyAsync(user, passkey.CredentialId);
        if (!removed.Succeeded)
        {
            return Problems.FromIdentity(removed);
        }
        await audit.LogAsync("passkey.removed", "user", user.Id.ToString(), $"Biometria removida: {passkey.Name}", user.UserName, ct);
        return TypedResults.NoContent();
    }

    /// <summary>Desafio para entrar sem digitar o usuario: o aparelho oferece as credenciais que guardou para este endereco.</summary>
    private static async Task<IResult> LoginOptionsAsync(SignInManager<AppUser> signInManager) =>
        Results.Content(await signInManager.MakePasskeyRequestOptionsAsync(null), "application/json");

    private static async Task<IResult> LoginAsync(PasskeyLoginRequest request, HttpContext context, UserManager<AppUser> userManager,
        SignInManager<AppUser> signInManager, IAuditService audit, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (request.Credential.ValueKind != System.Text.Json.JsonValueKind.Object)
        {
            return Problems.Validation("credential", "Credencial ausente");
        }

        PasskeyAssertionResult<AppUser> assertion;
        try
        {
            assertion = await signInManager.PerformPasskeyAssertionAsync(request.Credential.GetRawText());
        }
        catch (InvalidOperationException)
        {
            return Problems.Unauthorized("O pedido de biometria expirou; tente de novo", ErrorCodes.InvalidCredentials);
        }
        if (!assertion.Succeeded)
        {
            await audit.LogAsync("login.failed", "user", null, "Biometria nao reconhecida", null, ct);
            return Problems.Unauthorized("Biometria nao reconhecida; entre com usuario e senha", ErrorCodes.InvalidCredentials);
        }

        var user = assertion.User;
        if (!user.IsActive || !await signInManager.CanSignInAsync(user))
        {
            await audit.LogAsync("login.failed", "user", user.Id.ToString(), "Biometria de usuario inativo", user.UserName, ct);
            return Problems.Unauthorized("Usuario ou senha incorretos", ErrorCodes.InvalidCredentials);
        }
        // A biometria entra no lugar da senha: vale a mesma politica de SSO e o mesmo bloqueio por tentativas.
        if (await Sso.SsoPolicy.PasswordLoginBlockedAsync(user, db, ct))
        {
            await audit.LogAsync("login.failed", "user", user.Id.ToString(), "Login sem SSO desativado (biometria)", user.UserName, ct);
            return Problems.Forbidden("O login por senha esta desativado; entre pelo SSO", Sso.SsoErrors.PasswordLoginDisabled);
        }
        if (await userManager.IsLockedOutAsync(user))
        {
            await audit.LogAsync("login.locked", "user", user.Id.ToString(), "Conta bloqueada por tentativas", user.UserName, ct);
            return Problems.Forbidden("Conta bloqueada temporariamente por excesso de tentativas", ErrorCodes.LockedOut);
        }

        // Contador de assinaturas e estado de copia de seguranca atualizados pela verificacao.
        var saved = await userManager.AddOrUpdatePasskeyAsync(user, assertion.Passkey);
        if (!saved.Succeeded)
        {
            return Problems.Unauthorized("Biometria nao reconhecida; entre com usuario e senha", ErrorCodes.InvalidCredentials);
        }

        if (!user.TwoFactorEnabled)
        {
            // Sem 2FA (redefinido pelo administrador) a biometria nao abre sessao: configurar um autenticador novo exige a senha.
            await audit.LogAsync("login.failed", "user", user.Id.ToString(), "Biometria sem 2FA configurado", user.UserName, ct);
            return Problems.Unauthorized("Entre com usuario e senha para configurar a verificacao em duas etapas", ErrorCodes.InvalidCredentials);
        }

        if (await signInManager.IsTwoFactorClientRememberedAsync(user))
        {
            await signInManager.SignInWithClaimsAsync(user, request.RememberMe ?? false, [new Claim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa)]);
            user.LastLoginAt = time.GetUtcNow();
            await userManager.UpdateAsync(user);
            await audit.LogAsync("login.success", "user", user.Id.ToString(),
                $"Login com biometria ({assertion.Passkey.Name}) em aparelho lembrado (2FA nos ultimos 30 dias)", user.UserName, ct);
            return TypedResults.Ok(new LoginResponse("ok"));
        }

        // Aparelho sem 2FA recente: guarda o usuario como o Identity faz depois da senha e pede o codigo do autenticador.
        var pending = new ClaimsIdentity(IdentityConstants.TwoFactorUserIdScheme);
        pending.AddClaim(new Claim(ClaimTypes.Name, user.Id.ToString()));
        await context.SignInAsync(IdentityConstants.TwoFactorUserIdScheme, new ClaimsPrincipal(pending));
        return TypedResults.Ok(new LoginResponse("requires2fa"));
    }

    private static PasskeyDto ToDto(UserPasskeyInfo passkey) =>
        new(Base64Url.EncodeToString(passkey.CredentialId), passkey.Name ?? "Aparelho", passkey.CreatedAt, passkey.IsBackedUp);

    private static byte[]? DecodeId(string id)
    {
        try
        {
            return id.Length is > 0 and <= 1400 ? Base64Url.DecodeFromChars(id) : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>Nome do aparelho pelo navegador que cadastrou (o tecnico ve na lista para saber qual remover).</summary>
    internal static string DeviceName(string userAgent) => userAgent switch
    {
        _ when userAgent.Contains("iPhone", StringComparison.Ordinal) => "iPhone",
        _ when userAgent.Contains("iPad", StringComparison.Ordinal) => "iPad",
        _ when userAgent.Contains("Android", StringComparison.Ordinal) => "Android",
        _ when userAgent.Contains("Windows", StringComparison.Ordinal) => "Windows",
        _ when userAgent.Contains("Macintosh", StringComparison.Ordinal) => "Mac",
        _ => "Aparelho",
    };
}
