using System.ComponentModel.DataAnnotations;

namespace Cybereyes.Api.Endpoints;

public sealed record LoginRequest(
    [property: Required, StringLength(150)] string Username,
    [property: Required, StringLength(256)] string Password,
    bool? RememberMe);

/// <summary>RememberDevice: este aparelho nao pede o codigo de novo por <see cref="Infrastructure.AuthSetup.RememberDeviceLifespan"/>.</summary>
public sealed record TwoFactorRequest([property: Required, StringLength(16)] string Code, bool? RememberMe, bool? RememberDevice = null);

public sealed record RememberedDeviceResponse(bool Remembered, DateTimeOffset? ExpiresAt);

/// <summary>Credential: o PublicKeyCredential do navegador em JSON (WebAuthn). Name: opcional; sem ele vale o tipo do aparelho.</summary>
public sealed record PasskeyRegisterRequest(System.Text.Json.JsonElement Credential, [property: StringLength(60)] string? Name = null);

public sealed record PasskeyLoginRequest(System.Text.Json.JsonElement Credential, bool? RememberMe = null);

/// <summary>Id: id da credencial em base64url. Synced: a credencial tem copia na nuvem do aparelho (iCloud, Google).</summary>
public sealed record PasskeyDto(string Id, string Name, DateTimeOffset CreatedAt, bool Synced);

public sealed record RecoveryRequest([property: Required, StringLength(64)] string RecoveryCode);

public sealed record CodeRequest([property: Required, StringLength(16)] string Code);

public sealed record ChangePasswordRequest(
    [property: Required, StringLength(256)] string CurrentPassword,
    [property: Required, StringLength(256)] string NewPassword);

public sealed record LoginResponse(string Status);

public sealed record TwoFactorSetupResponse(string SharedKey, string OtpauthUri);

public sealed record EnableTwoFactorResponse(string Status, IReadOnlyList<string> RecoveryCodes);

public sealed record MeDto(Guid Id, string Username, string? Email, string FullName, bool IsSuperuser,
    IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions, bool TwoFactorEnabled, bool MfaSatisfied);

public sealed record Paged<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public sealed record RoleRef(Guid Id, string Name);

public sealed record ClientRef(int Id, string Name);

/// <summary><see cref="AllClients"/> falso: o usuario so ve <see cref="Clients"/> (administradores veem todos).</summary>
public sealed record UserDto(Guid Id, string Username, string? Email, string FullName, bool IsActive, bool TwoFactorEnabled,
    IReadOnlyList<RoleRef> Roles, DateTimeOffset? LastLoginAt, DateTimeOffset CreatedAt, bool AllClients, IReadOnlyList<ClientRef> Clients)
{
    public IReadOnlyList<SsoLoginRef>? SsoLogins { get; init; }
    public bool? HasPassword { get; init; }
    public bool InvitePending { get; init; }
    /// <summary>Todos os papeis do usuario sao restritos: ele ve so os clientes deles (cruzados com <see cref="Clients"/>, se restrito).</summary>
    public bool RolesRestrictClients { get; init; }
    /// <summary>Preenchido so na criacao com convite, quando o usuario foi criado mas o e-mail nao saiu.</summary>
    public string? InviteError { get; init; }
}

public sealed record SsoLoginRef(int ProviderId, string ProviderName);

/// <summary>Sem senha, o usuario e criado pendente e recebe o convite por e-mail (SendInvite).</summary>
public sealed record CreateUserRequest(
    [property: Required, StringLength(150, MinimumLength = 3), RegularExpression(@"^[a-zA-Z0-9._@-]+$")] string Username,
    [property: Required, EmailAddress, StringLength(256)] string Email,
    [property: Required, StringLength(200)] string FullName,
    [property: StringLength(256)] string? Password,
    IReadOnlyList<Guid>? RoleIds,
    bool IsActive = true,
    bool SendInvite = false,
    bool AllClients = true,
    IReadOnlyList<int>? ClientIds = null);

public sealed record ForgotPasswordRequest([property: Required, StringLength(256)] string Login);

public sealed record ResetPasswordWithTokenRequest(
    Guid UserId,
    [property: Required, StringLength(2000)] string Token,
    [property: Required, StringLength(256)] string NewPassword);

public sealed record AcceptInviteRequest(
    Guid UserId,
    [property: Required, StringLength(2000)] string Token,
    [property: Required, StringLength(256)] string Password);

public sealed record InviteInfoDto(string Username, string FullName);

/// <summary>Sem <see cref="AllClients"/> e <see cref="ClientIds"/>, o acesso a clientes fica como esta.</summary>
public sealed record UpdateUserRequest(
    [property: Required, EmailAddress, StringLength(256)] string Email,
    [property: Required, StringLength(200)] string FullName,
    IReadOnlyList<Guid>? RoleIds,
    bool IsActive,
    bool? AllClients = null,
    IReadOnlyList<int>? ClientIds = null);

public sealed record ResetPasswordRequest([property: Required, StringLength(256)] string NewPassword);

/// <summary><see cref="AllClients"/> falso: quem so tem papeis restritos ve apenas a soma dos <see cref="Clients"/> deles.</summary>
public sealed record RoleDto(Guid Id, string Name, bool IsSuperuser, IReadOnlyList<string> Permissions, int UserCount, bool AllClients,
    IReadOnlyList<ClientRef> Clients);

/// <summary>Sem <see cref="AllClients"/> e <see cref="ClientIds"/>, o acesso a clientes fica como esta (papel novo: todos).</summary>
public sealed record SaveRoleRequest(
    [property: Required, StringLength(100, MinimumLength = 2)] string Name,
    bool IsSuperuser,
    IReadOnlyList<string>? Permissions,
    bool? AllClients = null,
    IReadOnlyList<int>? ClientIds = null);

public sealed record ApiKeyDto(Guid Id, string Name, string Prefix, string Username, DateTimeOffset? ExpiresAt,
    DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

public sealed record CreatedApiKeyDto(Guid Id, string Name, string Prefix, string Username, DateTimeOffset? ExpiresAt,
    DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, string Key);

/// <summary><c>UserId</c>: dono da chave quando nao e quem cria (somente superusuarios; ex.: o usuario de um agente de IA).</summary>
public sealed record CreateApiKeyRequest([property: Required, StringLength(100, MinimumLength = 2)] string Name, DateTimeOffset? ExpiresAt,
    Guid? UserId = null);

public sealed record AuditDto(long Id, DateTimeOffset Timestamp, string Username, string Action, string? ObjectType,
    string? ObjectId, string? Message, string? IpAddress, string? Agent = null);

internal static class Paging
{
    public static (int Page, int PageSize) Normalize(int? page, int? pageSize, int defaultSize = 25) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? defaultSize, 1, 200));
}
