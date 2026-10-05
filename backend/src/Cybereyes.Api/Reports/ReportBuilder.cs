using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Reports;

/// <summary>Consultas fixas de cada tipo de relatorio. Nenhum filtro vira SQL montado a mao: tudo passa pelo EF com parametros.</summary>
public sealed class ReportBuilder(CybereyesDbContext db, TimeProvider time)
{
    public const int PreviewRows = 500;
    public const int FileRows = 20000;
    public static readonly TimeSpan MaxWindow = TimeSpan.FromDays(366);

    private static readonly CultureInfo PtBr = ReportCulture.PtBr;

    public async Task<ReportData> BuildAsync(ReportParams p, int maxRows, CancellationToken ct)
    {
        var info = ReportTypes.Find(p.Type) ?? throw new ReportParamException("type", "Tipo de relatorio desconhecido");
        var settings = await SettingsStore.GetAsync(db, ct);
        var zone = SettingsStore.TimeZone(settings);
        var now = time.GetUtcNow();
        DateTimeOffset? from = null, to = null;
        if (info.UsesPeriod)
        {
            if (p.Period is not null && !ReportPeriods.All.Contains(p.Period))
            {
                throw new ReportParamException("period", "Periodo invalido");
            }
            (from, to) = p.From is { } f && p.To is { } t && p.Period is null
                ? (f.ToUniversalTime(), t.ToUniversalTime())
                : ReportPeriods.Resolve(p.Period ?? "last_7d", now, zone);
            if (from >= to || to - from > MaxWindow)
            {
                throw new ReportParamException("from", "Periodo invalido: inicio antes do fim e no maximo 366 dias");
            }
        }

        var filters = await FiltersTextAsync(p, info, ct);
        var data = p.Type switch
        {
            ReportTypes.Agents => await AgentsAsync(p, maxRows, ct),
            ReportTypes.Inventory => await InventoryAsync(p, maxRows, now, ct),
            ReportTypes.Alerts => await AlertsAsync(p, from!.Value, to!.Value, maxRows, ct),
            ReportTypes.Tickets => await TicketsAsync(p, from!.Value, to!.Value, maxRows, now, ct),
            ReportTypes.Patches => await PatchesAsync(p, maxRows, ct),
            ReportTypes.Health => await HealthAsync(p, maxRows, ct),
            _ => await SnmpAsync(p, from!.Value, to!.Value, maxRows, ct),
        };
        var rows = data.Rows;
        var truncated = rows.Count > maxRows;
        if (truncated)
        {
            rows = rows.Take(maxRows).ToList();
        }
        return new ReportData
        {
            Type = p.Type,
            Title = info.Label,
            GeneratedAt = now,
            PeriodFrom = from,
            PeriodTo = to,
            FiltersText = filters,
            Summary = data.Summary,
            Columns = data.Columns,
            Rows = rows,
            Truncated = truncated,
        };
    }

    private sealed record Part(List<ReportColumn> Columns, List<Dictionary<string, object?>> Rows, List<ReportSummaryItem> Summary);

    private static string N(long value) => value.ToString("N0", PtBr);

    private static string Pct(double value) => value.ToString("0.0", PtBr) + "%";

    private async Task<List<string>> FiltersTextAsync(ReportParams p, ReportTypeInfo info, CancellationToken ct)
    {
        var list = new List<string>();
        if (p.ClientId is { } c)
        {
            list.Add("Cliente: " + (await db.Clients.Where(x => x.Id == c).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? $"#{c}"));
        }
        if (p.SiteId is { } s && info.Filters.Contains("siteId"))
        {
            list.Add("Site: " + (await db.Sites.Where(x => x.Id == s).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? $"#{s}"));
        }
        if (p.Severity is { Length: > 0 } sev && info.Filters.Contains("severity"))
        {
            list.Add("Severidade: " + sev);
        }
        if (p.Status is { Length: > 0 } st && info.Filters.Contains("status"))
        {
            list.Add("Status: " + st);
        }
        if (p.AssignedToId is { } u && info.Filters.Contains("assignedToId"))
        {
            list.Add("Tecnico: " + (await db.Users.Where(x => x.Id == u).Select(x => x.UserName).FirstOrDefaultAsync(ct) ?? "?"));
        }
        if (p.AssetType is { Length: > 0 } at && info.Filters.Contains("assetType"))
        {
            list.Add("Tipo de ativo: " + at);
        }
        if (p.OnlyPending == true && info.Filters.Contains("onlyPending"))
        {
            list.Add("Somente pendentes");
        }
        if (p.MaxScore is { } ms && info.Filters.Contains("maxScore"))
        {
            list.Add($"Nota ate {ms}");
        }
        return list;
    }

