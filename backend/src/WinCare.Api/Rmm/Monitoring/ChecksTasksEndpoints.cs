using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Actions;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm.Monitoring;

public sealed record SaveCheckRequest(
    int? AgentId, int? PolicyId,
    [property: Required] string CheckType,
    [property: StringLength(255)] string? Name,
    [property: Range(0, 86400)] int RunInterval,
    [property: Range(1, 100)] int FailsBeforeAlert,
    [property: Required] string AlertSeverity,
    [property: Range(0, 99)] int WarningThreshold,
    [property: Range(0, 99)] int ErrorThreshold,
    string? Disk, string? Ip, int? ScriptId, List<string>? ScriptArgs, List<string>? EnvVars,
    [property: Range(1, 86400)] int? Timeout,
    List<long>? InfoReturnCodes, List<long>? WarningReturnCodes, List<long>? SuccessReturnCodes,
    string? SvcName, bool PassIfStartPending, bool PassIfSvcNotExist, bool RestartIfStopped,
    string? LogName, int? EventId, bool EventIdIsWildcard, string? EventType, string? EventSource, string? EventMessage,
    string? FailWhen, [property: Range(1, 365)] int SearchLastDays, [property: Range(1, 10000)] int NumberOfEventsBeforeAlert,
    bool EmailAlert, bool WebhookAlert, bool DashboardAlert);

public sealed record SaveTaskRequest(
    int? AgentId, int? PolicyId,
    [property: Required, StringLength(255, MinimumLength = 1)] string Name,
    bool Enabled, bool ContinueOnError,
    [property: Required] string AlertSeverity,
    [property: Required] List<TaskAction> Actions,
    [property: Required] string ScheduleType,
    DateTimeOffset? RunAt,
    [property: RegularExpression(@"^([01]\d|2[0-3]):[0-5]\d$")] string? Time,
    List<int>? DaysOfWeek,
    [property: Range(1, 31)] int? DayOfMonth,
    int? AssignedCheckId,
    bool EmailAlert, bool WebhookAlert, bool DashboardAlert);

public sealed record SavePolicyRequest(
    [property: Required, StringLength(255, MinimumLength = 1)] string Name,
    [property: StringLength(1000)] string? Description,
    bool Enabled);

public sealed record AssignmentRequest([property: Required] string Target, int? TargetId, string? MonitoringType, int? PolicyId);

public static class ChecksTasksEndpoints
{
    private static readonly HashSet<string> EventLogs = new(StringComparer.Ordinal) { "Application", "System", "Security" };
    private static readonly HashSet<string> EventTypes = new(StringComparer.Ordinal) { "INFO", "WARNING", "ERROR", "AUDIT_SUCCESS", "AUDIT_FAILURE" };

    public static void MapChecksTasksEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var manage = Policies.Permission(Permissions.ChecksManage);
        var run = Policies.Permission(Permissions.AgentsRun);
        var policies = Policies.Permission(Permissions.PoliciesManage);

