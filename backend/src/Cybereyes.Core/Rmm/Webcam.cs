namespace Cybereyes.Core.Rmm;

/// <summary>Historico das sessoes de webcam ao vivo abertas pelo console.</summary>
public sealed class WebcamSessionLog
{
    public int Id { get; set; }
    public required string SessionId { get; set; }
    public int AgentId { get; set; }
    public Agent? Agent { get; set; }
    public required string Username { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public int Snapshots { get; set; }
}
