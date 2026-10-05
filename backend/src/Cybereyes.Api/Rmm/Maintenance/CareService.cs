using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Rmm.Maintenance;

public sealed record CareRunDto(
    long Id, string RunId, int AgentId, string Hostname, string Module, IReadOnlyList<string> Tasks, JsonElement Params, string Status, int Progress,
    DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, string RequestedBy, string Source, bool RebootRequired, string? Error,
    IReadOnlyDictionary<string, string> TaskStatus);

public enum StartOutcome { Started, Busy, Rejected, Timeout }

public sealed record StartResult(StartOutcome Outcome, CareRun? Run, string? Message);

/// <summary>Inicia, acompanha e encerra execucoes de modulos do Cybereyes Care nos agentes.</summary>
public sealed class CareService(CybereyesDbContext db, IAgentRpc rpc, IHubContext<ConsoleHub> console, IHubContext<TrayHub> tray, TimeProvider time)
{
    public const int MaxEventsPerRun = 5000;
    public static readonly TimeSpan CatalogTimeout = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan HealthTimeout = TimeSpan.FromMinutes(6);

    public static string ConsoleGroup(string runId) => $"care:{runId}";

    public static TimeSpan RunLimit(string module) => module == "windows_update" ? TimeSpan.FromHours(4) : TimeSpan.FromHours(2);

