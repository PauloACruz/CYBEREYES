using Microsoft.EntityFrameworkCore;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;

namespace WinCare.Api.Rmm.Monitoring;

/// <summary>
/// Dispara as tarefas agendadas pelo servidor (para todos os sistemas). Cada disparo e registrado com chave unica
/// (tarefa, agente, horario), entao varias replicas da API podem rodar este servico sem duplicar execucoes.
/// </summary>
public sealed partial class AgentTaskScheduler(IServiceScopeFactory scopes, TimeProvider time, ILogger<AgentTaskScheduler> logger) : BackgroundService
{
    public const int PatchInstallTaskId = 0;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunOnceAsync(time.GetUtcNow(), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    public async Task<int> RunOnceAsync(DateTimeOffset nowUtc, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var rpc = scope.ServiceProvider.GetRequiredService<IAgentRpc>();
        var tz = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        var slotUtc = new DateTimeOffset(nowUtc.Year, nowUtc.Month, nowUtc.Day, nowUtc.Hour, nowUtc.Minute, 0, TimeSpan.Zero);
        var local = TimeZoneInfo.ConvertTime(slotUtc, tz);

        var tasks = (await db.Tasks.AsNoTracking().Where(t => t.Enabled && t.ScheduleType != TaskSchedules.Manual && t.ScheduleType != TaskSchedules.CheckFailure)
            .ToListAsync(ct)).Where(t => IsDue(t, slotUtc, local)).ToList();
        if (tasks.Count == 0)
        {
            return 0;
        }

        Dictionary<int, List<int>>? policyAgents = null;
        var dispatched = 0;
        foreach (var task in tasks)
        {
            List<int> agentIds;
            if (task.AgentId is { } single)
            {
                agentIds = [single];
            }
            else
            {
                policyAgents ??= await AgentsByPolicyAsync(db, ct);
                agentIds = policyAgents.GetValueOrDefault(task.PolicyId!.Value) ?? [];
            }

            foreach (var agentId in agentIds)
            {
                if (!await ClaimAsync(db, task.Id, agentId, slotUtc, ct))
                {
                    continue;
                }
                var agent = await db.Agents.AsNoTracking().Where(a => a.Id == agentId).Select(a => a.AgentId).FirstOrDefaultAsync(ct);
                if (agent is not null)
                {
                    await rpc.PublishAsync(agent, new Dictionary<string, object?> { ["func"] = "runtask", ["taskpk"] = task.Id }, ct);
                    dispatched++;
                }
            }
        }
        return dispatched;
    }

    public static async Task<bool> ClaimAsync(WinCareDbContext db, int taskId, int agentId, DateTimeOffset slot, CancellationToken ct)
    {
        var claimed = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO task_dispatches ("TaskId", "AgentId", "Slot") VALUES ({taskId}, {agentId}, {slot}) ON CONFLICT DO NOTHING""", ct);
        return claimed > 0;
    }

    private static async Task<Dictionary<int, List<int>>> AgentsByPolicyAsync(WinCareDbContext db, CancellationToken ct)
    {
        var map = new Dictionary<int, List<int>>();
        foreach (var agentId in await db.Agents.AsNoTracking().Select(a => a.Id).ToListAsync(ct))
        {
            foreach (var policy in await PolicyResolver.ForAgentAsync(db, agentId, ct))
            {
                if (!map.TryGetValue(policy.PolicyId, out var list))
                {
                    map[policy.PolicyId] = list = [];
                }
                list.Add(agentId);
            }
        }
        return map;
    }

    public static bool IsDue(AutomatedTask task, DateTimeOffset slotUtc, DateTimeOffset local)
    {
        if (task.ScheduleType == TaskSchedules.Once)
        {
            return task.RunAt is { } at && at >= slotUtc && at < slotUtc.AddMinutes(1);
        }
        if (task.Time is not { } time || $"{local:HH:mm}" != time)
        {
            return false;
        }
        return task.ScheduleType switch
        {
            TaskSchedules.Daily => true,
            TaskSchedules.Weekly => task.DaysOfWeek.Contains((int)local.DayOfWeek),
            TaskSchedules.Monthly => local.Day == Math.Min(task.DayOfMonth ?? 1, DateTime.DaysInMonth(local.Year, local.Month)),
            _ => false,
        };
    }

    public static DateTimeOffset? NextRun(AutomatedTask task, DateTimeOffset nowUtc, TimeZoneInfo tz)
    {
        if (task.ScheduleType == TaskSchedules.Once)
        {
            return task.RunAt > nowUtc ? task.RunAt : null;
        }
        if (task.Time is null || task.ScheduleType is TaskSchedules.Manual or TaskSchedules.CheckFailure)
        {
            return null;
        }
        var start = new DateTimeOffset(nowUtc.Year, nowUtc.Month, nowUtc.Day, nowUtc.Hour, nowUtc.Minute, 0, TimeSpan.Zero).AddMinutes(1);
        for (var day = 0; day < 62; day++)
        {
            var localDay = TimeZoneInfo.ConvertTime(start, tz).Date.AddDays(day);
            var hour = int.Parse(task.Time[..2], System.Globalization.CultureInfo.InvariantCulture);
            var minute = int.Parse(task.Time[3..], System.Globalization.CultureInfo.InvariantCulture);
            var localTime = localDay.AddHours(hour).AddMinutes(minute);
            var candidate = new DateTimeOffset(localTime, tz.GetUtcOffset(localTime)).ToUniversalTime();
            if (candidate >= start && IsDue(task, candidate, TimeZoneInfo.ConvertTime(candidate, tz)))
            {
                return candidate;
            }
        }
        return null;
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha no agendador de tarefas")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

/// <summary>Aprova atualizacoes do Windows conforme a politica de patch e instala no horario configurado.</summary>
public sealed partial class PatchScheduler(IServiceScopeFactory scopes, TimeProvider time, ILogger<PatchScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunOnceAsync(time.GetUtcNow(), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    public async Task RunOnceAsync(DateTimeOffset nowUtc, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var rpc = scope.ServiceProvider.GetRequiredService<IAgentRpc>();
        var tz = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        var local = TimeZoneInfo.ConvertTime(nowUtc, tz);
        var hourSlot = new DateTimeOffset(nowUtc.Year, nowUtc.Month, nowUtc.Day, nowUtc.Hour, 0, 0, TimeSpan.Zero);

        var agents = await db.Agents.AsNoTracking().Where(a => a.Plat == "windows").Select(a => new { a.Id, a.AgentId, a.Status }).ToListAsync(ct);
        foreach (var agent in agents)
        {
            var policy = await PatchPolicies.EffectiveAsync(db, agent.Id, ct);
            var pending = await db.WinUpdates.Where(u => u.AgentId == agent.Id && !u.Installed && u.Action == "nothing").ToListAsync(ct);
            foreach (var update in pending)
            {
                var rule = update.Severity switch
                {
                    "Critical" => policy.Critical,
                    "Important" => policy.Important,
                    "Moderate" => policy.Moderate,
                    "Low" => policy.Low,
                    _ => policy.Other,
                };
                if (rule is "approve" or "ignore")
                {
                    update.Action = rule;
                }
            }
            await db.SaveChangesAsync(ct);

            if (agent.Status != AgentStatus.Online || local.Hour != policy.RunTimeHour || !policy.RunTimeDays.Contains((int)local.DayOfWeek))
            {
                continue;
            }
            var guids = await db.WinUpdates.Where(u => u.AgentId == agent.Id && !u.Installed && u.Action == "approve").Select(u => u.UpdateGuid).ToListAsync(ct);
            if (guids.Count > 0 && await AgentTaskScheduler.ClaimAsync(db, AgentTaskScheduler.PatchInstallTaskId, agent.Id, hourSlot, ct))
            {
                await rpc.PublishAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "installwinupdates", ["guids"] = guids }, ct);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha no agendador de atualizacoes do Windows")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

/// <summary>Limpeza periodica de historicos conforme as configuracoes globais.</summary>
public sealed partial class MaintenanceService(IServiceScopeFactory scopes, TimeProvider time, ILogger<MaintenanceService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
                var settings = await SettingsStore.GetAsync(db, stoppingToken);
                var now = time.GetUtcNow();
                await db.CheckHistory.Where(h => h.Time < now.AddDays(-settings.CheckHistoryDays)).ExecuteDeleteAsync(stoppingToken);
                await db.AgentHistory.Where(h => h.Time < now.AddDays(-settings.AgentHistoryDays)).ExecuteDeleteAsync(stoppingToken);
                await db.TaskDispatches.Where(d => d.Slot < now.AddDays(-2)).ExecuteDeleteAsync(stoppingToken);
                await db.InstallerTokens.Where(t => t.ExpiresAt < now.AddDays(-1)).ExecuteDeleteAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha na manutencao periodica")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
