using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Monitoring;

/// <summary>Rotas /api/v3 de checks, tarefas, Windows Update e Chocolatey, no formato que o agente Go espera.</summary>
public static class MonitoringProtocol
{
    private static readonly IResult Ok = Results.Json("ok");
    private static readonly HashSet<string> WindowsOnlyChecks = new(StringComparer.Ordinal) { CheckTypes.WinSvc, CheckTypes.EventLog };

    private static int AgentPk(ClaimsPrincipal principal) => int.Parse(principal.FindFirstValue(CybereyesClaims.AgentPk)!, CultureInfo.InvariantCulture);

    public static async Task<IResult> ChecksAsync(bool all, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var agent = await AgentRef.FindAsync(db, pk, ct);
        var interval = await db.Agents.Where(a => a.Id == pk).Select(a => a.CheckInterval).FirstAsync(ct);
        var checks = (await PolicyResolver.ChecksForAgentAsync(db, pk, ct))
            .Where(c => agent!.IsWindows || !WindowsOnlyChecks.Contains(c.CheckType)).ToList();

        var now = time.GetUtcNow();
        if (!all)
        {
            var lastRuns = await db.CheckResults.AsNoTracking().Where(r => r.AgentId == pk)
                .ToDictionaryAsync(r => r.CheckId, r => r.LastRun, ct);
            checks = checks.Where(c => lastRuns.GetValueOrDefault(c.Id) is not { } last ||
                last < now.AddSeconds(-(c.RunInterval > 0 ? c.RunInterval : interval))).ToList();
        }

        var scriptIds = checks.Where(c => c.ScriptId is not null).Select(c => c.ScriptId!.Value).Distinct().ToList();
        var scripts = await db.Scripts.AsNoTracking().Where(s => scriptIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var resolve = await Variables.ResolverAsync(db, agent!, urlEncode: false, ct);

        var payload = new List<Dictionary<string, object?>>();
        foreach (var c in checks)
        {
            object? script = null;
            if (c.CheckType == CheckTypes.Script && c.ScriptId is { } sid && scripts.TryGetValue(sid, out var s))
            {
                script = new Dictionary<string, object?>
                {
                    ["code"] = await Variables.ExpandSnippetsAsync(db, s.Body, ct),
                    ["shell"] = s.Shell,
                    ["run_as_user"] = s.RunAsUser && agent!.IsWindows,
                    ["env_vars"] = s.EnvVars.Select(resolve).ToList(),
                    ["script_hash"] = string.Empty,
                };
            }
            payload.Add(new Dictionary<string, object?>
            {
                ["id"] = c.Id,
                ["agent"] = c.AgentId,
                ["check_type"] = c.CheckType,
                ["run_interval"] = c.RunInterval,
                ["alert_severity"] = c.AlertSeverity,
                ["error_threshold"] = c.ErrorThreshold,
                ["warning_threshold"] = c.WarningThreshold,
                ["disk"] = c.Disk,
                ["ip"] = c.Ip,
                ["script"] = script,
                ["script_args"] = c.ScriptArgs.Select(resolve).ToList(),
                ["env_vars"] = c.EnvVars.Select(resolve).ToList(),
                ["info_return_codes"] = c.InfoReturnCodes,
                ["warning_return_codes"] = c.WarningReturnCodes,
                ["success_return_codes"] = c.SuccessReturnCodes,
                ["timeout"] = c.Timeout ?? 60,
                ["svc_name"] = c.SvcName,
                ["pass_if_start_pending"] = c.PassIfStartPending,
                ["pass_if_svc_not_exist"] = c.PassIfSvcNotExist,
                ["restart_if_stopped"] = c.RestartIfStopped,
                ["log_name"] = c.LogName,
                ["event_id"] = c.EventId ?? 0,
                ["event_id_is_wildcard"] = c.EventIdIsWildcard,
                ["event_type"] = c.EventType,
                ["event_source"] = c.EventSource ?? string.Empty,
                ["event_message"] = c.EventMessage ?? string.Empty,
                ["fail_when"] = c.FailWhen,
                ["search_last_days"] = c.SearchLastDays,
                ["number_of_events_b4_alert"] = c.NumberOfEventsBeforeAlert,
                ["managed_by_policy"] = c.PolicyId is not null,
            });
        }

        var minInterval = checks.Where(c => c.RunInterval > 0 && c.RunInterval < interval).Select(c => Math.Max(c.RunInterval, 15)).DefaultIfEmpty(interval).Min();
        return Results.Json(new { agent = pk, check_interval = minInterval + Random.Shared.Next(1, 61), checks = payload });
    }

    public static async Task<IResult> CheckIntervalAsync(ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var interval = await db.Agents.Where(a => a.Id == pk).Select(a => a.CheckInterval).FirstAsync(ct);
        var checks = await PolicyResolver.ChecksForAgentAsync(db, pk, ct);
        var min = checks.Where(c => c.RunInterval > 0 && c.RunInterval < interval).Select(c => Math.Max(c.RunInterval, 15)).DefaultIfEmpty(interval).Min();
        return Results.Json(new { agent = pk, check_interval = min + Random.Shared.Next(1, 61) });
    }

    public static async Task<IResult> CheckResultAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, AlertService alerts,
        IAgentRpc rpc, TimeProvider time, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("agent_id", out _))
        {
            return Results.Json("Agent upgrade required", statusCode: StatusCodes.Status400BadRequest);
        }
        if (!body.TryGetProperty("id", out var idProp) || !idProp.TryGetInt32(out var checkId))
        {
            return Results.Json("Invalid data", statusCode: StatusCodes.Status400BadRequest);
        }

