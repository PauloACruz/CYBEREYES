namespace Cybereyes.Core.Inventory;

public static class AssetType
{
    public const string Workstation = "workstation";
    public const string Server = "server";
    public const string Laptop = "laptop";

    public static readonly string[] All =
        [Workstation, Server, Laptop, "printer", "switch", "router", "firewall", "access_point", "phone", "monitor", "ups", "other"];
}

public static class AssetStatus
{
    public const string Active = "active";
    public const string Retired = "retired";

    public static readonly string[] All = [Active, "stock", "maintenance", Retired];
}

public static class IpKind
{
    public static readonly string[] All = ["static", "reserved", "dhcp"];
}

public static class DocOwner
{
    public const string Asset = "asset";
    public const string Network = "network";
    public const string Page = "page";

    public static readonly string[] All = [Asset, Network, Page];
}

public sealed class Asset
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public int? AgentId { get; set; }
    public bool FromAgent { get; set; }
    public string Type { get; set; } = "other";
    public required string Name { get; set; }
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string? SerialNumber { get; set; }
    public string? AssetTag { get; set; }
    public string Status { get; set; } = AssetStatus.Active;
    public DateOnly? PurchaseDate { get; set; }
    public DateOnly? WarrantyUntil { get; set; }
    public string? Location { get; set; }
    public string? IpAddress { get; set; }
    public string? MacAddress { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Person
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public required string Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Department { get; set; }
    public string? JobTitle { get; set; }
    public string? Username { get; set; }
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class AssetAssignment
{
    public long Id { get; set; }
    public int AssetId { get; set; }
    public int PersonId { get; set; }
    public DateTimeOffset AssignedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UnassignedAt { get; set; }
    public required string AssignedBy { get; set; }
    public string? Notes { get; set; }
}

public sealed class Network
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public required string Name { get; set; }
    public required string Cidr { get; set; }
    public int? VlanId { get; set; }
    public string? VlanName { get; set; }
    public string? Gateway { get; set; }
    public string? DnsServers { get; set; }
    public string? DhcpRange { get; set; }
    public string? Description { get; set; }
}

public sealed class IpRecord
{
    public long Id { get; set; }
    public int NetworkId { get; set; }
    public required string Address { get; set; }
    public int? AssetId { get; set; }
    public string? Hostname { get; set; }
    public string? MacAddress { get; set; }
    public string Kind { get; set; } = "static";
    public string? Description { get; set; }
}

public sealed class Diagram
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public required string Name { get; set; }
    public string Data { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }
}

public sealed class Credential
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public int? AssetId { get; set; }
    public required string Name { get; set; }
    public string? Username { get; set; }
    public required string SecretEncrypted { get; set; }
    public string? Url { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }
}

public sealed class DocPage
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public int? SiteId { get; set; }
    public required string Title { get; set; }
    public string Body { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }
}

public sealed class DocAttachment
{
    public long Id { get; set; }
    public required string OwnerType { get; set; }
    public int OwnerId { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public required string UploadedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class DocAttachmentData
{
    public long AttachmentId { get; set; }
    public required byte[] Content { get; set; }
}