        app.MapGet("/api/agents/{id:int}/checks", AgentChecksAsync).WithTags("Monitoramento").RequireAuthorization(view);
        app.MapPost("/api/agents/{id:int}/checks/run", async (int id, WinCareDbContext db, IAgentRpc rpc, CancellationToken ct) =>
        {
            var agent = await AgentRef.FindAsync(db, id, ct);
            if (agent is null)
            {
                return Problems.NotFound("Agente");
            }
            await rpc.PublishAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "runchecks" }, ct);
            return TypedResults.Accepted((string?)null);
        }).WithTags("Monitoramento").RequireAuthorization(run);
        app.MapGet("/api/checks/{id:int}/history", HistoryAsync).WithTags("Monitoramento").RequireAuthorization(view);
        app.MapPost("/api/checks", (SaveCheckRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SaveCheckAsync(null, r, db, a, ct))
            .WithTags("Monitoramento").RequireAuthorization(manage);
        app.MapPut("/api/checks/{id:int}", (int id, SaveCheckRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SaveCheckAsync(id, r, db, a, ct))
            .WithTags("Monitoramento").RequireAuthorization(manage);
        app.MapDelete("/api/checks/{id:int}", async (int id, WinCareDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            if (await db.Checks.Where(c => c.Id == id).ExecuteDeleteAsync(ct) == 0)
            {
                return Problems.NotFound("Check");
            }
            await db.Alerts.Where(a => a.CheckId == id && !a.Resolved).ExecuteUpdateAsync(s => s.SetProperty(a => a.Resolved, true).SetProperty(a => a.ResolvedAt, DateTimeOffset.UtcNow), ct);
            await audit.LogAsync("check.deleted", "check", Id(id), "Check excluido", cancellationToken: ct);
            return TypedResults.NoContent();
        }).WithTags("Monitoramento").RequireAuthorization(manage);

        app.MapGet("/api/agents/{id:int}/tasks", AgentTasksAsync).WithTags("Monitoramento").RequireAuthorization(view);
        app.MapPost("/api/agents/{id:int}/tasks/{taskId:int}/run", async (int id, int taskId, WinCareDbContext db, IAgentRpc rpc, IAuditService audit, CancellationToken ct) =>
        {
            var agent = await AgentRef.FindAsync(db, id, ct);
            if (agent is null || !(await PolicyResolver.TasksForAgentAsync(db, id, ct)).Any(t => t.Id == taskId))
            {
                return Problems.NotFound(agent is null ? "Agente" : "Tarefa");
            }
            await rpc.PublishAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "runtask", ["taskpk"] = taskId }, ct);
            await audit.LogAsync("task.run", "agent", Id(id), $"Tarefa {taskId} executada em {agent.Hostname}", cancellationToken: ct);
            return TypedResults.Accepted((string?)null);
        }).WithTags("Monitoramento").RequireAuthorization(run);
        app.MapPost("/api/tasks", (SaveTaskRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SaveTaskAsync(null, r, db, a, ct))
            .WithTags("Monitoramento").RequireAuthorization(manage);
        app.MapPut("/api/tasks/{id:int}", (int id, SaveTaskRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SaveTaskAsync(id, r, db, a, ct))
            .WithTags("Monitoramento").RequireAuthorization(manage);
        app.MapDelete("/api/tasks/{id:int}", async (int id, WinCareDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            if (await db.Tasks.Where(t => t.Id == id).ExecuteDeleteAsync(ct) == 0)
            {
                return Problems.NotFound("Tarefa");
            }
            await audit.LogAsync("task.deleted", "task", Id(id), "Tarefa excluida", cancellationToken: ct);
            return TypedResults.NoContent();
        }).WithTags("Monitoramento").RequireAuthorization(manage);

        var pg = app.MapGroup("/api/policies").WithTags("Politicas");
        pg.MapGet("/", ListPoliciesAsync).RequireAuthorization(view);
        pg.MapGet("/{id:int}", GetPolicyAsync).RequireAuthorization(view);
        pg.MapPost("/", (SavePolicyRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SavePolicyAsync(null, r, db, a, ct)).RequireAuthorization(policies);
        pg.MapPut("/{id:int}", (int id, SavePolicyRequest r, WinCareDbContext db, IAuditService a, CancellationToken ct) => SavePolicyAsync(id, r, db, a, ct)).RequireAuthorization(policies);
        pg.MapDelete("/{id:int}", async (int id, WinCareDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            var settings = await SettingsStore.GetAsync(db, ct);
            if (settings.DefaultServerPolicyId == id)
            {
                settings.DefaultServerPolicyId = null;
            }
            if (settings.DefaultWorkstationPolicyId == id)
            {
                settings.DefaultWorkstationPolicyId = null;
            }
            await db.SaveChangesAsync(ct);
            if (await db.Policies.Where(p => p.Id == id).ExecuteDeleteAsync(ct) == 0)
            {
                return Problems.NotFound("Politica");
            }
            await audit.LogAsync("policy.deleted", "policy", Id(id), "Politica excluida", cancellationToken: ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(policies);
        pg.MapGet("/assignments", AssignmentsAsync).RequireAuthorization(view);
        pg.MapPut("/assignments", AssignAsync).RequireAuthorization(policies);
        app.MapGet("/api/agents/{id:int}/policies", async (int id, WinCareDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await PolicyResolver.ForAgentAsync(db, id, ct))).WithTags("Politicas").RequireAuthorization(view);
    }

    private static string? ValidateCheck(SaveCheckRequest r)
    {
        if ((r.AgentId is null) == (r.PolicyId is null))
        {
            return "Informe agentId ou policyId";
        }
        if (!CheckTypes.All.Contains(r.CheckType))
        {
            return "Tipo de check invalido";
        }
        if (!Severity.All.Contains(r.AlertSeverity))
        {
            return "Severidade invalida";
        }
        return r.CheckType switch
        {
            CheckTypes.DiskSpace when string.IsNullOrWhiteSpace(r.Disk) => "Informe o disco (ex.: C: ou /)",
            CheckTypes.Ping when string.IsNullOrWhiteSpace(r.Ip) => "Informe o endereco a testar",
            CheckTypes.Script when r.ScriptId is null => "Escolha o script",
            CheckTypes.WinSvc when string.IsNullOrWhiteSpace(r.SvcName) => "Informe o nome do servico",
            CheckTypes.EventLog when r.LogName is null || !EventLogs.Contains(r.LogName) => "Log invalido",
            CheckTypes.EventLog when r.EventType is null || !EventTypes.Contains(r.EventType) => "Tipo de evento invalido",
            CheckTypes.EventLog when r.FailWhen is not ("contains" or "not_contains") => "Condicao invalida",
            _ => null,
        };
    }

    private static async Task<IResult> SaveCheckAsync(int? id, SaveCheckRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (ValidateCheck(r) is { } error)
        {
            return Problems.BadRequest(error);
        }
        if (r.ScriptId is { } sid && !await db.Scripts.AnyAsync(s => s.Id == sid, ct))
        {
            return Problems.BadRequest("Script nao encontrado");
        }

        var check = id is null ? new Check { CheckType = r.CheckType } : await db.Checks.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (check is null)
        {
            return Problems.NotFound("Check");
        }
        check.AgentId = r.AgentId;
        check.PolicyId = r.PolicyId;
        check.CheckType = r.CheckType;
        check.Name = r.Name?.Trim() ?? string.Empty;
        check.RunInterval = r.RunInterval;
        check.FailsBeforeAlert = r.FailsBeforeAlert;
        check.AlertSeverity = r.AlertSeverity;
        check.WarningThreshold = r.WarningThreshold;
        check.ErrorThreshold = r.ErrorThreshold;
        check.Disk = r.Disk?.Trim();
        check.Ip = r.Ip?.Trim();
        check.ScriptId = r.CheckType == CheckTypes.Script ? r.ScriptId : null;
        check.ScriptArgs = r.ScriptArgs ?? [];
        check.EnvVars = r.EnvVars ?? [];
        check.Timeout = r.Timeout;
        check.InfoReturnCodes = r.InfoReturnCodes ?? [];
        check.WarningReturnCodes = r.WarningReturnCodes ?? [];
        check.SuccessReturnCodes = r.SuccessReturnCodes ?? [];
        check.SvcName = r.SvcName?.Trim();
        check.PassIfStartPending = r.PassIfStartPending;
        check.PassIfSvcNotExist = r.PassIfSvcNotExist;
        check.RestartIfStopped = r.RestartIfStopped;
        check.LogName = r.LogName;
        check.EventId = r.EventId;
        check.EventIdIsWildcard = r.EventIdIsWildcard;
        check.EventType = r.EventType;
        check.EventSource = r.EventSource;
        check.EventMessage = r.EventMessage;
        check.FailWhen = r.FailWhen ?? "contains";
        check.SearchLastDays = r.SearchLastDays;
        check.NumberOfEventsBeforeAlert = r.NumberOfEventsBeforeAlert;
        check.EmailAlert = r.EmailAlert;
        check.WebhookAlert = r.WebhookAlert;
        check.DashboardAlert = r.DashboardAlert;
        if (id is null)
        {
            db.Checks.Add(check);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "check.created" : "check.updated", "check", Id(check.Id), $"Check {check.CheckType} {check.Name}", cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/checks/{check.Id}", check) : TypedResults.Ok(check);
    }

    private static async Task<IResult> AgentChecksAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var policies = (await PolicyResolver.ForAgentAsync(db, id, ct)).ToDictionary(p => p.PolicyId, p => p.Name);
        var checks = await PolicyResolver.ChecksForAgentAsync(db, id, ct);
        var results = await db.CheckResults.AsNoTracking().Where(r => r.AgentId == id).ToDictionaryAsync(r => r.CheckId, ct);
        return TypedResults.Ok(checks.OrderBy(c => c.CheckType).ThenBy(c => c.Name).Select(c => new
        {
            check = c,
            inherited = c.PolicyId is not null,
            policyName = c.PolicyId is { } pid ? policies.GetValueOrDefault(pid) : null,
            result = results.GetValueOrDefault(c.Id) is { } r ? new
            {
                r.Status, r.AlertSeverity, r.MoreInfo, r.LastRun, r.FailCount, r.Stdout, r.Stderr, r.Retcode, r.ExecutionTime, r.History,
            } : null,
        }).ToList());
    }

    private static async Task<IResult> HistoryAsync(int id, int agentId, int? hours, WinCareDbContext db, CancellationToken ct)
    {
        var since = DateTimeOffset.UtcNow.AddHours(-Math.Clamp(hours ?? 24, 1, 24 * 90));
        return TypedResults.Ok(await db.CheckHistory.AsNoTracking()
            .Where(h => h.CheckId == id && h.AgentId == agentId && h.Time >= since)
            .OrderBy(h => h.Time)
            .Select(h => new { h.Time, h.Value, h.Status, h.Results })
            .ToListAsync(ct));
    }

    private static string? ValidateTask(SaveTaskRequest r)
    {
        if ((r.AgentId is null) == (r.PolicyId is null))
        {
            return "Informe agentId ou policyId";
        }
        if (!TaskSchedules.All.Contains(r.ScheduleType) || !Severity.All.Contains(r.AlertSeverity))
        {
            return "Agendamento ou severidade invalida";
        }
        if (r.Actions.Count == 0)
        {
            return "Inclua ao menos uma acao";
        }
        if (r.Actions.Any(a => a.Type is not ("cmd" or "script") || (a.Type == "cmd" && string.IsNullOrWhiteSpace(a.Command)) ||
                               (a.Type == "script" && a.ScriptId is null) || a.Timeout is < 5 or > 86400))
        {
            return "Acao invalida: comando ou script obrigatorio e timeout entre 5 e 86400 segundos";
        }
        return r.ScheduleType switch
        {
            TaskSchedules.Once when r.RunAt is null => "Informe a data e hora da execucao",
            TaskSchedules.Daily or TaskSchedules.Weekly or TaskSchedules.Monthly when r.Time is null => "Informe o horario",
            TaskSchedules.Weekly when r.DaysOfWeek is not { Count: > 0 } || r.DaysOfWeek.Any(d => d is < 0 or > 6) => "Escolha os dias da semana",
            TaskSchedules.Monthly when r.DayOfMonth is null => "Informe o dia do mes",
            TaskSchedules.CheckFailure when r.AssignedCheckId is null => "Escolha o check que dispara a tarefa",
            _ => null,
        };
    }

    private static async Task<IResult> SaveTaskAsync(int? id, SaveTaskRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (ValidateTask(r) is { } error)
        {
            return Problems.BadRequest(error);
        }
        var task = id is null ? new AutomatedTask { Name = r.Name, Actions = "[]" } : await db.Tasks.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (task is null)
        {
            return Problems.NotFound("Tarefa");
        }
        task.AgentId = r.AgentId;
        task.PolicyId = r.PolicyId;
        task.Name = r.Name.Trim();
        task.Enabled = r.Enabled;
        task.ContinueOnError = r.ContinueOnError;
        task.AlertSeverity = r.AlertSeverity;
        task.Actions = TaskActions.Serialize(r.Actions);
        task.ScheduleType = r.ScheduleType;
        task.RunAt = r.RunAt?.ToUniversalTime();
        task.Time = r.Time;
        task.DaysOfWeek = r.DaysOfWeek ?? [];
        task.DayOfMonth = r.DayOfMonth;
        task.AssignedCheckId = r.ScheduleType == TaskSchedules.CheckFailure ? r.AssignedCheckId : null;
        task.EmailAlert = r.EmailAlert;
        task.WebhookAlert = r.WebhookAlert;
        task.DashboardAlert = r.DashboardAlert;
        if (id is null)
        {
            db.Tasks.Add(task);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "task.created" : "task.updated", "task", Id(task.Id), $"Tarefa {task.Name}", cancellationToken: ct);
        var dto = TaskDto(task);
        return id is null ? TypedResults.Created($"/api/tasks/{task.Id}", dto) : TypedResults.Ok(dto);
    }

    public static object TaskDto(AutomatedTask t) => new
    {
        t.Id, t.AgentId, t.PolicyId, t.Name, t.Enabled, t.ContinueOnError, t.AlertSeverity, Actions = TaskActions.Parse(t.Actions), t.ScheduleType,
        t.RunAt, t.Time, t.DaysOfWeek, t.DayOfMonth, t.AssignedCheckId, t.EmailAlert, t.WebhookAlert, t.DashboardAlert,
    };

    private static async Task<IResult> AgentTasksAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var policies = (await PolicyResolver.ForAgentAsync(db, id, ct)).ToDictionary(p => p.PolicyId, p => p.Name);
        var tasks = await PolicyResolver.TasksForAgentAsync(db, id, ct);
        var results = await db.TaskResults.AsNoTracking().Where(r => r.AgentId == id).ToDictionaryAsync(r => r.TaskId, ct);
        var settings = await SettingsStore.GetAsync(db, ct);
        var now = DateTimeOffset.UtcNow;
        return TypedResults.Ok(tasks.OrderBy(t => t.Name).Select(t => new
        {
            task = TaskDto(t),
            inherited = t.PolicyId is not null,
            policyName = t.PolicyId is { } pid ? policies.GetValueOrDefault(pid) : null,
            result = results.GetValueOrDefault(t.Id) is { } r ? new { r.Status, r.Retcode, r.Stdout, r.Stderr, r.ExecutionTime, r.LastRun } : null,
            nextRun = t.Enabled ? AgentTaskScheduler.NextRun(t, now, SettingsStore.TimeZone(settings)) : null,
        }).ToList());
    }

    private static async Task<IResult> ListPoliciesAsync(WinCareDbContext db, CancellationToken ct)
    {
        var policies = await db.Policies.AsNoTracking().OrderBy(p => p.Name).ToListAsync(ct);
        var checks = await db.Checks.AsNoTracking().Where(c => c.PolicyId != null).GroupBy(c => c.PolicyId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key!.Value, g => g.Count, ct);
        var tasks = await db.Tasks.AsNoTracking().Where(c => c.PolicyId != null).GroupBy(c => c.PolicyId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key!.Value, g => g.Count, ct);
        var clients = await db.Clients.AsNoTracking().Select(c => new { c.ServerPolicyId, c.WorkstationPolicyId }).ToListAsync(ct);
        var sites = await db.Sites.AsNoTracking().Select(c => new { c.ServerPolicyId, c.WorkstationPolicyId }).ToListAsync(ct);
        var agents = await db.Agents.AsNoTracking().Where(a => a.PolicyId != null).Select(a => a.PolicyId).ToListAsync(ct);
        return TypedResults.Ok(policies.Select(p => new
        {
            p.Id, p.Name, p.Description, p.Enabled,
            checkCount = checks.GetValueOrDefault(p.Id),
            taskCount = tasks.GetValueOrDefault(p.Id),
            appliedTo = new
            {
                clients = clients.Count(c => c.ServerPolicyId == p.Id || c.WorkstationPolicyId == p.Id),
                sites = sites.Count(c => c.ServerPolicyId == p.Id || c.WorkstationPolicyId == p.Id),
                agents = agents.Count(a => a == p.Id),
            },
        }).ToList());
    }

    private static async Task<IResult> GetPolicyAsync(int id, WinCareDbContext db, CancellationToken ct)
    {
        var policy = await db.Policies.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (policy is null)
        {
            return Problems.NotFound("Politica");
        }
        var checks = await db.Checks.AsNoTracking().Where(c => c.PolicyId == id).ToListAsync(ct);
        var tasks = await db.Tasks.AsNoTracking().Where(t => t.PolicyId == id).ToListAsync(ct);
        var patch = await db.PatchPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.PolicyId == id, ct);
        return TypedResults.Ok(new { policy.Id, policy.Name, policy.Description, policy.Enabled, checks, tasks = tasks.Select(TaskDto), patchPolicy = patch });
    }

    private static async Task<IResult> SavePolicyAsync(int? id, SavePolicyRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (await db.Policies.AnyAsync(p => p.Name == r.Name.Trim() && p.Id != id, ct))
        {
            return Problems.Conflict("Ja existe uma politica com esse nome");
        }
        var policy = id is null ? new Policy { Name = r.Name } : await db.Policies.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (policy is null)
        {
            return Problems.NotFound("Politica");
        }
        policy.Name = r.Name.Trim();
        policy.Description = r.Description?.Trim() ?? string.Empty;
        policy.Enabled = r.Enabled;
        if (id is null)
        {
            db.Policies.Add(policy);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "policy.created" : "policy.updated", "policy", Id(policy.Id), $"Politica {policy.Name}", cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/policies/{policy.Id}", policy) : TypedResults.Ok(policy);
    }

    private static async Task<IResult> AssignmentsAsync(WinCareDbContext db, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        return TypedResults.Ok(new
        {
            globalServer = settings.DefaultServerPolicyId,
            globalWorkstation = settings.DefaultWorkstationPolicyId,
            clients = await db.Clients.AsNoTracking().OrderBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, c.ServerPolicyId, c.WorkstationPolicyId, c.BlockPolicyInheritance }).ToListAsync(ct),
            sites = await db.Sites.AsNoTracking().OrderBy(s => s.Name)
                .Select(s => new { s.Id, s.ClientId, s.Name, s.ServerPolicyId, s.WorkstationPolicyId, s.BlockPolicyInheritance }).ToListAsync(ct),
            agents = await db.Agents.AsNoTracking().Where(a => a.PolicyId != null || a.BlockPolicyInheritance)
                .Select(a => new { a.Id, a.Hostname, a.PolicyId, a.BlockPolicyInheritance }).ToListAsync(ct),
        });
    }

    private static async Task<IResult> AssignAsync(AssignmentRequest r, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (r.PolicyId is { } pid && !await db.Policies.AnyAsync(p => p.Id == pid, ct))
        {
            return Problems.BadRequest("Politica nao encontrada");
        }
        var server = r.MonitoringType == MonitoringType.Server;
        if (r.Target != "agent" && !MonitoringType.IsValid(r.MonitoringType))
        {
            return Problems.BadRequest("Informe monitoringType server ou workstation");
        }

        switch (r.Target)
        {
            case "global":
                var settings = await SettingsStore.GetAsync(db, ct);
                if (server)
                {
                    settings.DefaultServerPolicyId = r.PolicyId;
                }
                else
                {
                    settings.DefaultWorkstationPolicyId = r.PolicyId;
                }
                break;
            case "client" when await db.Clients.FirstOrDefaultAsync(c => c.Id == r.TargetId, ct) is { } client:
                if (server)
                {
                    client.ServerPolicyId = r.PolicyId;
                }
                else
                {
                    client.WorkstationPolicyId = r.PolicyId;
                }
                break;
            case "site" when await db.Sites.FirstOrDefaultAsync(s => s.Id == r.TargetId, ct) is { } site:
                if (server)
                {
                    site.ServerPolicyId = r.PolicyId;
                }
                else
                {
                    site.WorkstationPolicyId = r.PolicyId;
                }
                break;
            case "agent" when await db.Agents.FirstOrDefaultAsync(a => a.Id == r.TargetId, ct) is { } agent:
                agent.PolicyId = r.PolicyId;
                break;
            default:
                return Problems.BadRequest("Destino invalido");
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("policy.assigned", r.Target, r.TargetId?.ToString(CultureInfo.InvariantCulture), $"Politica {r.PolicyId?.ToString(CultureInfo.InvariantCulture) ?? "removida"} ({r.MonitoringType})", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
