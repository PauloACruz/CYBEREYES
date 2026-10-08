using Microsoft.AspNetCore.Identity;

namespace Cybereyes.Core.Identity;

public sealed class AppUser : IdentityUser<Guid>
{
    public string FullName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;

    /// <summary>Falso: o usuario so ve os clientes de <see cref="UserClient"/>. Papeis de administrador ignoram a restricao.</summary>
    public bool AllClients { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastLoginAt { get; set; }
}