    public async Task<JsonNode?> CatalogAsync(AgentRef agent, CancellationToken ct)
    {
        var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = AgentContract.CareCatalogFunc, ["payload"] = new Dictionary<string, string>() },
            CatalogTimeout, ct);
        var text = reply as string;
        if (string.IsNullOrWhiteSpace(text) || text.StartsWith("error", StringComparison.Ordinal))
        {
            return null;
        }
        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<StartResult> StartAsync(AgentRef agent, string module, IReadOnlyList<string> tasks, JsonObject? parameters, string requestedBy, string source,
        CancellationToken ct)
    {
        await ExpireStaleAsync(agent.Id, ct);
        if (await db.CareRuns.AnyAsync(r => r.AgentId == agent.Id && r.Status == CareRunStatus.Running, ct))
        {
            return new StartResult(StartOutcome.Busy, null, "Ja existe uma execucao em andamento nesta maquina");
        }

        var run = new CareRun
        {
            RunId = AgentContract.CareRunIdPrefix + Guid.NewGuid().ToString("N"),
            AgentId = agent.Id,
            Module = module,
            Tasks = tasks.ToList(),
            Params = (parameters ?? []).ToJsonString(),
            RequestedBy = requestedBy,
            Source = source,
            StartedAt = time.GetUtcNow(),
        };
        db.CareRuns.Add(run);
        await db.SaveChangesAsync(ct);

        string? reply;
        try
        {
            reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = AgentContract.CareRunFunc,
                ["payload"] = new Dictionary<string, string>
                {
                    ["run_id"] = run.RunId, ["module"] = module, ["tasks"] = string.Join(',', tasks), ["params"] = run.Params,
                },
            }, TimeSpan.FromSeconds(30), ct) as string;
        }
        catch (AgentRpcTimeoutException)
        {
            await FinishAsync(run, CareRunStatus.Error, false, "O agente nao respondeu", ct);
            return new StartResult(StartOutcome.Timeout, run, "O agente nao respondeu");
        }

        if (reply == "started")
        {
            await NotifyRunAsync(run, ct);
            return new StartResult(StartOutcome.Started, run, null);
        }
        var message = reply?.StartsWith("error: ", StringComparison.Ordinal) == true ? reply[7..] : reply ?? "resposta vazia";
        if (message == "busy")
        {
            db.CareRuns.Remove(run);
            await db.SaveChangesAsync(ct);
            return new StartResult(StartOutcome.Busy, null, "Ja existe uma execucao em andamento nesta maquina");
        }
        await FinishAsync(run, CareRunStatus.Error, false, message, ct);
        return new StartResult(StartOutcome.Rejected, run, message);
    }

    public async Task<bool> CancelAsync(CareRun run, string agentId, CancellationToken ct)
    {
        try
        {
            var reply = await rpc.RequestAsync(agentId, new Dictionary<string, object?>
            {
                ["func"] = AgentContract.CareCancelFunc, ["payload"] = new Dictionary<string, string> { ["run_id"] = run.RunId },
            }, TimeSpan.FromSeconds(30), ct) as string;
            if (reply == "ok")
            {
                return true;
            }
        }
        catch (AgentRpcTimeoutException)
        {
            // Agente fora do ar: encerra a execucao no servidor.
        }
        await FinishAsync(run, CareRunStatus.Cancelled, false, "Cancelado sem resposta do agente", ct);
        return true;
    }

    /// <summary>Processa um evento publicado pelo agente em &lt;agent_id&gt;.cmdoutput.&lt;run_id&gt;.</summary>
    public async Task ApplyEventAsync(string agentId, string runId, string json, CancellationToken ct)
    {
        JsonObject? evt;
        try
        {
            evt = JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException)
        {
            return;
        }
        var seq = evt?["seq"]?.GetValueKind() == JsonValueKind.Number ? evt["seq"]!.GetValue<int>() : 0;
        var type = evt?["type"]?.GetValueKind() == JsonValueKind.String ? evt["type"]!.GetValue<string>() : null;
        if (evt is null || seq <= 0 || type is null)
        {
            return;
        }

        var run = await (from r in db.CareRuns
                         join a in db.Agents on r.AgentId equals a.Id
                         where r.RunId == runId && a.AgentId == agentId
                         select r).FirstOrDefaultAsync(ct);
        if (run is null || (CareRunStatus.Final.Contains(run.Status) && type != "done") || seq > MaxEventsPerRun + 10)
        {
            return;
        }

        db.CareRunEvents.Add(new CareRunEvent { RunId = runId, Seq = seq, Type = type, Data = evt.ToJsonString(), ReceivedAt = time.GetUtcNow() });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return;
        }

        await console.Clients.Group(ConsoleGroup(runId)).SendAsync("careEvent", runId, evt, ct);
        if (type == "done" && run.Status == CareRunStatus.Running)
        {
            var status = evt["status"]?.GetValue<string>() ?? CareRunStatus.Error;
            if (!CareRunStatus.Final.Contains(status))
            {
                status = CareRunStatus.Error;
            }
            await FinishAsync(run, status, evt["rebootRequired"]?.GetValueKind() == JsonValueKind.True, null, ct);
        }
        else if (run.Source == "tray" && type is "progress" or "task")
        {
            await NotifyTrayAsync(run, ct);
        }
    }

    public async Task FinishAsync(CareRun run, string status, bool reboot, string? error, CancellationToken ct)
    {
        run.Status = status;
        run.RebootRequired = reboot;
        run.Error = error is { Length: > 2000 } ? error[..2000] : error;
        run.FinishedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await NotifyRunAsync(run, ct);
    }

    /// <summary>Execucoes que passaram do tempo limite do modulo (mais 10 minutos de folga) viram "timeout".</summary>
    public async Task ExpireStaleAsync(int? agentId, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var running = await db.CareRuns.Where(r => r.Status == CareRunStatus.Running && (agentId == null || r.AgentId == agentId)).ToListAsync(ct);
        foreach (var run in running.Where(r => now - r.StartedAt > RunLimit(r.Module) + TimeSpan.FromMinutes(10)))
        {
            await FinishAsync(run, CareRunStatus.Timeout, false, "Sem resposta do agente dentro do tempo limite", ct);
        }
    }

    public async Task NotifyRunAsync(CareRun run, CancellationToken ct)
    {
        var dto = (await ToDtosAsync([run], ct))[0];
        await console.Clients.All.SendAsync("careRunChanged", dto, ct);
        if (run.Source == "tray")
        {
            await NotifyTrayAsync(run, ct);
        }
    }

    private async Task NotifyTrayAsync(CareRun run, CancellationToken ct)
    {
        var requester = run.RequestedBy.StartsWith("tray:", StringComparison.Ordinal) ? run.RequestedBy[5..] : null;
        if (requester is null)
        {
            return;
        }
        var dto = (await ToDtosAsync([run], ct))[0];
        var lastLog = await db.CareRunEvents.AsNoTracking().Where(e => e.RunId == run.RunId && e.Type == "log").OrderByDescending(e => e.Seq)
            .Select(e => e.Data).FirstOrDefaultAsync(ct);
        string? message = null;
        if (lastLog is not null && JsonNode.Parse(lastLog)?["message"]?.GetValue<string>() is { } m)
        {
            message = m;
        }
        await tray.Clients.Group(TicketService.TrayGroup(run.AgentId, requester))
            .SendAsync(AgentContract.TraySelfServiceChangedEvent, new { runId = run.RunId, status = dto.Status, progress = dto.Progress, message }, ct);
    }

    public async Task<IReadOnlyList<CareRunDto>> ToDtosAsync(IReadOnlyList<CareRun> runs, CancellationToken ct)
    {
        var agentIds = runs.Select(r => r.AgentId).Distinct().ToList();
        var hostnames = await db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.Hostname, ct);
        var runIds = runs.Select(r => r.RunId).ToList();
        var events = (await db.CareRunEvents.AsNoTracking().Where(e => runIds.Contains(e.RunId) && (e.Type == "progress" || e.Type == "task"))
            .OrderBy(e => e.Seq).Select(e => new { e.RunId, e.Data }).ToListAsync(ct)).ToLookup(e => e.RunId, e => e.Data);

        return runs.Select(run =>
        {
            var progress = 0;
            var tasks = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var data in events[run.RunId])
            {
                var node = JsonNode.Parse(data);
                if (node?["type"]?.GetValue<string>() == "progress" && node["value"]?.GetValueKind() == JsonValueKind.Number)
                {
                    progress = Math.Max(progress, Math.Clamp((int)node["value"]!.GetValue<double>(), 0, 100));
                }
                else if (node?["key"]?.GetValue<string>() is { } key && node["status"]?.GetValue<string>() is { } st)
                {
                    tasks[key] = st;
                }
            }
            if (run.Status != CareRunStatus.Running && run.Status != CareRunStatus.Error && run.Status != CareRunStatus.Cancelled &&
                run.Status != CareRunStatus.Timeout)
            {
                progress = 100;
            }
            using var parameters = JsonDocument.Parse(run.Params);
            return new CareRunDto(run.Id, run.RunId, run.AgentId, hostnames.GetValueOrDefault(run.AgentId, "?"), run.Module, run.Tasks,
                parameters.RootElement.Clone(), run.Status, progress, run.StartedAt, run.FinishedAt, run.RequestedBy, run.Source, run.RebootRequired, run.Error, tasks);
        }).ToList();
    }

    public async Task<JsonNode?> CollectHealthAsync(AgentRef agent, CancellationToken ct)
    {
        var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = AgentContract.CareHealthFunc, ["payload"] = new Dictionary<string, string>() },
            HealthTimeout, ct) as string;
        if (string.IsNullOrWhiteSpace(reply) || reply.StartsWith("error", StringComparison.Ordinal))
        {
            return null;
        }
        JsonNode? report;
        try
        {
            report = JsonNode.Parse(reply);
        }
        catch (JsonException)
        {
            return null;
        }
        if (report?["score"]?.GetValueKind() != JsonValueKind.Number)
        {
            return null;
        }

        var score = Math.Clamp(report["score"]!.GetValue<int>(), 0, 100);
        var grade = report["grade"]?.GetValue<string>() ?? "critico";
        var collected = DateTimeOffset.TryParse(report["collectedAt"]?.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
            ? at
            : time.GetUtcNow();
        var row = await db.AgentHealth.FirstOrDefaultAsync(h => h.AgentId == agent.Id, ct);
        if (row is null)
        {
            db.AgentHealth.Add(new AgentHealth { AgentId = agent.Id, Score = score, Grade = grade[..Math.Min(grade.Length, 16)], Report = reply, CollectedAt = collected });
        }
        else
        {
            row.Score = score;
            row.Grade = grade[..Math.Min(grade.Length, 16)];
            row.Report = reply;
            row.CollectedAt = collected;
        }
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
        }
        return report;
    }
}
