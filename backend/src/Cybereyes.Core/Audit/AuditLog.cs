namespace Cybereyes.Core.Audit;

public sealed class AuditLog
{
    public long Id { get; set; }
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
    public required string Username { get; set; }
    public required string Action { get; set; }
    public string? ObjectType { get; set; }
    public string? ObjectId { get; set; }
    public string? Message { get; set; }
    public string? IpAddress { get; set; }

    /// <summary>Agente de IA que executou a acao; <see cref="Username"/> e o tecnico que pediu.</summary>
    public string? Agent { get; set; }
}
