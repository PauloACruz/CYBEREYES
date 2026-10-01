using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Net.Mail;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Monitoring;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Reports;
using WinCare.Core.Security;

namespace WinCare.Api.Reports;

public sealed record ReportRunDto(long Id, string Type, string Title, string Format, string Status, string? Error, string FileName, long Size,
    DateTimeOffset CreatedAt, string RequestedBy, int? ScheduleId, List<string> EmailedTo);

public sealed record SaveReportSchedule(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required] ReportParams Params,
    [property: Required] string Format,
    [property: Required] string Frequency,
    [property: Required] string Time,
    int? DayOfWeek,
    int? DayOfMonth,
    [property: Required] List<string> Recipients,
    bool Enabled);

public sealed record ReportScheduleDto(int Id, string Name, ReportParams Params, string Format, string Frequency, string Time, int? DayOfWeek,
    int? DayOfMonth, List<string> Recipients, bool Enabled, DateTimeOffset? LastRunAt, string? LastStatus, DateTimeOffset? NextRunAt, string CreatedBy);

public static partial class ReportEndpoints
{
    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex TimePattern();

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.ReportsView);
        var manage = Policies.Permission(Permissions.ReportsManage);
        var g = app.MapGroup("/api/reports").WithTags("Relatorios");

        g.MapGet("/types", () => TypedResults.Ok(ReportTypes.All)).RequireAuthorization(view);
        g.MapPost("/preview", async (ReportParams p, ReportBuilder builder, CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await builder.BuildAsync(p, ReportBuilder.PreviewRows, ct));
            }
            catch (ReportParamException ex)
            {
                return Problems.Validation(ex.Field, ex.Message);
            }
        }).RequireAuthorization(view);
        g.MapPost("/runs", async (GenerateReportRequest r, ClaimsPrincipal user, ReportService svc, CancellationToken ct) =>
        {
            if (!ReportFormat.IsValid(r.Format))
            {
                return Problems.Validation("format", "Use pdf ou csv");
            }
            try
            {
                var run = await svc.GenerateAsync(r.Params, r.Format, user.Identity?.Name ?? "?", null, [], ct);
                return Results.Created($"/api/reports/runs/{run.Id}", ToDto(run));
            }
            catch (ReportParamException ex)
            {
                return Problems.Validation(ex.Field, ex.Message);
            }
        }).RequireAuthorization(view);
        g.MapGet("/runs", async (int? page, int? pageSize, int? scheduleId, WinCareDbContext db, CancellationToken ct) =>
        {
            var p = Math.Max(1, page ?? 1);
            var size = Math.Clamp(pageSize ?? 25, 1, 100);
            var q = db.ReportRuns.AsNoTracking();
            if (scheduleId is { } s)
            {
                q = q.Where(r => r.ScheduleId == s);
            }
            var total = await q.CountAsync(ct);
            var items = await q.OrderByDescending(r => r.CreatedAt).Skip((p - 1) * size).Take(size)
                .Select(r => new ReportRunDto(r.Id, r.Type, r.Title, r.Format, r.Status, r.Error, r.FileName, r.Size, r.CreatedAt, r.RequestedBy, r.ScheduleId, r.EmailedTo))
                .ToListAsync(ct);
            return TypedResults.Ok(new { items, total, page = p, pageSize = size });
        }).RequireAuthorization(view);
        g.MapGet("/runs/{id:long}/download", async (long id, WinCareDbContext db, CancellationToken ct) =>
        {
            var run = await db.ReportRuns.AsNoTracking().Where(r => r.Id == id).Select(r => new { r.FileName, r.Format, r.Data }).FirstOrDefaultAsync(ct);
            if (run?.Data is null)
            {
                return Problems.NotFound("Arquivo do relatorio");
            }
            return Results.File(run.Data, run.Format == ReportFormat.Pdf ? "application/pdf" : "text/csv; charset=utf-8", run.FileName);
        }).RequireAuthorization(view);
        g.MapDelete("/runs/{id:long}", async (long id, WinCareDbContext db, CancellationToken ct) =>
            await db.ReportRuns.Where(r => r.Id == id).ExecuteDeleteAsync(ct) == 0 ? Problems.NotFound("Relatorio") : TypedResults.NoContent())
            .RequireAuthorization(manage);

        g.MapGet("/schedules", async (WinCareDbContext db, CancellationToken ct) =>
            TypedResults.Ok((await db.ReportSchedules.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct)).Select(ToDto))).RequireAuthorization(view);
        g.MapPost("/schedules", (SaveReportSchedule r, ClaimsPrincipal user, WinCareDbContext db, TimeProvider t, IAuditService audit, CancellationToken ct) =>
            SaveScheduleAsync(null, r, user, db, t, audit, ct)).RequireAuthorization(manage);
        g.MapPut("/schedules/{id:int}", (int id, SaveReportSchedule r, ClaimsPrincipal user, WinCareDbContext db, TimeProvider t, IAuditService audit, CancellationToken ct) =>
            SaveScheduleAsync(id, r, user, db, t, audit, ct)).RequireAuthorization(manage);
        g.MapDelete("/schedules/{id:int}", async (int id, WinCareDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            if (await db.ReportSchedules.Where(s => s.Id == id).ExecuteDeleteAsync(ct) == 0)
            {
                return Problems.NotFound("Agendamento");
            }
            await audit.LogAsync("report.schedule.deleted", "report_schedule", id.ToString(CultureInfo.InvariantCulture), null, cancellationToken: ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(manage);
        g.MapPost("/schedules/{id:int}/run", async (int id, IServiceProvider services, CancellationToken ct) =>
            await ReportScheduler.RunScheduleAsync(services, id, slotOnly: false, ct) is { } run
                ? Results.Created($"/api/reports/runs/{run.Id}", ToDto(run))
                : Problems.NotFound("Agendamento")).RequireAuthorization(manage);
    }

    private static ReportRunDto ToDto(ReportRun r) =>
        new(r.Id, r.Type, r.Title, r.Format, r.Status, r.Error, r.FileName, r.Size, r.CreatedAt, r.RequestedBy, r.ScheduleId, r.EmailedTo);

    private static ReportScheduleDto ToDto(ReportSchedule s) => new(s.Id, s.Name, ReportService.ParamsOf(s), s.Format, s.Frequency, s.Time, s.DayOfWeek,
        s.DayOfMonth, s.Recipients, s.Enabled, s.LastRunAt, s.LastStatus, s.NextRunAt, s.CreatedBy);

    private static async Task<IResult> SaveScheduleAsync(int? id, SaveReportSchedule r, ClaimsPrincipal user, WinCareDbContext db, TimeProvider clock,
        IAuditService audit, CancellationToken ct)
    {
        var info = ReportTypes.Find(r.Params.Type);
        if (info is null)
        {
            return Problems.Validation("params.type", "Tipo de relatorio desconhecido");
        }
        if (info.UsesPeriod && (r.Params.Period is null || !ReportPeriods.All.Contains(r.Params.Period)))
        {
            return Problems.Validation("params.period", "Escolha um periodo relativo (ultimas 24 h, 7 dias, 30 dias, mes anterior ou mes atual)");
        }
        if (r.Params.From is not null || r.Params.To is not null)
        {
            return Problems.Validation("params.from", "Agendamentos usam periodo relativo, sem datas fixas");
        }
        if (!ReportFormat.IsValid(r.Format))
        {
            return Problems.Validation("format", "Use pdf ou csv");
        }
        if (r.Frequency is not ("daily" or "weekly" or "monthly"))
        {
            return Problems.Validation("frequency", "Use daily, weekly ou monthly");
        }
        if (!TimePattern().IsMatch(r.Time))
        {
            return Problems.Validation("time", "Use o formato HH:mm");
        }
        if (r.Frequency == "weekly" && r.DayOfWeek is not (>= 0 and <= 6))
        {
            return Problems.Validation("dayOfWeek", "Informe o dia da semana (0 = domingo a 6 = sabado)");
        }
        if (r.Frequency == "monthly" && r.DayOfMonth is not (>= 1 and <= 28))
        {
            return Problems.Validation("dayOfMonth", "Informe o dia do mes entre 1 e 28");
        }
        var recipients = r.Recipients.Select(e => e.Trim()).Where(e => e.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (recipients.Count is 0 or > 20 || recipients.Any(e => e.Length > 254 || !MailAddress.TryCreate(e, out _)))
        {
            return Problems.Validation("recipients", "Informe de 1 a 20 e-mails validos");
        }

        var schedule = id is null
            ? new ReportSchedule { Name = r.Name, Type = info.Type, CreatedBy = user.Identity?.Name ?? "?" }
            : await db.ReportSchedules.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (schedule is null)
        {
            return Problems.NotFound("Agendamento");
        }
        schedule.Name = r.Name.Trim();
        schedule.Type = info.Type;
        schedule.Params = JsonSerializer.Serialize(r.Params, ReportService.Json);
        schedule.Format = r.Format;
        schedule.Frequency = r.Frequency;
        schedule.Time = r.Time;
        schedule.DayOfWeek = r.Frequency == "weekly" ? r.DayOfWeek : null;
        schedule.DayOfMonth = r.Frequency == "monthly" ? r.DayOfMonth : null;
        schedule.Recipients = recipients;
        schedule.Enabled = r.Enabled;
        var zone = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        schedule.NextRunAt = ReportService.NextRun(schedule, clock.GetUtcNow(), zone);
        if (id is null)
        {
            db.ReportSchedules.Add(schedule);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "report.schedule.created" : "report.schedule.updated", "report_schedule",
            schedule.Id.ToString(CultureInfo.InvariantCulture), $"Agendamento {schedule.Name} ({schedule.Type}, {schedule.Frequency} {schedule.Time})", cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/reports/schedules/{schedule.Id}", ToDto(schedule)) : TypedResults.Ok(ToDto(schedule));
    }
}
