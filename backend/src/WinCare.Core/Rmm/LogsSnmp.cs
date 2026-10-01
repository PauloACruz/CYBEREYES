namespace WinCare.Core.Rmm;

public static class LogLevels
{
    public const string Critical = "critical";
    public const string Error = "error";
    public const string Warning = "warning";
    public const string Info = "info";

    public static readonly string[] Ordered = [Info, Warning, Error, Critical];

    public static bool IsValid(string? level) => level is not null && Array.IndexOf(Ordered, level) >= 0;

    /// <summary>Niveis iguais ou mais graves que <paramref name="min"/>.</summary>
    public static string[] AtLeast(string min) => Ordered.Skip(Math.Max(0, Array.IndexOf(Ordered, min))).ToArray();
}

/// <summary>Linha de log de sistema. A tabela e particionada por mes em <see cref="Time"/>; a chave e (Id, Time).</summary>
public sealed class SystemLog
{
    public long Id { get; set; }
    public DateTimeOffset Time { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
    public int? AgentId { get; set; }
    public int? SnmpDeviceId { get; set; }
    public int ClientId { get; set; }
    public required string Level { get; set; }
    public string Source { get; set; } = string.Empty;
    public string Log { get; set; } = string.Empty;
    public long? EventId { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? Host { get; set; }
}

public sealed class LogAlertRule
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int? ClientId { get; set; }
    public string MinLevel { get; set; } = LogLevels.Error;
    public string? SourceContains { get; set; }
    public string? MessageContains { get; set; }
    public int Threshold { get; set; } = 1;
    public int WindowMinutes { get; set; } = 15;
    public string Severity { get; set; } = Rmm.Severity.Warning;
    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public static class SnmpStatus
{
    public const string Up = "up";
    public const string Down = "down";
    public const string Unknown = "unknown";
}

public sealed class SnmpDevice
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public int? CollectorAgentId { get; set; }
    public int? AssetId { get; set; }
    public required string Name { get; set; }
    public required string Host { get; set; }
    public int Port { get; set; } = 161;
    public string Version { get; set; } = "v2c";
    public string? CommunityEncrypted { get; set; }
    public string? V3Username { get; set; }
    public string? V3SecurityLevel { get; set; }
    public string? V3AuthProtocol { get; set; }
    public string? V3AuthPasswordEncrypted { get; set; }
    public string? V3PrivProtocol { get; set; }
    public string? V3PrivPasswordEncrypted { get; set; }
    public int Interval { get; set; } = 300;
    public int Timeout { get; set; } = 5;
    public int Retries { get; set; } = 1;
    public bool PollInterfaces { get; set; } = true;
    public bool Enabled { get; set; } = true;
    public string TrapSeverity { get; set; } = "none";
    public string Status { get; set; } = SnmpStatus.Unknown;
    public DateTimeOffset? LastPolledAt { get; set; }
    public string? LastError { get; set; }
    public int FailCount { get; set; }
    public string? SysName { get; set; }
    public string? SysDescr { get; set; }
    public string? SysObjectId { get; set; }
    public string? SysLocation { get; set; }
    public string? SysContact { get; set; }
    public long? UptimeSeconds { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SnmpInterface
{
    public int DeviceId { get; set; }
    public int Index { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Descr { get; set; } = string.Empty;
    public string Alias { get; set; } = string.Empty;
    public int Type { get; set; }
    public long SpeedBps { get; set; }
    public string AdminStatus { get; set; } = string.Empty;
    public string OperStatus { get; set; } = string.Empty;
    public decimal? LastIn { get; set; }
    public decimal? LastOut { get; set; }
    public DateTimeOffset? LastAt { get; set; }
    public double? InBps { get; set; }
    public double? OutBps { get; set; }
    public long InErrors { get; set; }
    public long OutErrors { get; set; }
    public bool Monitored { get; set; }
}

public sealed class SnmpSensor
{
    public int Id { get; set; }
    public int DeviceId { get; set; }
    public required string Name { get; set; }
    public required string Oid { get; set; }
    public string Unit { get; set; } = string.Empty;
    public double? WarnAbove { get; set; }
    public double? CritAbove { get; set; }
    public double? WarnBelow { get; set; }
    public double? CritBelow { get; set; }
    public double? LastValue { get; set; }
    public string? LastText { get; set; }
    public DateTimeOffset? LastAt { get; set; }
}

/// <summary>Amostra de metrica SNMP. Particionada por mes em <see cref="Time"/>; chave (DeviceId, Metric, Time).</summary>
public sealed class SnmpSample
{
    public int DeviceId { get; set; }
    public required string Metric { get; set; }
    public DateTimeOffset Time { get; set; }
    public double Value { get; set; }
}
