namespace WinCare.Core.Rmm;

public sealed class InstallerToken
{
    public int Id { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Deployment
{
    public int Id { get; set; }
    public Guid Uid { get; set; } = Guid.NewGuid();
    public int SiteId { get; set; }
    public Site? Site { get; set; }
    public string MonitoringType { get; set; } = Rmm.MonitoringType.Workstation;
    public string GoArch { get; set; } = "amd64";
    public DateTimeOffset ExpiresAt { get; set; }
    public int InstallerTokenId { get; set; }
    public InstallerToken? InstallerToken { get; set; }
    public required string ProtectedToken { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
