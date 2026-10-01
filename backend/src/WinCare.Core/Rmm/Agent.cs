namespace WinCare.Core.Rmm;

public static class AgentStatus
{
    public const string Online = "online";
    public const string Offline = "offline";
    public const string Overdue = "overdue";

    public static string Compute(DateTimeOffset? lastSeen, int offlineMinutes, int overdueMinutes, DateTimeOffset now)
    {
        if (lastSeen is not { } seen)
        {
            return Offline;
        }

        var offline = now.AddMinutes(-offlineMinutes);
        var overdue = now.AddMinutes(-overdueMinutes);
        if (seen < offline && seen > overdue)
        {
            return Offline;
        }
        return seen < offline && seen < overdue ? Overdue : Online;
    }
}

public static class MonitoringType
{
    public const string Server = "server";
    public const string Workstation = "workstation";

    public static bool IsValid(string? value) => value is Server or Workstation;
}

public sealed class Agent
{
    public int Id { get; set; }
    public required string AgentId { get; set; }
    public required string Hostname { get; set; }
    public int SiteId { get; set; }
    public Site? Site { get; set; }
    public string MonitoringType { get; set; } = Rmm.MonitoringType.Server;
    public string? Description { get; set; }
    public string? MeshNodeId { get; set; }
    public string? GoArch { get; set; }
    public string Plat { get; set; } = "windows";
    public string Version { get; set; } = "0.1.0";
    public string? OperatingSystem { get; set; }
    public DateTimeOffset? LastSeen { get; set; }
    public string Status { get; set; } = AgentStatus.Offline;
    public string? PublicIp { get; set; }
    public int? TotalRam { get; set; }
    public double? BootTime { get; set; }
    public string? LoggedInUsername { get; set; }
    public string? LastLoggedInUser { get; set; }
    public bool NeedsReboot { get; set; }
    public bool ChocoInstalled { get; set; }
    public string? Disks { get; set; }
    public string? Services { get; set; }
    public string? WmiDetail { get; set; }
    public int CheckInterval { get; set; } = 120;
    public int OfflineTime { get; set; } = 4;
    public int OverdueTime { get; set; } = 30;
    public required string TokenHash { get; set; }
    public required string NatsPasswordHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public int? PolicyId { get; set; }
    public bool BlockPolicyInheritance { get; set; }
    public int? AlertTemplateId { get; set; }
    public bool SnmpCollector { get; set; }
}

public sealed class AgentSoftware
{
    public int AgentId { get; set; }
    public Agent? Agent { get; set; }
    public required string Software { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
