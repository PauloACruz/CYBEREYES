namespace Cybereyes.Core.Identity;

public sealed class ApiKey
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public required string Prefix { get; set; }
    public required string KeyHash { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}