    private async Task<Part> AgentsAsync(ReportParams p, int maxRows, CancellationToken ct)
    {
        var q = db.Agents.AsNoTracking();
        if (p.ClientId is { } c)
        {
            q = q.Where(a => a.Site!.ClientId == c);
        }
        if (p.SiteId is { } s)
        {
            q = q.Where(a => a.SiteId == s);
        }
        var counts = await q.GroupBy(a => a.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var reboot = await q.CountAsync(a => a.NeedsReboot, ct);
        if (p.Status is { Length: > 0 } status)
        {
            q = q.Where(a => a.Status == status);
        }
        var rows = await q.OrderBy(a => a.Site!.Client!.Name).ThenBy(a => a.Site!.Name).ThenBy(a => a.Hostname).Take(maxRows + 1)
            .Select(a => new { Client = a.Site!.Client!.Name, Site = a.Site.Name, a.Hostname, a.OperatingSystem, a.Plat, a.Version, a.Status, a.LastSeen, a.NeedsReboot, a.LoggedInUsername })
            .ToListAsync(ct);
        int Count(string s) => counts.FirstOrDefault(x => x.Key == s)?.Count ?? 0;
        return new Part(
            [
                new("client", "Cliente"), new("site", "Site"), new("hostname", "Maquina"), new("os", "Sistema"), new("version", "Agente"),
                new("status", "Status"), new("lastSeen", "Ultimo contato", ColumnKind.DateTime), new("reboot", "Reinicio pendente"), new("user", "Usuario logado"),
            ],
            rows.Select(a => new Dictionary<string, object?>
            {
                ["client"] = a.Client, ["site"] = a.Site, ["hostname"] = a.Hostname, ["os"] = a.OperatingSystem ?? a.Plat, ["version"] = a.Version,
                ["status"] = StatusName(a.Status), ["lastSeen"] = a.LastSeen, ["reboot"] = a.NeedsReboot ? "Sim" : "Nao", ["user"] = a.LoggedInUsername,
            }).ToList(),
            [
                new("Total", N(counts.Sum(x => x.Count))), new("Online", N(Count(AgentStatus.Online))), new("Offline", N(Count(AgentStatus.Offline))),
                new("Em atraso", N(Count(AgentStatus.Overdue))), new("Reinicio pendente", N(reboot)),
            ]);
    }

    private static string StatusName(string status) => status switch
    {
        AgentStatus.Online => "Online",
        AgentStatus.Overdue => "Em atraso",
        _ => "Offline",
    };

    private async Task<Part> InventoryAsync(ReportParams p, int maxRows, DateTimeOffset now, CancellationToken ct)
    {
        var q = db.Assets.AsNoTracking();
        if (p.ClientId is { } c)
        {
            q = q.Where(a => a.ClientId == c);
        }
        if (p.SiteId is { } s)
        {
            q = q.Where(a => a.SiteId == s);
        }
        if (p.AssetType is { Length: > 0 } type)
        {
            q = q.Where(a => a.Type == type);
        }
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var soon = today.AddDays(30);
        var byType = await q.GroupBy(a => a.Type).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var withoutResponsible = await q.CountAsync(a => !db.AssetAssignments.Any(x => x.AssetId == a.Id && x.UnassignedAt == null), ct);
        var expired = await q.CountAsync(a => a.WarrantyUntil != null && a.WarrantyUntil < today, ct);
        var expiring = await q.CountAsync(a => a.WarrantyUntil != null && a.WarrantyUntil >= today && a.WarrantyUntil <= soon, ct);
        var rows = await q.OrderBy(a => a.Name).Take(maxRows + 1)
            .Select(a => new
            {
                Client = db.Clients.Where(x => x.Id == a.ClientId).Select(x => x.Name).FirstOrDefault(),
                a.Type, a.Name, a.Manufacturer, a.Model, a.SerialNumber, a.AssetTag, a.Status, a.WarrantyUntil,
                Responsible = (from x in db.AssetAssignments
                               join person in db.People on x.PersonId equals person.Id
                               where x.AssetId == a.Id && x.UnassignedAt == null
                               select person.Name).FirstOrDefault(),
                LastSeen = db.Agents.Where(x => x.Id == a.AgentId).Select(x => x.LastSeen).FirstOrDefault(),
            }).ToListAsync(ct);
        var summary = new List<ReportSummaryItem> { new("Total", N(byType.Sum(x => x.Count))) };
        summary.AddRange(byType.OrderByDescending(x => x.Count).Select(x => new ReportSummaryItem(x.Key, N(x.Count))));
        summary.Add(new("Sem responsavel", N(withoutResponsible)));
        summary.Add(new("Garantia vencida", N(expired)));
        summary.Add(new("Garantia vence em 30 dias", N(expiring)));
        return new Part(
            [
                new("client", "Cliente"), new("type", "Tipo"), new("name", "Nome"), new("manufacturer", "Fabricante"), new("model", "Modelo"),
                new("serial", "Serie"), new("tag", "Patrimonio"), new("responsible", "Responsavel"), new("warranty", "Garantia ate", ColumnKind.Date),
                new("status", "Status"), new("lastSeen", "Ultimo contato", ColumnKind.DateTime),
            ],
            rows.Select(a => new Dictionary<string, object?>
            {
                ["client"] = a.Client, ["type"] = a.Type, ["name"] = a.Name, ["manufacturer"] = a.Manufacturer, ["model"] = a.Model,
                ["serial"] = a.SerialNumber, ["tag"] = a.AssetTag, ["responsible"] = a.Responsible, ["warranty"] = a.WarrantyUntil,
                ["status"] = a.Status, ["lastSeen"] = a.LastSeen,
            }).ToList(),
            summary);
    }

    private async Task<Part> AlertsAsync(ReportParams p, DateTimeOffset from, DateTimeOffset to, int maxRows, CancellationToken ct)
    {
        var q = db.Alerts.AsNoTracking().Where(a => a.CreatedAt >= from && a.CreatedAt < to);
        if (p.ClientId is { } c)
        {
            q = q.Where(a => a.Agent!.Site!.ClientId == c || a.SnmpDevice!.ClientId == c);
        }
        if (p.Severity is { Length: > 0 } sev)
        {
            q = q.Where(a => a.Severity == sev);
        }
        var bySeverity = await q.GroupBy(a => a.Severity).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var byType = await q.GroupBy(a => a.AlertType).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var openAtEnd = await q.CountAsync(a => !a.Resolved || a.ResolvedAt >= to, ct);
        var rows = await q.OrderByDescending(a => a.CreatedAt).Take(maxRows + 1)
            .Select(a => new { a.CreatedAt, a.Severity, a.AlertType, Origin = a.AgentId != null ? a.Agent!.Hostname : a.SnmpDevice!.Name, a.Message, a.ResolvedAt })
            .ToListAsync(ct);
        var summary = new List<ReportSummaryItem> { new("Total", N(bySeverity.Sum(x => x.Count))) };
        summary.AddRange(bySeverity.OrderBy(x => x.Key).Select(x => new ReportSummaryItem("Severidade " + x.Key, N(x.Count))));
        summary.AddRange(byType.OrderByDescending(x => x.Count).Select(x => new ReportSummaryItem("Tipo " + x.Key, N(x.Count))));
        summary.Add(new("Abertos no fim do periodo", N(openAtEnd)));
        return new Part(
            [
                new("createdAt", "Data", ColumnKind.DateTime), new("severity", "Severidade"), new("type", "Tipo"), new("origin", "Maquina ou dispositivo"),
                new("message", "Mensagem"), new("resolvedAt", "Resolvido em", ColumnKind.DateTime), new("duration", "Duracao", ColumnKind.Duration),
            ],
            rows.Select(a => new Dictionary<string, object?>
            {
                ["createdAt"] = a.CreatedAt, ["severity"] = a.Severity, ["type"] = a.AlertType, ["origin"] = a.Origin, ["message"] = a.Message,
                ["resolvedAt"] = a.ResolvedAt, ["duration"] = (long)((a.ResolvedAt ?? to) - a.CreatedAt).TotalSeconds,
            }).ToList(),
            summary);
    }

    private async Task<Part> TicketsAsync(ReportParams p, DateTimeOffset from, DateTimeOffset to, int maxRows, DateTimeOffset now, CancellationToken ct)
    {
        var q = db.Tickets.AsNoTracking().Where(t => t.CreatedAt >= from && t.CreatedAt < to);
        if (p.ClientId is { } c)
        {
            q = q.Where(t => t.ClientId == c);
        }
        if (p.AssignedToId is { } u)
        {
            q = q.Where(t => t.AssignedToId == u);
        }
        if (p.Status is { Length: > 0 } status)
        {
            q = q.Where(t => t.Status == status);
        }
        var all = await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new
            {
                t.Id, t.Title, t.Type, t.Priority, t.Status, t.CreatedAt, t.ResolvedAt, t.FirstResponseAt, t.FirstResponseDueAt, t.ResolutionDueAt,
                Client = db.Clients.Where(x => x.Id == t.ClientId).Select(x => x.Name).FirstOrDefault(),
                Technician = db.Users.Where(x => x.Id == t.AssignedToId).Select(x => x.FullName != "" ? x.FullName : x.UserName).FirstOrDefault(),
                Minutes = db.TimeEntries.Where(x => x.TicketId == t.Id).Sum(x => (int?)x.Minutes) ?? 0,
            }).ToListAsync(ct);

        static bool? Met(DateTimeOffset? done, DateTimeOffset? due, DateTimeOffset now) =>
            due is not { } d ? null : done is { } x ? x <= d : now > d ? false : null;

        var response = all.Select(t => Met(t.FirstResponseAt, t.FirstResponseDueAt, now)).Where(x => x is not null).ToList();
        var resolution = all.Select(t => Met(t.ResolvedAt, t.ResolutionDueAt, now)).Where(x => x is not null).ToList();
        static string Rate(List<bool?> list) => list.Count == 0 ? "-" : Pct(100.0 * list.Count(x => x == true) / list.Count);
        static string SlaText(bool? met) => met switch { true => "Cumprido", false => "Estourado", _ => "Em andamento" };
        var resolved = all.Count(t => t.ResolvedAt is not null);
        var minutes = all.Sum(t => t.Minutes);

        return new Part(
            [
                new("id", "Numero", ColumnKind.Number), new("title", "Titulo"), new("type", "Tipo"), new("priority", "Prioridade"), new("status", "Status"),
                new("client", "Cliente"), new("technician", "Tecnico"), new("createdAt", "Aberto em", ColumnKind.DateTime),
                new("resolvedAt", "Resolvido em", ColumnKind.DateTime), new("slaResponse", "SLA de resposta"), new("slaResolution", "SLA de solucao"),
                new("hours", "Horas apontadas", ColumnKind.Number),
            ],
            all.Take(maxRows + 1).Select(t => new Dictionary<string, object?>
            {
                ["id"] = t.Id, ["title"] = t.Title, ["type"] = t.Type == TicketType.Incident ? "Incidente" : "Requisicao", ["priority"] = t.Priority,
                ["status"] = t.Status, ["client"] = t.Client, ["technician"] = t.Technician, ["createdAt"] = t.CreatedAt, ["resolvedAt"] = t.ResolvedAt,
                ["slaResponse"] = SlaText(Met(t.FirstResponseAt, t.FirstResponseDueAt, now)), ["slaResolution"] = SlaText(Met(t.ResolvedAt, t.ResolutionDueAt, now)),
                ["hours"] = Math.Round(t.Minutes / 60.0, 2),
            }).ToList(),
            [
                new("Abertos no periodo", N(all.Count)), new("Resolvidos", N(resolved)), new("SLA de resposta cumprido", Rate(response)),
                new("SLA de solucao cumprido", Rate(resolution)), new("Horas apontadas", (minutes / 60.0).ToString("0.##", PtBr)),
            ]);
    }

