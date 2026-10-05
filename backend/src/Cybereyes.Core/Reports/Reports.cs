namespace Cybereyes.Core.Reports;

public static class ReportFormat
{
    public const string Pdf = "pdf";
    public const string Csv = "csv";

    public static bool IsValid(string? format) => format is Pdf or Csv;
}

/// <summary>Arquivo de relatorio gerado (manual ou agendado), guardado no banco por 90 dias.</summary>
public sealed class ReportRun
{
    public long Id { get; set; }
    public required string Type { get; set; }
    public required string Title { get; set; }
    public required string Format { get; set; }
    public string Status { get; set; } = "ok";
    public string? Error { get; set; }
    public string FileName { get; set; } = string.Empty;
    public long Size { get; set; }
    public byte[]? Data { get; set; }
    public string Params { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string RequestedBy { get; set; }
    public int? ScheduleId { get; set; }
    public List<string> EmailedTo { get; set; } = [];
}

public sealed class ReportSchedule
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public string Params { get; set; } = "{}";
    public string Format { get; set; } = ReportFormat.Pdf;
    public string Frequency { get; set; } = "weekly";
    public string Time { get; set; } = "07:00";
    public int? DayOfWeek { get; set; }
    public int? DayOfMonth { get; set; }
    public List<string> Recipients { get; set; } = [];
    public bool Enabled { get; set; } = true;
    public DateTimeOffset? LastRunAt { get; set; }
    public string? LastStatus { get; set; }
    public DateTimeOffset? NextRunAt { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Disparo de um agendamento em um horario: a chave unica impede que duas replicas gerem o mesmo relatorio.</summary>
public sealed class ReportDispatch
{
    public long Id { get; set; }
    public int ScheduleId { get; set; }
    public DateTimeOffset Slot { get; set; }
}
