namespace Cybereyes.Core.Tickets;

public static class TicketStatus
{
    public const string New = "new";
    public const string InProgress = "in_progress";
    public const string WaitingUser = "waiting_user";
    public const string Resolved = "resolved";
    public const string Closed = "closed";

    public static readonly string[] All = [New, InProgress, WaitingUser, Resolved, Closed];
    public static readonly string[] Open = [New, InProgress, WaitingUser];
}

public static class TicketPriority
{
    public const string Low = "low";
    public const string Medium = "medium";
    public const string High = "high";
    public const string Critical = "critical";

    public static readonly string[] All = [Low, Medium, High, Critical];
}

public static class TicketType
{
    public const string Request = "request";
    public const string Incident = "incident";

    public static readonly string[] All = [Request, Incident];
}

public static class TicketSource
{
    public const string Console = "console";
    public const string Tray = "tray";
    public const string Alert = "alert";
}

public static class MessageAuthor
{
    public const string Technician = "technician";
    public const string Requester = "requester";
    public const string System = "system";
}

[System.Diagnostics.CodeAnalysis.SuppressMessage("Naming", "CA1711", Justification = "Fila de atendimento e o termo do dominio, nao uma colecao")]
public sealed class TicketQueue
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public bool IsDefault { get; set; }
}

public sealed class Ticket
{
    public int Id { get; set; }
    public string Type { get; set; } = TicketType.Request;
    public required string Title { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = TicketStatus.New;
    public string Priority { get; set; } = TicketPriority.Medium;
    public int QueueId { get; set; }
    public TicketQueue? Queue { get; set; }
    public int? AgentId { get; set; }
    public int? ClientId { get; set; }
    public int? SiteId { get; set; }
    public required string RequesterName { get; set; }
    public string? RequesterUsername { get; set; }
    public string? RequesterEmail { get; set; }
    public Guid? AssignedToId { get; set; }
    public long? AlertId { get; set; }
    public string Source { get; set; } = TicketSource.Console;
    public Guid? CreatedById { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FirstResponseAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public DateTimeOffset? FirstResponseDueAt { get; set; }
    public DateTimeOffset? ResolutionDueAt { get; set; }
    public DateTimeOffset? LastMessageAt { get; set; }
    public string? LastMessageAuthor { get; set; }
}

public sealed class TicketMessage
{
    public long Id { get; set; }
    public int TicketId { get; set; }
    public required string AuthorType { get; set; }
    public Guid? AuthorUserId { get; set; }
    public required string AuthorName { get; set; }
    public required string Body { get; set; }
    public bool Internal { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class TicketAttachment
{
    public long Id { get; set; }
    public int TicketId { get; set; }
    public long? MessageId { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public required string UploadedBy { get; set; }
    public bool Internal { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Conteudo do anexo em tabela separada para que listagens nao carreguem os bytes.</summary>
public sealed class TicketAttachmentData
{
    public long AttachmentId { get; set; }
    public required byte[] Content { get; set; }
}

public sealed class TimeEntry
{
    public long Id { get; set; }
    public int TicketId { get; set; }
    public Guid UserId { get; set; }
    public int Minutes { get; set; }
    public string? Description { get; set; }
    public DateOnly WorkDate { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SlaRule
{
    public required string Priority { get; set; }
    public int FirstResponseMinutes { get; set; }
    public int ResolutionMinutes { get; set; }

    public static IReadOnlyList<SlaRule> Defaults() =>
    [
        new() { Priority = TicketPriority.Critical, FirstResponseMinutes = 30, ResolutionMinutes = 240 },
        new() { Priority = TicketPriority.High, FirstResponseMinutes = 60, ResolutionMinutes = 480 },
        new() { Priority = TicketPriority.Medium, FirstResponseMinutes = 240, ResolutionMinutes = 1440 },
        new() { Priority = TicketPriority.Low, FirstResponseMinutes = 480, ResolutionMinutes = 4320 },
    ];
}

public sealed class TrayToken
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public required string Username { get; set; }
    public required string TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