    private async Task<Part> PatchesAsync(ReportParams p, int maxRows, CancellationToken ct)
    {
        var q = from u in db.WinUpdates.AsNoTracking()
                join a in db.Agents on u.AgentId equals a.Id
                select new { u, a };
        if (p.ClientId is { } c)
        {
            q = q.Where(x => x.a.Site!.ClientId == c);
        }
        if (p.SiteId is { } s)
        {
            q = q.Where(x => x.a.SiteId == s);
        }
        var pending = await q.CountAsync(x => !x.u.Installed, ct);
        var installed = await q.CountAsync(x => x.u.Installed, ct);
        var machines = await q.Where(x => !x.u.Installed).Select(x => x.a.Id).Distinct().CountAsync(ct);
        if (p.OnlyPending == true)
        {
            q = q.Where(x => !x.u.Installed);
        }
        var rows = await q.OrderBy(x => x.a.Hostname).ThenBy(x => x.u.Installed).ThenBy(x => x.u.Kb).Take(maxRows + 1)
            .Select(x => new { x.a.Hostname, x.u.Kb, x.u.Title, x.u.Severity, x.u.Installed, x.u.Action, x.u.DateInstalled }).ToListAsync(ct);
        return new Part(
            [
                new("hostname", "Maquina"), new("kb", "KB"), new("title", "Titulo"), new("severity", "Severidade"), new("installed", "Instalada"),
                new("action", "Aprovacao"), new("dateInstalled", "Instalada em", ColumnKind.DateTime),
            ],
            rows.Select(x => new Dictionary<string, object?>
            {
                ["hostname"] = x.Hostname, ["kb"] = x.Kb, ["title"] = x.Title, ["severity"] = x.Severity, ["installed"] = x.Installed ? "Sim" : "Nao",
                ["action"] = x.Action, ["dateInstalled"] = x.DateInstalled,
            }).ToList(),
            [new("Pendentes", N(pending)), new("Instaladas", N(installed)), new("Maquinas com pendencia", N(machines))]);
    }

