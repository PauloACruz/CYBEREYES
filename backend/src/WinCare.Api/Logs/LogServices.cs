using System.Globalization;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Rmm.Monitoring;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;

namespace WinCare.Api.Logs;

/// <summary>
/// Mantem as particoes mensais de system_logs e snmp_samples: cria a do mes atual e a do proximo e apaga as que
/// ficaram inteiras fora da retencao. Linhas que cairam na particao padrao antes da mensal existir sao movidas para ela.
/// </summary>
public sealed partial class LogPartitionService(IServiceScopeFactory scopes, TimeProvider time, ILogger<LogPartitionService> logger) : BackgroundService
{
    public static readonly string[] Tables = ["system_logs", "snmp_samples"];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
        while (await WaitAsync(TimeSpan.FromHours(1), stoppingToken));
    }

    private static async Task<bool> WaitAsync(TimeSpan delay, CancellationToken ct)
    {
        await Task.Delay(delay, ct);
        return true;
    }

    public static string PartitionName(string table, DateTimeOffset month) => string.Create(CultureInfo.InvariantCulture, $"{table}_p{month:yyyyMM}");

    public async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var settings = await SettingsStore.GetAsync(db, ct);
        var now = time.GetUtcNow();
        var current = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var cutoff = now.AddDays(-settings.LogRetentionDays);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Varias replicas da API rodam este servico; so uma mexe nas particoes por vez.
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('wincare-log-partitions'))", ct);
        foreach (var table in Tables)
        {
            var existing = await db.Database.SqlQueryRaw<string>(
                "SELECT c.relname AS \"Value\" FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = {0}::regclass",
                table).ToListAsync(ct);
            foreach (var month in new[] { current, current.AddMonths(1) })
            {
                var name = PartitionName(table, month);
                if (!existing.Contains(name))
                {
                    await CreatePartitionAsync(db, table, name, month, month.AddMonths(1), ct);
                }
            }
            foreach (var name in existing)
            {
                if (DateTimeOffset.TryParseExact(name[(table.Length + 2)..], "yyyyMM", CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal, out var month) && name.StartsWith(table + "_p", StringComparison.Ordinal) &&
                    month.AddMonths(1) <= cutoff)
                {
#pragma warning disable EF1002 // Nome lido do catalogo e conferido contra o padrao <tabela>_pAAAAMM.
                    await db.Database.ExecuteSqlRawAsync($"DROP TABLE IF EXISTS {name}", ct);
#pragma warning restore EF1002
                }
            }
#pragma warning disable EF1002 // Nome da tabela vem da lista fixa acima; o valor de corte vai como parametro.
            await db.Database.ExecuteSqlRawAsync($"DELETE FROM {table}_default WHERE \"Time\" < {{0}}", [cutoff], ct);
#pragma warning restore EF1002
        }
        await tx.CommitAsync(ct);
    }

    private static async Task CreatePartitionAsync(WinCareDbContext db, string table, string name, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var lower = from.ToString("yyyy-MM-dd HH:mm:ss'+00'", CultureInfo.InvariantCulture);
        var upper = to.ToString("yyyy-MM-dd HH:mm:ss'+00'", CultureInfo.InvariantCulture);
#pragma warning disable EF1002 // Nomes e limites sao gerados aqui (lista fixa de tabelas e datas formatadas), sem entrada externa.
        await db.Database.ExecuteSqlRawAsync(
            $"""
            CREATE TABLE {name} (LIKE {table} INCLUDING DEFAULTS);
            INSERT INTO {name} SELECT * FROM {table}_default WHERE "Time" >= '{lower}' AND "Time" < '{upper}';
            DELETE FROM {table}_default WHERE "Time" >= '{lower}' AND "Time" < '{upper}';
            ALTER TABLE {table} ATTACH PARTITION {name} FOR VALUES FROM ('{lower}') TO ('{upper}');
            """, ct);
#pragma warning restore EF1002
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha na manutencao das particoes de logs")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

/// <summary>Avalia as regras de alerta de log a cada minuto sobre a janela de cada regra.</summary>
public sealed partial class LogAlertEvaluator(IServiceScopeFactory scopes, TimeProvider time, ILogger<LogAlertEvaluator> logger) : BackgroundService
{
    public static string Subject(int ruleId) => string.Create(CultureInfo.InvariantCulture, $"rule:{ruleId}");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var alerts = scope.ServiceProvider.GetRequiredService<AlertService>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var locked = await db.Database.SqlQueryRaw<bool>("SELECT pg_try_advisory_xact_lock(hashtext('wincare-log-rules')) AS \"Value\"").SingleAsync(ct);
        if (!locked)
        {
            return;
        }

        var now = time.GetUtcNow();
        var rules = await db.LogAlertRules.AsNoTracking().Where(r => r.Enabled).ToListAsync(ct);
        var open = await db.Alerts.AsNoTracking().Where(a => a.AlertType == AlertTypes.Log && !a.Resolved)
            .Select(a => new { a.AgentId, a.SnmpDeviceId, a.SubjectKey }).ToListAsync(ct);

        foreach (var rule in rules)
        {
            var subject = Subject(rule.Id);
            var start = now.AddMinutes(-rule.WindowMinutes);
            var levels = LogLevels.AtLeast(rule.MinLevel);
            var query = db.SystemLogs.AsNoTracking().Where(l => l.Time >= start && l.Time <= now && levels.Contains(l.Level));
            if (rule.ClientId is { } c)
            {
                query = query.Where(l => l.ClientId == c);
            }
            if (rule.SourceContains is { } source)
            {
                var pattern = LogEndpoints.Like(source);
                query = query.Where(l => EF.Functions.ILike(l.Source, pattern));
            }
            if (rule.MessageContains is { } message)
            {
                var pattern = LogEndpoints.Like(message);
                query = query.Where(l => EF.Functions.ILike(l.Message, pattern));
            }
            var groups = await query.GroupBy(l => new { l.AgentId, l.SnmpDeviceId })
                .Select(g => new { g.Key.AgentId, g.Key.SnmpDeviceId, Count = g.Count(), Last = g.Max(l => l.Time) }).ToListAsync(ct);

            foreach (var g in groups.Where(g => g.Count >= rule.Threshold))
            {
                var last = await query.Where(l => l.AgentId == g.AgentId && l.SnmpDeviceId == g.SnmpDeviceId)
                    .OrderByDescending(l => l.Time).Select(l => l.Message).FirstAsync(ct);
                var text = string.Create(CultureInfo.InvariantCulture,
                    $"{rule.Name}: {g.Count} ocorrencias em {rule.WindowMinutes} min. Ultima: {(last.Length > 500 ? last[..500] : last)}");
                await alerts.RaiseSubjectAsync(new SubjectAlertRequest(g.AgentId, g.SnmpDeviceId, subject, AlertTypes.Log, rule.Severity, text), ct);
            }
            foreach (var a in open.Where(a => a.SubjectKey == subject && !groups.Any(g => g.AgentId == a.AgentId && g.SnmpDeviceId == a.SnmpDeviceId)))
            {
                await alerts.ResolveSubjectAsync(a.AgentId, a.SnmpDeviceId, AlertTypes.Log, subject, ct);
            }
        }

        var active = rules.Select(r => Subject(r.Id)).ToHashSet();
        foreach (var stale in open.Where(a => a.SubjectKey is { } s && !active.Contains(s)).Select(a => a.SubjectKey!).Distinct())
        {
            await ResolveSubjectEverywhereAsync(db, alerts, stale, ct);
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>Regra excluida ou desativada: os alertas dela deixam de ter quem os resolva, entao fecham.</summary>
    public static Task ResolveRuleAsync(WinCareDbContext db, AlertService alerts, int ruleId, CancellationToken ct) =>
        ResolveSubjectEverywhereAsync(db, alerts, Subject(ruleId), ct);

    private static async Task ResolveSubjectEverywhereAsync(WinCareDbContext db, AlertService alerts, string subject, CancellationToken ct)
    {
        var targets = await db.Alerts.AsNoTracking().Where(a => a.AlertType == AlertTypes.Log && a.SubjectKey == subject && !a.Resolved)
            .Select(a => new { a.AgentId, a.SnmpDeviceId }).Distinct().ToListAsync(ct);
        foreach (var t in targets)
        {
            await alerts.ResolveSubjectAsync(t.AgentId, t.SnmpDeviceId, AlertTypes.Log, subject, ct);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao avaliar as regras de alerta de log")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
