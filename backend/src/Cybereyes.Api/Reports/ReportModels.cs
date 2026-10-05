using System.Globalization;

namespace Cybereyes.Api.Reports;

/// <summary>
/// Formato numerico brasileiro montado a mao: a API roda com globalizacao invariante (sem ICU),
/// entao CultureInfo("pt-BR") nao existe no conteiner.
/// </summary>
public static class ReportCulture
{
    public static readonly CultureInfo PtBr = Create();

    private static CultureInfo Create()
    {
        var culture = (CultureInfo)CultureInfo.InvariantCulture.Clone();
        culture.NumberFormat.NumberDecimalSeparator = ",";
        culture.NumberFormat.NumberGroupSeparator = ".";
        culture.NumberFormat.PercentDecimalSeparator = ",";
        culture.NumberFormat.PercentGroupSeparator = ".";
        return CultureInfo.ReadOnly(culture);
    }
}

public sealed record ReportParams(
    string Type,
    int? ClientId = null,
    int? SiteId = null,
    DateTimeOffset? From = null,
    DateTimeOffset? To = null,
    string? Period = null,
    string? Severity = null,
    string? Status = null,
    Guid? AssignedToId = null,
    string? AssetType = null,
    bool? OnlyPending = null,
    int? MaxScore = null);

public sealed record GenerateReportRequest(
    string Type,
    string Format,
    int? ClientId = null,
    int? SiteId = null,
    DateTimeOffset? From = null,
    DateTimeOffset? To = null,
    string? Period = null,
    string? Severity = null,
    string? Status = null,
    Guid? AssignedToId = null,
    string? AssetType = null,
    bool? OnlyPending = null,
    int? MaxScore = null)
{
    public ReportParams Params => new(Type, ClientId, SiteId, From, To, Period, Severity, Status, AssignedToId, AssetType, OnlyPending, MaxScore);
}

public static class ColumnKind
{
    public const string Text = "text";
    public const string Number = "number";
    public const string Date = "date";
    public const string DateTime = "datetime";
    public const string Percent = "percent";
    public const string Duration = "duration";
}

public sealed record ReportColumn(string Key, string Label, string Kind = ColumnKind.Text);

public sealed record ReportSummaryItem(string Label, string Value);

public sealed record ReportTypeInfo(string Type, string Label, string Description, bool UsesPeriod, IReadOnlyList<string> Filters);

public sealed class ReportData
{
    public required string Type { get; init; }
    public required string Title { get; init; }
    public DateTimeOffset GeneratedAt { get; init; }
    public DateTimeOffset? PeriodFrom { get; init; }
    public DateTimeOffset? PeriodTo { get; init; }
    public List<string> FiltersText { get; init; } = [];
    public List<ReportSummaryItem> Summary { get; init; } = [];
    public required List<ReportColumn> Columns { get; init; }
    public List<Dictionary<string, object?>> Rows { get; init; } = [];
    public bool Truncated { get; set; }
}

/// <summary>Erro de parametro do relatorio, devolvido como 400 com o campo.</summary>
public sealed class ReportParamException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}

public static class ReportTypes
{
    public const string Agents = "agents";
    public const string Inventory = "inventory";
    public const string Alerts = "alerts";
    public const string Tickets = "tickets";
    public const string Patches = "patches";
    public const string Health = "health";
    public const string SnmpAvailability = "snmp_availability";

    public static readonly IReadOnlyList<ReportTypeInfo> All =
    [
        new(Agents, "Agentes", "Situacao de cada agente: sistema, versao, status, ultimo contato e reinicio pendente", false, ["clientId", "siteId", "status"]),
        new(Inventory, "Inventario", "Ativos com fabricante, modelo, serie, patrimonio, responsavel e garantia", false, ["clientId", "siteId", "assetType"]),
        new(Alerts, "Alertas", "Alertas do periodo por severidade, tipo e origem, com duracao", true, ["clientId", "severity"]),
        new(Tickets, "Chamados", "Chamados do periodo com SLA de resposta e de solucao e horas apontadas", true, ["clientId", "assignedToId", "status"]),
        new(Patches, "Atualizacoes do Windows", "Atualizacoes por maquina: instaladas, pendentes e aprovacao", false, ["clientId", "siteId", "onlyPending"]),
        new(Health, "Health Check", "Nota do Health Check por maquina e itens com problema", false, ["clientId", "siteId", "maxScore"]),
        new(SnmpAvailability, "Disponibilidade SNMP", "Quedas, tempo fora e disponibilidade dos dispositivos SNMP no periodo", true, ["clientId"]),
    ];

    public static ReportTypeInfo? Find(string? type) => All.FirstOrDefault(t => t.Type == type);
}

public static class ReportPeriods
{
    public static readonly string[] All = ["last_24h", "last_7d", "last_30d", "previous_month", "current_month"];

    /// <summary>Resolve o periodo relativo no fuso configurado; os limites saem em UTC.</summary>
    public static (DateTimeOffset From, DateTimeOffset To) Resolve(string period, DateTimeOffset now, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(now, zone);
        DateTimeOffset MonthStart(int year, int month)
        {
            var start = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Unspecified);
            return new DateTimeOffset(start, zone.GetUtcOffset(start)).ToUniversalTime();
        }
        return period switch
        {
            "last_24h" => (now.AddHours(-24), now),
            "last_30d" => (now.AddDays(-30), now),
            "previous_month" => (MonthStart(local.AddMonths(-1).Year, local.AddMonths(-1).Month), MonthStart(local.Year, local.Month)),
            "current_month" => (MonthStart(local.Year, local.Month), now),
            _ => (now.AddDays(-7), now),
        };
    }
}
