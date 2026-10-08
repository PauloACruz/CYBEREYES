namespace Cybereyes.Core.Identity;

/// <summary>Cliente que um usuario restrito (<see cref="AppUser.AllClients"/> falso) pode ver.</summary>
public sealed class UserClient
{
    public Guid UserId { get; set; }
    public int ClientId { get; set; }
}
