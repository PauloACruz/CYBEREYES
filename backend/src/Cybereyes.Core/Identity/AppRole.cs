using Microsoft.AspNetCore.Identity;

namespace Cybereyes.Core.Identity;

public sealed class AppRole : IdentityRole<Guid>
{
    public bool IsSuperuser { get; set; }
    public List<string> Permissions { get; set; } = [];

    /// <summary>Falso: quem tem so papeis restritos ve apenas os clientes de <see cref="RoleClient"/> deles. Superusuario ignora.</summary>
    public bool AllClients { get; set; } = true;
}