    private async Task<Part> HealthAsync(ReportParams p, int maxRows, CancellationToken ct)
    {
        var q = from h in db.AgentHealth.AsNoTracking()
                join a in db.Agents on h.AgentId equals a.Id
                select new { h, a };
        if (p.ClientId is { } c)
        {
            q = q.Where(x => x.a.Site!.ClientId == c);
        }
        if (p.SiteId is { } s)
        {
            q = q.Where(x => x.a.SiteId == s);
        }
        if (p.MaxScore is { } max)
        {
            q = q.Where(x => x.h.Score <= max);
        }
        var items = await q.OrderBy(x => x.h.Score).ThenBy(x => x.a.Hostname).Take(maxRows + 1)
            .Select(x => new { x.a.Hostname, Client = x.a.Site!.Client!.Name, x.h.Score, x.h.Grade, x.h.CollectedAt, x.h.Report }).ToListAsync(ct);
        var stats = await q.GroupBy(x => x.h.Grade).Select(g => new { g.Key, Count = g.Count(), Sum = g.Sum(x => x.h.Score) }).ToListAsync(ct);
        var total = stats.Sum(x => x.Count);
        var summary = new List<ReportSummaryItem> { new("Maquinas", N(total)), new("Nota media", total == 0 ? "-" : (stats.Sum(x => x.Sum) / (double)total).ToString("0.0", PtBr)) };
        summary.AddRange(stats.OrderBy(x => x.Key).Select(x => new ReportSummaryItem("Conceito " + x.Key, N(x.Count))));
        return new Part(
            [
                new("hostname", "Maquina"), new("client", "Cliente"), new("score", "Nota", ColumnKind.Number), new("grade", "Conceito"),
                new("collectedAt", "Coletado em", ColumnKind.DateTime), new("problems", "Itens com problema"),
            ],
            items.Select(x => new Dictionary<string, object?>
            {
                ["hostname"] = x.Hostname, ["client"] = x.Client, ["score"] = x.Score, ["grade"] = x.Grade, ["collectedAt"] = x.CollectedAt,
                ["problems"] = Problems(x.Report),
            }).ToList(),
            summary);
    }