        var pk = AgentPk(principal);
        var check = (await PolicyResolver.ChecksForAgentAsync(db, pk, ct)).FirstOrDefault(c => c.Id == checkId);
        if (check is null)
        {
            return Results.Json(new { detail = "Not found." }, statusCode: StatusCodes.Status404NotFound);
        }

        var result = await db.CheckResults.FirstOrDefaultAsync(r => r.AgentId == pk && r.CheckId == checkId, ct);
        if (result is null)
        {
            result = new CheckResult { AgentId = pk, CheckId = checkId };
            db.CheckResults.Add(result);
        }

        var now = time.GetUtcNow();
        var outcome = CheckEvaluator.Apply(check, result, body, now);
        if (outcome.HistoryValue is not null || outcome.HistoryResults is not null)
        {
            db.CheckHistory.Add(new CheckHistory { CheckId = checkId, AgentId = pk, Time = now, Value = outcome.HistoryValue ?? 0, Status = result.Status, Results = outcome.HistoryResults });
        }
        await db.SaveChangesAsync(ct);

        var agent = await AgentRef.FindAsync(db, pk, ct);
        var label = string.IsNullOrWhiteSpace(check.Name) ? check.CheckType : check.Name;
        if (result.Status == CheckStatus.Failing)
        {
            if (result.FailCount >= check.FailsBeforeAlert)
            {
                await alerts.RaiseAsync(new AlertRequest(pk, AlertTypes.Check, checkId, null, result.AlertSeverity ?? check.AlertSeverity,
                    $"{agent!.Hostname}: check {label} falhando. {result.MoreInfo}", check.EmailAlert, check.WebhookAlert, check.DashboardAlert), ct);
            }

            var tasks = (await PolicyResolver.TasksForAgentAsync(db, pk, ct))
                .Where(t => t.Enabled && t.ScheduleType == TaskSchedules.CheckFailure && t.AssignedCheckId == checkId);
            foreach (var task in tasks)
            {
                await rpc.PublishAsync(agent!.AgentId, new Dictionary<string, object?> { ["func"] = "runtask", ["taskpk"] = task.Id }, ct);
            }
        }
        else if (result.Status == CheckStatus.Passing)
        {
            await alerts.ResolveAsync(pk, AlertTypes.Check, checkId, null, ct);
        }
        return Ok;
    }

    public static async Task<IResult> TaskGetAsync(int pk, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var agentPk = AgentPk(principal);
        var task = (await PolicyResolver.TasksForAgentAsync(db, agentPk, ct)).FirstOrDefault(t => t.Id == pk);
        if (task is null)
        {
            return Results.Json(string.Empty, statusCode: StatusCodes.Status400BadRequest);
        }

        var agent = await AgentRef.FindAsync(db, agentPk, ct);
        var resolve = await Variables.ResolverAsync(db, agent!, urlEncode: false, ct);
        var actions = new List<Dictionary<string, object?>>();
        foreach (var action in TaskActions.Parse(task.Actions))
        {
            if (action.Type == "cmd")
            {
                actions.Add(new() { ["type"] = "cmd", ["command"] = resolve(action.Command ?? string.Empty), ["shell"] = action.Shell, ["timeout"] = action.Timeout });
            }
            else if (action.ScriptId is { } sid && await db.Scripts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sid, ct) is { } script)
            {
                actions.Add(new()
                {
                    ["type"] = "script",
                    ["script_name"] = script.Name,
                    ["code"] = await Variables.ExpandSnippetsAsync(db, script.Body, ct),
                    ["script_args"] = (action.Args ?? script.DefaultArgs).Select(resolve).ToList(),
                    ["shell"] = script.Shell,
                    ["timeout"] = action.Timeout,
                    ["run_as_user"] = action.RunAsUser && agent!.IsWindows,
                    ["env_vars"] = (action.EnvVars ?? script.EnvVars).Select(resolve).ToList(),
                    ["nushell_enable_config"] = false,
                    ["deno_default_permissions"] = string.Empty,
                });
            }
        }
        return Results.Json(new { id = task.Id, continue_on_error = task.ContinueOnError, enabled = task.Enabled, task_actions = actions });
    }

    public static async Task<IResult> TaskResultAsync(int pk, JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, AlertService alerts,
        TimeProvider time, CancellationToken ct)
    {
        var agentPk = AgentPk(principal);
        var task = (await PolicyResolver.TasksForAgentAsync(db, agentPk, ct)).FirstOrDefault(t => t.Id == pk);
        if (task is null || body.ValueKind != JsonValueKind.Object)
        {
            return Ok;
        }

        var result = await db.TaskResults.FirstOrDefaultAsync(r => r.AgentId == agentPk && r.TaskId == pk, ct);
        if (result is null)
        {
            result = new TaskResult { AgentId = agentPk, TaskId = pk };
            db.TaskResults.Add(result);
        }
        result.Stdout = body.TryGetProperty("stdout", out var o) ? AgentJson.AsText(o) : null;
        result.Stderr = body.TryGetProperty("stderr", out var e) ? AgentJson.AsText(e) : null;
        result.Retcode = body.TryGetProperty("retcode", out var r) && r.TryGetInt64(out var rc) ? rc : 1;
        result.ExecutionTime = body.TryGetProperty("execution_time", out var t) && t.TryGetDouble(out var et) ? et : 0;
        result.LastRun = time.GetUtcNow();
        result.Status = result.Retcode == 0 ? CheckStatus.Passing : CheckStatus.Failing;
        db.AgentHistory.Add(new AgentHistory
        {
            AgentId = agentPk,
            Type = AgentHistoryType.TaskRun,
            Command = task.Name,
            Username = "sistema",
            ScriptResults = JsonSerializer.Serialize(new ScriptResultDto(result.Stdout ?? string.Empty, result.Stderr ?? string.Empty,
                (int)(result.Retcode ?? 1), result.ExecutionTime ?? 0)),
        });
        await db.SaveChangesAsync(ct);

        if (result.Status == CheckStatus.Failing)
        {
            var agent = await AgentRef.FindAsync(db, agentPk, ct);
            await alerts.RaiseAsync(new AlertRequest(agentPk, AlertTypes.Task, null, pk, task.AlertSeverity,
                $"{agent!.Hostname}: tarefa {task.Name} terminou com codigo {result.Retcode}", task.EmailAlert, task.WebhookAlert, task.DashboardAlert), ct);
        }
        else
        {
            await alerts.ResolveAsync(agentPk, AlertTypes.Task, null, pk, ct);
        }
        return Ok;
    }

    public static async Task<IResult> CheckinAsync(ClaimsPrincipal principal, CybereyesDbContext db, IAgentRpc rpc, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == pk).Select(a => new { a.AgentId, a.Plat, a.ChocoInstalled }).FirstAsync(ct);
        if (agent.Plat == "windows")
        {
            if (!agent.ChocoInstalled)
            {
                await rpc.PublishAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "installchoco" }, ct);
            }
            await rpc.PublishAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "getwinupdates" }, ct);
        }
        return Ok;
    }

    public static async Task<IResult> WinUpdatesPostAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        // Lista vazia e valida: a maquina nao tem mais atualizacoes pendentes e as antigas sao removidas.
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("wua_updates", out var list) || list.ValueKind != JsonValueKind.Array)
        {
            return Results.Json("Empty payload", statusCode: StatusCodes.Status400BadRequest);
        }

        var pk = AgentPk(principal);
        var existing = await db.WinUpdates.Where(u => u.AgentId == pk).ToDictionaryAsync(u => u.UpdateGuid, ct);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in list.EnumerateArray())
        {
            var guid = Str(item, "guid");
            if (string.IsNullOrEmpty(guid) || !seen.Add(guid))
            {
                continue;
            }
            if (!existing.TryGetValue(guid, out var update))
            {
                var kbs = Strings(item, "kb_article_ids");
                if (kbs.Count == 0)
                {
                    continue;
                }
                update = new WinUpdate { AgentId = pk, UpdateGuid = guid, Kb = "KB" + kbs[0], KbArticleIds = kbs };
                db.WinUpdates.Add(update);
            }
            update.Title = Str(item, "title");
            update.Description = Str(item, "description");
            update.Severity = Str(item, "severity");
            update.Categories = Strings(item, "categories");
            update.MoreInfoUrls = Strings(item, "more_info_urls");
            update.SupportUrl = Str(item, "support_url");
            update.RevisionNumber = item.TryGetProperty("revision_number", out var rev) && rev.TryGetInt64(out var rn) ? rn : 0;
            update.Installed = item.TryGetProperty("installed", out var i) && i.ValueKind == JsonValueKind.True;
            update.Downloaded = item.TryGetProperty("downloaded", out var d) && d.ValueKind == JsonValueKind.True;
        }
        db.WinUpdates.RemoveRange(existing.Values.Where(u => !u.Installed && !seen.Contains(u.UpdateGuid)));
        await db.SaveChangesAsync(ct);
        return Ok;
    }

    public static async Task<IResult> WinUpdatesPatchAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var guid = body.ValueKind == JsonValueKind.Object ? Str(body, "guid") : string.Empty;
        var update = await db.WinUpdates.Where(u => u.AgentId == pk && u.UpdateGuid == guid).OrderByDescending(u => u.Id).FirstOrDefaultAsync(ct);
        if (update is not null)
        {
            var success = body.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.True;
            update.Result = success ? "success" : "failed";
            if (success)
            {
                update.Downloaded = true;
                update.Installed = true;
                update.DateInstalled = time.GetUtcNow();
            }
            await db.SaveChangesAsync(ct);
        }
        return Ok;
    }

    public static async Task<IResult> WinUpdatesPutAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, IAgentRpc rpc, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var needsReboot = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("needs_reboot", out var n) && n.ValueKind == JsonValueKind.True;
        await db.Agents.Where(a => a.Id == pk).ExecuteUpdateAsync(s => s.SetProperty(a => a.NeedsReboot, needsReboot), ct);

        var policy = await PatchPolicies.EffectiveAsync(db, pk, ct);
        if (policy.RebootAfterInstall == "always" || (policy.RebootAfterInstall == "required" && needsReboot))
        {
            var agentId = await db.Agents.Where(a => a.Id == pk).Select(a => a.AgentId).FirstAsync(ct);
            await rpc.PublishAsync(agentId, new Dictionary<string, object?> { ["func"] = "rebootnow" }, ct);
        }
        return Ok;
    }

    public static async Task<IResult> SupersededAsync(JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        var guid = body.ValueKind == JsonValueKind.Object ? Str(body, "guid") : string.Empty;
        await db.WinUpdates.Where(u => u.AgentId == pk && u.UpdateGuid == guid).ExecuteDeleteAsync(ct);
        return Ok;
    }

    public static async Task<IResult> ChocoResultAsync(long pk, JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var agentPk = AgentPk(principal);
        var action = await db.PendingActions.FirstOrDefaultAsync(p => p.Id == pk && p.AgentId == agentPk, ct);
        if (action is not null)
        {
            action.Output = body.ValueKind == JsonValueKind.Object ? Str(body, "results") : string.Empty;
            // O agente comeca o texto com "error:" quando a instalacao falhou (contrato, secao 3.8).
            action.Status = action.Output.StartsWith("error", StringComparison.OrdinalIgnoreCase) ? "failed" : "completed";
            await db.SaveChangesAsync(ct);
        }
        return Ok;
    }

    private static string Str(JsonElement item, string name) =>
        item.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;

    private static List<string> Strings(JsonElement item, string name) =>
        item.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() ?? string.Empty : x.GetRawText()).ToList()
            : [];
}

public sealed record TaskAction(string Type, string? Command, string? Shell, int Timeout, int? ScriptId, List<string>? Args, List<string>? EnvVars, bool RunAsUser);

public static class TaskActions
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static List<TaskAction> Parse(string json) => JsonSerializer.Deserialize<List<TaskAction>>(json, Options) ?? [];

    public static string Serialize(IEnumerable<TaskAction> actions) => JsonSerializer.Serialize(actions, Options);
}

public static class PatchPolicies
{
    public static async Task<PatchPolicy> EffectiveAsync(CybereyesDbContext db, int agentId, CancellationToken ct)
    {
        var own = await db.PatchPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.AgentId == agentId, ct);
        if (own is not null)
        {
            return own;
        }
        foreach (var policy in await PolicyResolver.ForAgentAsync(db, agentId, ct))
        {
            if (await db.PatchPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.PolicyId == policy.PolicyId, ct) is { } found)
            {
                return found;
            }
        }
        return new PatchPolicy();
    }

}
