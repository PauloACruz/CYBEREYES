namespace WinCare.Core.Identity;

public sealed class OidcProvider
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Authority { get; set; }
    public required string ClientId { get; set; }
    public string? ClientSecretEncrypted { get; set; }
    public string Scopes { get; set; } = "openid profile email";
    public string UsernameClaim { get; set; } = "preferred_username";
    public bool LinkByEmail { get; set; }
    public bool AutoProvision { get; set; }
    public Guid? DefaultRoleId { get; set; }
    public List<string> AllowedDomains { get; set; } = [];
    public bool TrustProviderMfa { get; set; }
    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Nome do provedor de login guardado em AspNetUserLogins.</summary>
    public string LoginProvider => $"oidc:{Id}";
}
