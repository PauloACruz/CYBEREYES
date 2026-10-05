using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Logs;

public sealed record LogEntryDto(long Id, DateTimeOffset Time, DateTimeOffset ReceivedAt, int? AgentId, string? Hostname, int? DeviceId, string? DeviceName,
    string? ClientName, string Level, string Source, string Log, long? EventId, string Message);

public sealed record LogSettingsDto(bool Enabled, [property: Required] string MinLevel, [property: Required] List<string> WindowsLogs,
    [property: Range(50, 5000)] int MaxPerCycle, [property: Range(1, 365)] int RetentionDays);

public sealed record SaveLogAlertRule(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    int? ClientId,
    [property: Required] string MinLevel,
    [property: StringLength(200)] string? SourceContains,
    [property: StringLength(500)] string? MessageContains,
    [property: Range(1, 100000)] int Threshold,
    [property: Range(1, 1440)] int WindowMinutes,
    [property: Required] string Severity,
    bool Enabled);

public static class LogEndpoints
{
    public const int MaxWindowDays = 31;

    public static void MapLogEndpoints(this IEndpointRouteBuilder app)
    {
        var agent = app.MapGroup("/api/v3").RequireAuthorization(Policies.Agent).ExcludeFromDescription();
        agent.MapGet("/{agentId}/logconfig/", LogIngest.ConfigAsync);
        agent.MapPost("/logs/", LogIngest.ReceiveAsync);

        var view = Policies.Permission(Permissions.LogsView);
        var logs = app.MapGroup("/api/logs").WithTags("Logs");
        logs.MapGet("/", SearchAsync).RequireAuthorization(view);
        logs.MapGet("/summary", SummaryAsync).RequireAuthorization(view);
        logs.MapGet("/settings", async (ClaimsPrincipal user, CybereyesDbContext db, CancellationToken ct) =>
        {
            if (!user.HasPermission(Permissions.LogsView) && !user.HasPermission(Permissions.SettingsManage))
            {
                return Problems.Forbidden("Sem permissao para ver as configuracoes de logs");
            }
            var s = await SettingsStore.GetAsync(db, ct);
            return TypedResults.Ok(new LogSettingsDto(s.LogsEnabled, s.LogMinLevel, s.LogWindowsLogs, s.LogMaxPerCycle, s.LogRetentionDays));
        }).RequireAuthorization();
        logs.MapPut("/settings", SaveSettingsAsync).RequireAuthorization(Policies.Permission(Permissions.SettingsManage));

        var rules = app.MapGroup("/api/log-alert-rules").WithTags("Logs").RequireAuthorization(Policies.Permission(Permissions.AlertsManage));
        rules.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await db.LogAlertRules.AsNoTracking().OrderBy(r => r.Name).ToListAsync(ct)));
        rules.MapPost("/", (SaveLogAlertRule r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveRuleAsync(null, r, db, audit, ct));
        rules.MapPut("/{id:int}", (int id, SaveLogAlertRule r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveRuleAsync(id, r, db, audit, ct));
        rules.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, IAuditService audit, AlertService alerts, CancellationToken ct) =>
        {
            var rule = await db.LogAlertRules.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (rule is null)
            {
                return Problems.NotFound("Regra");
            }
            db.LogAlertRules.Remove(rule);
            await db.SaveChangesAsync(ct);
            await LogAlertEvaluator.ResolveRuleAsync(db, alerts, id, ct);
            await audit.LogAsync("logrule.deleted", "log_alert_rule", id.ToString(CultureInfo.InvariantCulture), $"Regra de log {rule.Name} excluida", cancellationToken: ct);
            return TypedResults.NoContent();
        });
    }

    /// <summary>Cursor de pagina: instante em ticks e id da ultima linha devolvida.</summary>
    public static string Cursor(DateTimeOffset time, long id) => string.Create(CultureInfo.InvariantCulture, $"{time.UtcTicks}_{id}");

    private static bool TryParseCursor(string? text, out DateTimeOffset time, out long id)
    {
        time = default;
        id = 0;
        var parts = (text ?? string.Empty).Split('_');
        if (parts.Length != 2 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) ||
            !long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out id) ||
            ticks < DateTimeOffset.MinValue.UtcTicks || ticks > DateTimeOffset.MaxValue.UtcTicks)
        {
            return false;
        }
        time = new DateTimeOffset(ticks, TimeSpan.Zero);
        return true;
    }

    private static bool TryWindow(DateTimeOffset? from, DateTimeOffset? to, TimeProvider clock, out DateTimeOffset start, out DateTimeOffset end)
    {
        end = (to ?? clock.GetUtcNow()).ToUniversalTime();
        start = (from ?? end.AddHours(-24)).ToUniversalTime();
        return start < end && end - start <= TimeSpan.FromDays(MaxWindowDays);
    }

    public static string Like(string text) =>
        "%" + text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal) + "%";

    private static IQueryable<SystemLog> Filter(CybereyesDbContext db, int? agentId, int? clientId, int? deviceId, string? level, string? source, string? search,
        DateTimeOffset start, DateTimeOffset end)
    {
        var query = db.SystemLogs.AsNoTracking().Where(l => l.Time >= start && l.Time < end);
        if (agentId is { } a)
        {
            query = query.Where(l => l.AgentId == a);
        }
        if (clientId is { } c)
        {
            query = query.Where(l => l.ClientId == c);
        }
        if (deviceId is { } d)
        {
            query = query.Where(l => l.SnmpDeviceId == d);
        }
        if (LogLevels.IsValid(level) && level != LogLevels.Info)
        {
            var levels = LogLevels.AtLeast(level!);
            query = query.Where(l => levels.Contains(l.Level));
        }
        if (!string.IsNullOrWhiteSpace(source))
        {
            var pattern = Like(source.Trim());
            query = query.Where(l => EF.Functions.ILike(l.Source, pattern));
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = Like(search.Trim());
            query = query.Where(l => EF.Functions.ILike(l.Message, pattern));
        }
        return query;
    }

    private static async Task<IResult> SearchAsync(CybereyesDbContext db, TimeProvider clock, int? agentId, int? clientId, int? deviceId, string? level,
        string? source, string? search, DateTimeOffset? from, DateTimeOffset? to, string? before, int? limit, CancellationToken ct)
    {
        if (!TryWindow(from, to, clock, out var start, out var end))
        {
            return Problems.BadRequest($"Periodo invalido: 'from' deve ser anterior a 'to' e a janela pode ter no maximo {MaxWindowDays} dias");
        }
        if (level is not null && !LogLevels.IsValid(level))
        {
            return Problems.Validation("level", "Use critical, error, warning ou info");
        }
        var query = Filter(db, agentId, clientId, deviceId, level, source, search, start, end);
        if (before is not null)
        {
            if (!TryParseCursor(before, out var t, out var id))
            {
                return Problems.Validation("before", "Cursor invalido");
            }
            query = query.Where(l => l.Time < t || (l.Time == t && l.Id < id));
        }
        var take = Math.Clamp(limit ?? 100, 1, 500);
        var items = await query.OrderByDescending(l => l.Time).ThenByDescending(l => l.Id).Take(take)
            .Select(l => new LogEntryDto(l.Id, l.Time, l.ReceivedAt, l.AgentId,
                db.Agents.Where(a => a.Id == l.AgentId).Select(a => a.Hostname).FirstOrDefault(),
                l.SnmpDeviceId,
                db.SnmpDevices.Where(d => d.Id == l.SnmpDeviceId).Select(d => d.Name).FirstOrDefault(),
                db.Clients.Where(c => c.Id == l.ClientId).Select(c => c.Name).FirstOrDefault(),
                l.Level, l.Source, l.Log, l.EventId, l.Message))
            .ToListAsync(ct);
        var next = items.Count == take ? Cursor(items[^1].Time, items[^1].Id) : null;
        return TypedResults.Ok(new { items, nextBefore = next });
    }

    private static async Task<IResult> SummaryAsync(CybereyesDbContext db, TimeProvider clock, int? agentId, int? clientId, int? deviceId,
        DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct)
    {
        if (!TryWindow(from, to, clock, out var start, out var end))
        {
            return Problems.BadRequest($"Periodo invalido: 'from' deve ser anterior a 'to' e a janela pode ter no maximo {MaxWindowDays} dias");
        }
        var query = Filter(db, agentId, clientId, deviceId, null, null, null, start, end);
        var byLevelRows = await query.GroupBy(l => l.Level).Select(g => new { Level = g.Key, Count = g.Count() }).ToListAsync(ct);
        var byLevel = LogLevels.Ordered.ToDictionary(l => l, l => byLevelRows.FirstOrDefault(r => r.Level == l)?.Count ?? 0);
        var bySource = await query.GroupBy(l => l.Source).Select(g => new { source = g.Key, count = g.Count() })
            .OrderByDescending(x => x.count).Take(10).ToListAsync(ct);
        var hourly = (await query.GroupBy(l => new { l.Time.Year, l.Time.Month, l.Time.Day, l.Time.Hour, l.Level })
                .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Hour, g.Key.Level, Count = g.Count() }).ToListAsync(ct))
            .Select(h => new { Hour = new DateTimeOffset(h.Year, h.Month, h.Day, h.Hour, 0, 0, TimeSpan.Zero), h.Level, h.Count });
        var perHour = hourly.GroupBy(h => h.Hour).OrderBy(g => g.Key).Select(g => new
        {
            hour = g.Key,
            critical = g.Where(x => x.Level == LogLevels.Critical).Sum(x => x.Count),
            error = g.Where(x => x.Level == LogLevels.Error).Sum(x => x.Count),
            warning = g.Where(x => x.Level == LogLevels.Warning).Sum(x => x.Count),
            info = g.Where(x => x.Level == LogLevels.Info).Sum(x => x.Count),
        }).ToList();
        return TypedResults.Ok(new { byLevel, bySource, perHour });
    }

    private static async Task<IResult> SaveSettingsAsync(LogSettingsDto r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (r.MinLevel is not (LogLevels.Info or LogLevels.Warning or LogLevels.Error))
        {
            return Problems.Validation("minLevel", "Use error, warning ou info");
        }
        var names = r.WindowsLogs.Select(n => n.Trim()).Where(n => n.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (names.Count > 20 || names.Any(n => n.Length > 128))
        {
            return Problems.Validation("windowsLogs", "No maximo 20 logs, com ate 128 caracteres cada");
        }
        var s = await SettingsStore.GetAsync(db, ct);
        s.LogsEnabled = r.Enabled;
        s.LogMinLevel = r.MinLevel;
        s.LogWindowsLogs = names;
        s.LogMaxPerCycle = r.MaxPerCycle;
        s.LogRetentionDays = r.RetentionDays;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("logs.settings", "settings", null,
            $"Coleta de logs {(r.Enabled ? "ativa" : "inativa")}, nivel {r.MinLevel}, retencao {r.RetentionDays} dias", cancellationToken: ct);
        return TypedResults.Ok(new LogSettingsDto(s.LogsEnabled, s.LogMinLevel, s.LogWindowsLogs, s.LogMaxPerCycle, s.LogRetentionDays));
    }

    private static async Task<IResult> SaveRuleAsync(int? id, SaveLogAlertRule r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (!LogLevels.IsValid(r.MinLevel))
        {
            return Problems.Validation("minLevel", "Use critical, error, warning ou info");
        }
        if (!Severity.All.Contains(r.Severity))
        {
            return Problems.Validation("severity", "Use info, warning ou error");
        }
        if (r.ClientId is { } c && !await db.Clients.AnyAsync(x => x.Id == c, ct))
        {
            return Problems.Validation("clientId", "Cliente nao encontrado");
        }
        var rule = id is null ? new LogAlertRule { Name = r.Name } : await db.LogAlertRules.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (rule is null)
        {
            return Problems.NotFound("Regra");
        }
        rule.Name = r.Name.Trim();
        rule.ClientId = r.ClientId;
        rule.MinLevel = r.MinLevel;
        rule.SourceContains = string.IsNullOrWhiteSpace(r.SourceContains) ? null : r.SourceContains.Trim();
        rule.MessageContains = string.IsNullOrWhiteSpace(r.MessageContains) ? null : r.MessageContains.Trim();
        rule.Threshold = r.Threshold;
        rule.WindowMinutes = r.WindowMinutes;
        rule.Severity = r.Severity;
        rule.Enabled = r.Enabled;
        if (id is null)
        {
            db.LogAlertRules.Add(rule);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "logrule.created" : "logrule.updated", "log_alert_rule", rule.Id.ToString(CultureInfo.InvariantCulture),
            $"Regra de log {rule.Name}", cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/log-alert-rules/{rule.Id}", rule) : TypedResults.Ok(rule);
    }
}
