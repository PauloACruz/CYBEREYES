namespace Cybereyes.Core.Rmm;

public sealed class KeyCaptureSession
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public Guid UserId { get; set; }
    public string Username { get; set; } = "";
    public string State { get; set; } = "active";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? StoppedAt { get; set; }
}

public sealed class KeyCaptureEntry
{
    public long Id { get; set; }
    public long SessionId { get; set; }
    public string Keys { get; set; } = "";
    public DateTimeOffset CapturedAt { get; set; }
}
