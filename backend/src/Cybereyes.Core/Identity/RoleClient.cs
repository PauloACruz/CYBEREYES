namespace Cybereyes.Core.Identity;

/// <summary>Cliente que os usuarios de um papel restrito (<see cref="AppRole.AllClients"/> falso) podem ver.</summary>
public sealed class RoleClient
{
    public Guid RoleId { get; set; }
    public int ClientId { get; set; }
}
