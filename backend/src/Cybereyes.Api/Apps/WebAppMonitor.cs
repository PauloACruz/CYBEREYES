using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Apps;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Apps;

/// <summary>
/// Verifica as aplicacoes no intervalo de cada uma. Com varias replicas, cada verificacao e reservada por uma atualizacao
/// condicional de NextCheckAt: so a replica que conseguiu mudar o valor faz a verificacao. Depois de uma falha a proxima
/// vem mais cedo (ate 20 s) para confirmar a queda; o alerta sai quando as falhas seguidas chegam ao limite da aplicacao.
/// </summary>
public sealed partial class WebAppMonitor(IServiceScopeFactory scopes, IHubContext<ConsoleHub> hub, TimeProvider time, IConfiguration config,
    ILogger<WebAppMonitor> logger) : BackgroundService
{
    public const int RetentionDays = 30;
    public const string DownSubject = "down";
    public const string SslSubject = "ssl";
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaintenanceEvery = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan StaleRun = TimeSpan.FromMinutes(3);
    private const int ConfirmSeconds = 20;
    private DateTimeOffset lastMaintenance = DateTimeOffset.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Desligavel para testes, que chamam CheckNowAsync e MaintenanceAsync diretamente.
        if (!config.GetValue("WebApps:BackgroundChecks", true))
        {
            return;
        }
        using var timer = new PeriodicTimer(Tick);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunDueAsync(stoppingToken);
                if (time.GetUtcNow() - lastMaintenance >= MaintenanceEvery)
                {
                    lastMaintenance = time.GetUtcNow();
                    await MaintenanceAsync(stoppingToken);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    public async Task RunDueAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow();
        List<(int Id, DateTimeOffset NextCheckAt)> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            due = (await db.WebApps.AsNoTracking().Where(w => w.MonitorEnabled && w.NextCheckAt <= now).OrderBy(w => w.NextCheckAt).Take(200)
                .Select(w => new { w.Id, w.NextCheckAt }).ToListAsync(ct)).Select(w => (w.Id, w.NextCheckAt)).ToList();
        }
        await Parallel.ForEachAsync(due, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct }, async (item, token) =>
        {
            try
            {
                await CheckAsync(item.Id, item.NextCheckAt, token);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogCheckFailed(logger, ex, item.Id);
            }
        });
    }

    /// <summary>Verificacao pedida pelo tecnico ("Verificar agora"), fora da fila.</summary>
    public Task<ProbeResult?> CheckNowAsync(int webAppId, CancellationToken ct) => CheckAsync(webAppId, null, ct);

    private async Task<ProbeResult?> CheckAsync(int webAppId, DateTimeOffset? reservedFrom, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var app = await db.WebApps.FirstOrDefaultAsync(w => w.Id == webAppId, ct);
        if (app is null)
        {
            return null;
        }
        if (reservedFrom is { } from)
        {
            var next = time.GetUtcNow().AddSeconds(app.IntervalSeconds);
            var reserved = await db.WebApps.Where(w => w.Id == webAppId && w.NextCheckAt == from)
                .ExecuteUpdateAsync(s => s.SetProperty(w => w.NextCheckAt, next), ct);
            if (reserved == 0)
            {
                return null;
            }
        }
        var result = await WebAppProbe.RunAsync(ProbeRequest.From(app), ct);
        await RecordAsync(db, scope.ServiceProvider.GetRequiredService<AlertService>(), app, result, ct);
        return result;
    }

    private async Task RecordAsync(CybereyesDbContext db, AlertService alerts, WebApp app, ProbeResult result, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var error = result.Error is { Length: > 1000 } e ? e[..1000] : result.Error;
        db.WebAppChecks.Add(new WebAppCheck
        {
            WebAppId = app.Id, Time = now, Up = result.Up, LatencyMs = result.LatencyMs, StatusCode = result.StatusCode, Error = error,
        });

        var previous = app.Status;
        app.LastCheckedAt = now;
        app.LastLatencyMs = result.LatencyMs;
        app.LastStatusCode = result.StatusCode;
        app.LastError = error;
        if (result.CertificateExpiresAt is { } expires)
        {
            app.SslExpiresAt = expires;
        }
        else if (!IsHttps(app))
        {
            app.SslExpiresAt = null;
        }
        if (result.Up)
        {
            app.ConsecutiveFailures = 0;
            app.Status = WebAppStatus.Up;
        }
        else
        {
            app.ConsecutiveFailures++;
            if (app.ConsecutiveFailures >= app.FailuresBeforeAlert)
            {
                app.Status = WebAppStatus.Down;
            }
        }
        if (!app.MonitorEnabled)
        {
            app.Status = WebAppStatus.Paused;
        }
        if (app.Status != previous)
        {
            app.StatusChangedAt = now;
        }
        var confirming = !result.Up && app.Status != WebAppStatus.Down;
        app.NextCheckAt = now.AddSeconds(confirming ? Math.Min(app.IntervalSeconds, ConfirmSeconds) : app.IntervalSeconds);
        await db.SaveChangesAsync(ct);

        if (app.Status == WebAppStatus.Down && previous != WebAppStatus.Down)
        {
            await alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, null, DownSubject, AlertTypes.WebAppDown, app.AlertSeverity,
                $"{app.Name} fora do ar ({app.ConsecutiveFailures} falhas seguidas): {error}", app.Id), ct);
        }
        else if (app.Status == WebAppStatus.Up && previous != WebAppStatus.Up)
        {
            await alerts.ResolveWebAppAsync(app.Id, AlertTypes.WebAppDown, ct);
        }
        await CertificateAlertAsync(alerts, app, now, ct);

        if (app.Status != previous)
        {
            await hub.Clients.ForClient(app.ClientId).SendAsync("webAppChanged", new { id = app.Id, status = app.Status, previous }, ct);
        }
    }

    private static async Task CertificateAlertAsync(AlertService alerts, WebApp app, DateTimeOffset now, CancellationToken ct)
    {
        if (app.SslWarnDays <= 0 || app.SslExpiresAt is not { } expires || !IsHttps(app))
        {
            await alerts.ResolveWebAppAsync(app.Id, AlertTypes.WebAppSsl, ct);
            return;
        }
        var days = (int)Math.Floor((expires - now).TotalDays);
        if (days > app.SslWarnDays)
        {
            await alerts.ResolveWebAppAsync(app.Id, AlertTypes.WebAppSsl, ct);
            return;
        }
        var date = expires.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var message = expires <= now
            ? $"O certificado TLS de {app.Name} venceu em {date}"
            : $"O certificado TLS de {app.Name} vence em {Math.Max(days, 0)} dia(s), em {date}";
        await alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, null, SslSubject, AlertTypes.WebAppSsl,
            expires <= now ? Severity.Error : Severity.Warning, message, app.Id), ct);
    }

    private static bool IsHttps(WebApp app) =>
        app.CheckType == WebAppCheckType.Http && app.CheckTarget.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    /// <summary>Apaga verificacoes antigas e fecha execucoes SSH paradas (replica que caiu no meio).</summary>
    public async Task MaintenanceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var locked = await db.Database.SqlQueryRaw<bool>("SELECT pg_try_advisory_xact_lock(hashtext('cybereyes-webapp-maintenance')) AS \"Value\"")
            .SingleAsync(ct);
        if (!locked)
        {
            return;
        }
        var now = time.GetUtcNow();
        var cutoff = now.AddDays(-RetentionDays);
        await db.WebAppChecks.Where(c => c.Time < cutoff).ExecuteDeleteAsync(ct);
        var stale = now - StaleRun;
        await db.AppRuns.Where(r => r.Status == AppRunStatus.Running && r.UpdatedAt < stale).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Status, AppRunStatus.Failed)
            .SetProperty(r => r.Error, "Execucao interrompida: a replica da API que a acompanhava parou")
            .SetProperty(r => r.FinishedAt, now), ct);
        await tx.CommitAsync(ct);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha no monitoramento das aplicacoes")]
    private static partial void LogFailed(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao verificar a aplicacao {WebAppId}")]
    private static partial void LogCheckFailed(ILogger logger, Exception ex, int webAppId);
}
