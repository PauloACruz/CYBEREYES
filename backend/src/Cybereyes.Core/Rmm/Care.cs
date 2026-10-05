namespace Cybereyes.Core.Rmm;

/// <summary>Modulo de manutencao (Cybereyes Care). O nome visivel e fixo: nao acompanha o branding configuravel.</summary>
public static class CareModule
{
    public const string CareDisplayName = "Cybereyes Care";
}

public static class CareRunStatus
{
    public const string Running = "running";
    public const string Ok = "ok";
    public const string Warning = "warning";
    public const string Error = "error";
    public const string Cancelled = "cancelled";
    public const string Timeout = "timeout";

    public static readonly string[] Final = [Ok, Warning, Error, Cancelled, Timeout];
}

/// <summary>Execucao de um modulo do Cybereyes Care em um agente. O estado em andamento e derivado dos eventos; a linha so muda no fim.</summary>
public sealed class CareRun
{
    public long Id { get; set; }
    public required string RunId { get; set; }
    public int AgentId { get; set; }
    public required string Module { get; set; }
    public List<string> Tasks { get; set; } = [];
    public string Params { get; set; } = "{}";
    public string Status { get; set; } = CareRunStatus.Running;
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public required string RequestedBy { get; set; }
    public string Source { get; set; } = "console";
    public bool RebootRequired { get; set; }
    public string? Error { get; set; }
}

public sealed class CareRunEvent
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