    /// <summary>Lista os itens do Health Check em aviso ou critico ("Rotulo: valor").</summary>
    public static string Problems(string report)
    {
        try
        {
            using var doc = JsonDocument.Parse(report);
            if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            {
                return string.Empty;
            }
            return string.Join("; ", items.EnumerateArray()
                .Where(i => i.TryGetProperty("status", out var st) && st.GetString() is "warning" or "critical")
                .Select(i => $"{(i.TryGetProperty("label", out var l) ? l.GetString() : "?")}: {(i.TryGetProperty("value", out var v) ? v.ToString() : string.Empty)}"));
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private async Task<Part> SnmpAsync(ReportParams p, DateTimeOffset from, DateTimeOffset to, int maxRows, CancellationToken ct)
    {
        var devices = db.SnmpDevices.AsNoTracking();
        if (p.ClientId is { } c)
        {
            devices = devices.Where(d => d.ClientId == c);
        }
        var list = await devices.OrderBy(d => d.Name).Take(maxRows + 1)
            .Select(d => new { d.Id, d.Name, d.Host, d.Status, d.CreatedAt, Client = db.Clients.Where(x => x.Id == d.ClientId).Select(x => x.Name).FirstOrDefault() })
            .ToListAsync(ct);
        var ids = list.Select(d => d.Id).ToList();
        var outages = await db.Alerts.AsNoTracking()
            .Where(a => a.AlertType == AlertTypes.SnmpDevice && a.SnmpDeviceId != null && ids.Contains(a.SnmpDeviceId.Value) &&
                        a.CreatedAt < to && (a.ResolvedAt == null || a.ResolvedAt > from))
            .Select(a => new { DeviceId = a.SnmpDeviceId!.Value, a.CreatedAt, a.ResolvedAt }).ToListAsync(ct);

        var rows = new List<Dictionary<string, object?>>();
        var availabilities = new List<double>();
        foreach (var d in list)
        {
            var start = d.CreatedAt > from ? d.CreatedAt : from;
            var window = (to - start).TotalSeconds;
            var mine = outages.Where(o => o.DeviceId == d.Id).ToList();
            var down = mine.Sum(o => Math.Max(0, ((o.ResolvedAt ?? to) < to ? (o.ResolvedAt ?? to) : to).Subtract(o.CreatedAt > start ? o.CreatedAt : start).TotalSeconds));
            double? availability = window > 0 ? Math.Max(0, 100.0 * (window - down) / window) : null;
            if (availability is { } av)
            {
                availabilities.Add(av);
            }
            rows.Add(new Dictionary<string, object?>
            {
                ["name"] = d.Name, ["client"] = d.Client, ["host"] = d.Host, ["status"] = d.Status, ["outages"] = mine.Count,
                ["downtime"] = (long)down, ["availability"] = availability,
            });
        }
        return new Part(
            [
                new("name", "Dispositivo"), new("client", "Cliente"), new("host", "Host"), new("status", "Status atual"), new("outages", "Quedas", ColumnKind.Number),
                new("downtime", "Tempo fora", ColumnKind.Duration), new("availability", "Disponibilidade", ColumnKind.Percent),
            ],
            rows,
            [
                new("Dispositivos", N(list.Count)),
                new("Disponibilidade media", availabilities.Count == 0 ? "-" : Pct(availabilities.Average())),
                new("Dispositivos com queda", N(rows.Count(r => (int)r["outages"]! > 0))),
            ]);
    }
}
