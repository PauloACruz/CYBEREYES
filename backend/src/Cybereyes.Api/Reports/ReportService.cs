using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Reports;

namespace Cybereyes.Api.Reports;

public sealed partial class ReportService(CybereyesDbContext db, ReportBuilder builder, INotificationSender sender, IAuditService audit,
    TimeProvider time, IConfiguration config, ILogger<ReportService> logger)
{
    public const long MaxFileBytes = 25L * 1024 * 1024;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Gera o arquivo, guarda no historico e envia por e-mail se houver destinatarios. Erro de parametro sobe como <see cref="ReportParamException"/>.</summary>
    public async Task<ReportRun> GenerateAsync(ReportParams p, string format, string requestedBy, int? scheduleId, IReadOnlyList<string> recipients,
        CancellationToken ct)
    {
        var data = await builder.BuildAsync(p, ReportBuilder.FileRows, ct);
        if (data.Truncated)
        {
            throw new ReportParamException("filters", $"O relatorio passa de {ReportBuilder.FileRows:N0} linhas; use filtros para reduzir");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        var zone = SettingsStore.TimeZone(settings);
        var bytes = format == ReportFormat.Pdf ? PdfRenderer.Render(data, zone) : CsvRenderer.Render(data, zone);
        var run = new ReportRun
        {
            Type = p.Type,
            Title = data.Title,
            Format = format,
            FileName = ReportFormatter.FileName(data, format, zone),
            Size = bytes.LongLength,
            Data = bytes.LongLength <= MaxFileBytes ? bytes : null,
            Status = bytes.LongLength <= MaxFileBytes ? "ok" : "error",
            Error = bytes.LongLength <= MaxFileBytes ? null : "Arquivo maior que 25 MB; use filtros para reduzir",
            Params = JsonSerializer.Serialize(p, Json),
            CreatedAt = time.GetUtcNow(),
            RequestedBy = requestedBy,
            ScheduleId = scheduleId,
        };
        db.ReportRuns.Add(run);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("report.generated", "report_run", run.Id.ToString(CultureInfo.InvariantCulture),
            $"Relatorio {data.Title} ({format}) gerado por {requestedBy}", requestedBy, ct);

        if (run.Status == "ok" && recipients.Count > 0)
        {
            try
            {
                var period = ReportFormatter.Period(data, zone);
                var content = EmailTemplates.Report(data.Title, period, data.Summary.Select(s => (s.Label, s.Value)).ToList(), run.FileName,
                    config["App:PublicUrl"]);
                await sender.SendEmailAsync(settings, recipients, content,
                    [new EmailAttachment(run.FileName, format == ReportFormat.Pdf ? "application/pdf" : "text/csv", bytes)], ct);
                run.EmailedTo = recipients.ToList();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogEmailFailed(logger, ex, run.Id);
                run.Error = "Falha ao enviar o e-mail: " + (ex.Message.Length > 300 ? ex.Message[..300] : ex.Message);
                await audit.LogAsync("report.email.failed", "report_run", run.Id.ToString(CultureInfo.InvariantCulture), run.Error, requestedBy, ct);
            }
            await db.SaveChangesAsync(ct);
        }
        return run;
    }

    /// <summary>Proximo horario do agendamento depois de <paramref name="after"/>, calculado no fuso configurado.</summary>
    public static DateTimeOffset NextRun(ReportSchedule s, DateTimeOffset after, TimeZoneInfo zone)
    {
        var parts = s.Time.Split(':');
        var hour = int.Parse(parts[0], CultureInfo.InvariantCulture);
        var minute = int.Parse(parts[1], CultureInfo.InvariantCulture);
        var local = TimeZoneInfo.ConvertTime(after, zone).DateTime.Date;
        for (var day = 0; day <= 62; day++)
        {
            var date = local.AddDays(day);
            var matches = s.Frequency switch
            {
                "daily" => true,
                "weekly" => (int)date.DayOfWeek == (s.DayOfWeek ?? 1),
                _ => date.Day == (s.DayOfMonth ?? 1),
            };
            if (!matches)
            {
                continue;
            }
            var at = date.AddHours(hour).AddMinutes(minute);
            if (zone.IsInvalidTime(at))
            {
                at = at.AddHours(1);
            }
            var candidate = new DateTimeOffset(at, zone.GetUtcOffset(at)).ToUniversalTime();
            if (candidate > after)
            {
                return candidate;
            }
        }
        return after.AddDays(1);
    }

    public static ReportParams ParamsOf(ReportSchedule s) =>
        JsonSerializer.Deserialize<ReportParams>(s.Params, Json) ?? new ReportParams(s.Type);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao enviar por e-mail o relatorio {RunId}")]
    private static partial void LogEmailFailed(ILogger logger, Exception ex, long runId);
}

/// <summary>Dispara os agendamentos vencidos (um por horario, mesmo com varias replicas) e apaga arquivos com mais de 90 dias.</summary>
public sealed partial class ReportScheduler(IServiceScopeFactory scopes, TimeProvider time, ILogger<ReportScheduler> logger) : BackgroundService
{
    public static readonly TimeSpan Retention = TimeSpan.FromDays(90);

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
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var now = time.GetUtcNow();
        var cutoff = now - Retention;
        await db.ReportRuns.Where(r => r.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
        await db.ReportDispatches.Where(r => r.Slot < cutoff).ExecuteDeleteAsync(ct);

        var due = await db.ReportSchedules.AsNoTracking().Where(s => s.Enabled && s.NextRunAt != null && s.NextRunAt <= now).Select(s => s.Id).ToListAsync(ct);
        foreach (var id in due)
        {
            await using var inner = scopes.CreateAsyncScope();
            await RunScheduleAsync(inner.ServiceProvider, id, slotOnly: true, ct);
        }
    }

    /// <summary>Executa um agendamento. Com <paramref name="slotOnly"/>, so roda se conseguir reservar o horario vencido.</summary>
    public static async Task<ReportRun?> RunScheduleAsync(IServiceProvider services, int scheduleId, bool slotOnly, CancellationToken ct)
    {
        var db = services.GetRequiredService<CybereyesDbContext>();
        var clock = services.GetRequiredService<TimeProvider>();
        var schedule = await db.ReportSchedules.FirstOrDefaultAsync(s => s.Id == scheduleId, ct);
        if (schedule is null)
        {
            return null;
        }
        var zone = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        if (slotOnly)
        {
            db.ReportDispatches.Add(new ReportDispatch { ScheduleId = schedule.Id, Slot = schedule.NextRunAt!.Value });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                return null;
            }
        }

        var svc = services.GetRequiredService<ReportService>();
        ReportRun run;
        try
        {
            run = await svc.GenerateAsync(ReportService.ParamsOf(schedule), schedule.Format, $"agendamento:{schedule.Name}", schedule.Id, schedule.Recipients, ct);
        }
        catch (ReportParamException ex)
        {
            run = new ReportRun
            {
                Type = schedule.Type, Title = schedule.Name, Format = schedule.Format, Status = "error", Error = ex.Message,
                RequestedBy = $"agendamento:{schedule.Name}", ScheduleId = schedule.Id, CreatedAt = clock.GetUtcNow(), Params = schedule.Params,
            };
            db.ReportRuns.Add(run);
        }
        schedule.LastRunAt = clock.GetUtcNow();
        schedule.LastStatus = run.Status == "ok" && run.Error is null ? "ok" : "error";
        schedule.NextRunAt = ReportService.NextRun(schedule, clock.GetUtcNow(), zone);
        await db.SaveChangesAsync(ct);
        return run;
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao executar os agendamentos de relatorio")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
