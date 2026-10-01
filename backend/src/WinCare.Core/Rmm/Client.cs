namespace WinCare.Core.Rmm;

public sealed class Client
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Site> Sites { get; set; } = [];
    public int? ServerPolicyId { get; set; }
    public int? WorkstationPolicyId { get; set; }
    public bool BlockPolicyInheritance { get; set; }
    public int? AlertTemplateId { get; set; }
}

public sealed class Site
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public Client? Client { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Agent> Agents { get; set; } = [];
    public int? ServerPolicyId { get; set; }
    public int? WorkstationPolicyId { get; set; }
    public bool BlockPolicyInheritance { get; set; }
    public int? AlertTemplateId { get; set; }
}
