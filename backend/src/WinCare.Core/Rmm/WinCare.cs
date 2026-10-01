namespace WinCare.Core.Rmm;

public static class WinCareRunStatus
{
    public const string Running = "running";
    public const string Ok = "ok";
    public const string Warning = "warning";
    public const string Error = "error";
    public const string Cancelled = "cancelled";
    public const string Timeout = "timeout";

    public static readonly string[] Final = [Ok, Warning, Error, Cancelled, Timeout];
}

/// <summary>Execucao de um modulo WinCare em um agente. O estado em andamento e derivado dos eventos; a linha so muda no fim.</summary>
public sealed class WinCareRun
{
    public long Id { get; set; }
    public required string RunId { get; set; }
    public int AgentId { get; set; }
    public required string Module { get; set; }
    public List<string> Tasks { get; set; } = [];
    public string Params { get; set; } = "{}";
    public string Status { get; set; } = WinCareRunStatus.Running;
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public required string RequestedBy { get; set; }
    public string Source { get; set; } = "console";
    public bool RebootRequired { get; set; }
    public string? Error { get; set; }
}

public sealed class WinCareRunEvent
{
    public long Id { get; set; }
    public required string RunId { get; set; }
    public int Seq { get; set; }
    public required string Type { get; set; }
    public required string Data { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class AgentHealth
{
    public int AgentId { get; set; }
    public int Score { get; set; }
    public required string Grade { get; set; }
    public required string Report { get; set; }
    public DateTimeOffset CollectedAt { get; set; }
}
