using System.ComponentModel.DataAnnotations;

namespace WinCare.Api.Endpoints;

public sealed record LoginRequest(
    [property: Required, StringLength(150)] string Username,
    [property: Required, StringLength(256)] string Password,
    bool? RememberMe);

public sealed record TwoFactorRequest([property: Required, StringLength(16)] string Code, bool? RememberMe);

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

public sealed record UserDto(Guid Id, string Username, string? Email, string FullName, bool IsActive, bool TwoFactorEnabled,
    IReadOnlyList<RoleRef> Roles, DateTimeOffset? LastLoginAt, DateTimeOffset CreatedAt)
{
    public IReadOnlyList<SsoLoginRef>? SsoLogins { get; init; }
    public bool? HasPassword { get; init; }
}

public sealed record SsoLoginRef(int ProviderId, string ProviderName);

public sealed record CreateUserRequest(
    [property: Required, StringLength(150, MinimumLength = 3), RegularExpression(@"^[a-zA-Z0-9._@-]+$")] string Username,
    [property: Required, EmailAddress, StringLength(256)] string Email,
    [property: Required, StringLength(200)] string FullName,
    [property: Required, StringLength(256)] string Password,
    IReadOnlyList<Guid>? RoleIds,
    bool IsActive = true);

public sealed record UpdateUserRequest(
    [property: Required, EmailAddress, StringLength(256)] string Email,
    [property: Required, StringLength(200)] string FullName,
    IReadOnlyList<Guid>? RoleIds,
    bool IsActive);

public sealed record ResetPasswordRequest([property: Required, StringLength(256)] string NewPassword);

public sealed record RoleDto(Guid Id, string Name, bool IsSuperuser, IReadOnlyList<string> Permissions, int UserCount);

public sealed record SaveRoleRequest(
    [property: Required, StringLength(100, MinimumLength = 2)] string Name,
    bool IsSuperuser,
    IReadOnlyList<string>? Permissions);

public sealed record ApiKeyDto(Guid Id, string Name, string Prefix, string Username, DateTimeOffset? ExpiresAt,
    DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

public sealed record CreatedApiKeyDto(Guid Id, string Name, string Prefix, string Username, DateTimeOffset? ExpiresAt,
    DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, string Key);

public sealed record CreateApiKeyRequest([property: Required, StringLength(100, MinimumLength = 2)] string Name, DateTimeOffset? ExpiresAt);

public sealed record AuditDto(long Id, DateTimeOffset Timestamp, string Username, string Action, string? ObjectType,
    string? ObjectId, string? Message, string? IpAddress);

internal static class Paging
{
    public static (int Page, int PageSize) Normalize(int? page, int? pageSize, int defaultSize = 25) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? defaultSize, 1, 200));
}
