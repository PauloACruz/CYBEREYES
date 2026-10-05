using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Maintenance;

public sealed record StartRunRequest([property: Required, StringLength(64)] string Module, [property: Required] List<string> Tasks, JsonObject? Params);

public sealed record SelfServiceSettings(bool Enabled, List<string> Tasks);

public sealed record SelfServiceRunRequest([property: Required, StringLength(64)] string Module, [property: Required, StringLength(64)] string Key);

/// <summary>Recebe os eventos das execucoes do Cybereyes Care (&lt;agent_id&gt;.cmdoutput.wc-...), uma replica por mensagem.</summary>
public sealed partial class CareEventConsumer(INatsConnection nats, IServiceScopeFactory scopes, ILogger<CareEventConsumer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await foreach (var msg in nats.SubscribeAsync("*.cmdoutput.*", queueGroup: "cybereyes-api",
                                   serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: stoppingToken))
                {
                    var parts = msg.Subject.Split('.');
                    if (parts.Length != 3 || !parts[2].StartsWith(AgentContract.CareRunIdPrefix, StringComparison.Ordinal) || msg.Data is null)
                    {
                        continue;
                    }
                    try
                    {
                        if (MsgPack.Deserialize(msg.Data) is string json)
                        {
                            await using var scope = scopes.CreateAsyncScope();
                            await scope.ServiceProvider.GetRequiredService<CareService>().ApplyEventAsync(parts[0], parts[2], json, stoppingToken);
                        }
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        LogEventFailed(logger, ex, msg.Subject);
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogSubscriptionFailed(logger, ex);
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao processar evento do " + CareModule.CareDisplayName + " em {Subject}")]
    private static partial void LogEventFailed(ILogger logger, Exception ex, string subject);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Assinatura dos eventos do " + CareModule.CareDisplayName + " caiu; tentando de novo")]
    private static partial void LogSubscriptionFailed(ILogger logger, Exception ex);
}

/// <summary>Coleta o Health Check dos agentes online a cada 6 horas e expira execucoes sem resposta.</summary>
public sealed partial class HealthScheduler(IServiceScopeFactory scopes, TimeProvider time, ILogger<HealthScheduler> logger) : BackgroundService
{
    public static readonly Version MinimumAgent = new(2, 12, 0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
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
        var svc = scope.ServiceProvider.GetRequiredService<CareService>();
        await svc.ExpireStaleAsync(null, ct);

        var due = time.GetUtcNow().AddHours(-6);
        var candidates = await (from a in db.Agents.AsNoTracking()
                                where a.Status == AgentStatus.Online
                                join h in db.AgentHealth on a.Id equals h.AgentId into hg
                                from h in hg.DefaultIfEmpty()
                                where h == null || h.CollectedAt < due
                                orderby h == null ? DateTimeOffset.MinValue : h.CollectedAt
                                select new { a.Id, a.Version }).Take(60).ToListAsync(ct);
        foreach (var batch in candidates.Where(c => Supports(c.Version)).Take(20).Chunk(5))
        {
            await Task.WhenAll(batch.Select(async c =>
            {
                await using var inner = scopes.CreateAsyncScope();
                var innerDb = inner.ServiceProvider.GetRequiredService<CybereyesDbContext>();
                if (await AgentRef.FindAsync(innerDb, c.Id, ct) is { } agent)
                {
                    try
                    {
                        await inner.ServiceProvider.GetRequiredService<CareService>().CollectHealthAsync(agent, ct);
                    }
                    catch (AgentRpcTimeoutException)
                    {
                        // Agente ocupado ou fora do ar: tenta na proxima rodada.
                    }
                }
            }));
        }
    }

    public static bool Supports(string? version) => Version.TryParse(version, out var v) && v >= MinimumAgent;

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha na coleta periodica do Health Check")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

public static class CareEndpoints
{
    public static void MapCareEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var run = Policies.Permission(Permissions.CareRun);

        app.MapGet("/api/agents/{id:int}/care/catalog", CatalogAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapPost("/api/agents/{id:int}/care/runs", StartAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(run);
        app.MapGet("/api/agents/{id:int}/care/runs", ListAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapGet("/api/care/runs/{runId}", GetAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapPost("/api/care/runs/{runId}/cancel", CancelAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(run);
        app.MapGet("/api/agents/{id:int}/health", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            await db.AgentHealth.AsNoTracking().Where(h => h.AgentId == id).Select(h => h.Report).FirstOrDefaultAsync(ct) is { } report
                ? Results.Content(report, "application/json")
                : Problems.NotFound("Health Check")).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapPost("/api/agents/{id:int}/health", CollectAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapGet("/api/care/self-service", async (CybereyesDbContext db, CancellationToken ct) =>
        {
            var s = await SettingsStore.GetAsync(db, ct);
            return TypedResults.Ok(new SelfServiceSettings(s.SelfServiceEnabled, s.SelfServiceTasks));
        }).WithTags(CareModule.CareDisplayName).RequireAuthorization(view);
        app.MapPut("/api/care/self-service", SaveSelfServiceAsync).WithTags(CareModule.CareDisplayName).RequireAuthorization(Policies.Permission(Permissions.SettingsManage));

        var tray = app.MapGroup("/api/tray/self-service").WithTags("App de bandeja").RequireAuthorization(Policies.Tray);
        tray.MapGet("/", TrayOptionsAsync);
        tray.MapPost("/run", TrayRunAsync);
        tray.MapGet("/runs/{runId}", TrayRunStatusAsync);
    }

    private static IResult FromStart(StartResult result) => result.Outcome switch
    {
        StartOutcome.Busy => Problems.Create(StatusCodes.Status409Conflict, result.Message!, "AGENT_BUSY"),
        StartOutcome.Timeout => Problems.AgentTimeout(),
        StartOutcome.Rejected => Problems.BadRequest(result.Message ?? "O agente recusou a execucao"),
        _ => TypedResults.Accepted((string?)null),
    };

    private static async Task<IResult> CatalogAsync(int id, CybereyesDbContext db, CareService svc, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        try
        {
            return await svc.CatalogAsync(agent, ct) is { } catalog
                ? Results.Content(catalog.ToJsonString(), "application/json")
                : Problems.BadRequest($"Este agente nao tem os modulos do {CareModule.CareDisplayName} (atualize para a versao 2.12.0 ou superior)");
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static async Task<IResult> StartAsync(int id, StartRunRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CareService svc,
        IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var tasks = r.Tasks.Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToList();
        if (tasks.Count == 0 || tasks.Any(t => t.Length > 64 || t.Contains(',', StringComparison.Ordinal)))
        {
            return Problems.Validation("tasks", "Escolha ao menos uma tarefa valida");
        }
        var result = await svc.StartAsync(agent, r.Module.Trim(), tasks, r.Params, await TicketEndpoints.ActorNameAsync(principal, db, ct), "console", ct);
        if (result.Run is { } created)
        {
            await audit.LogAsync("agent.care-run", "agent", id.ToString(CultureInfo.InvariantCulture),
                $"{CareModule.CareDisplayName} {created.Module} ({string.Join(", ", tasks)}) em {agent.Hostname}: {result.Outcome}", cancellationToken: ct);
        }
        if (result.Outcome != StartOutcome.Started)
        {
            return FromStart(result);
        }
        return TypedResults.Accepted($"/api/care/runs/{result.Run!.RunId}", (await svc.ToDtosAsync([result.Run], ct))[0]);
    }

    private static async Task<IResult> ListAsync(int id, CybereyesDbContext db, CareService svc, CancellationToken ct, int page = 1, int pageSize = 20)
    {
        var size = Math.Clamp(pageSize, 1, 100);
        var p = Math.Max(page, 1);
        var query = db.CareRuns.AsNoTracking().Where(r => r.AgentId == id);
        var total = await query.CountAsync(ct);
        var runs = await query.OrderByDescending(r => r.StartedAt).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        return TypedResults.Ok(new Paged<CareRunDto>(await svc.ToDtosAsync(runs, ct), total, p, size));
    }

    private static async Task<IResult> GetAsync(string runId, CybereyesDbContext db, CareService svc, CancellationToken ct)
    {
        var run = await db.CareRuns.AsNoTracking().FirstOrDefaultAsync(r => r.RunId == runId, ct);
        if (run is null)
        {
            return Problems.NotFound("Execucao");
        }
        var dto = (await svc.ToDtosAsync([run], ct))[0];
        var events = (await db.CareRunEvents.AsNoTracking().Where(e => e.RunId == runId).OrderBy(e => e.Seq).Select(e => e.Data).ToListAsync(ct))
            .Select(d => JsonNode.Parse(d)).ToList();
        return TypedResults.Ok(new
        {
            dto.Id, dto.RunId, dto.AgentId, dto.Hostname, dto.Module, dto.Tasks, dto.Params, dto.Status, dto.Progress, dto.StartedAt, dto.FinishedAt,
            dto.RequestedBy, dto.Source, dto.RebootRequired, dto.Error, dto.TaskStatus, events,
        });
    }

    private static async Task<IResult> CancelAsync(string runId, CybereyesDbContext db, CareService svc, IAuditService audit, CancellationToken ct)
    {
        var run = await db.CareRuns.FirstOrDefaultAsync(r => r.RunId == runId, ct);
        if (run is null)
        {
            return Problems.NotFound("Execucao");
        }
        if (run.Status != CareRunStatus.Running)
        {
            return Problems.Conflict("A execucao ja terminou");
        }
        var agent = await AgentRef.FindAsync(db, run.AgentId, ct);
        await svc.CancelAsync(run, agent?.AgentId ?? string.Empty, ct);
        await audit.LogAsync("agent.care-cancel", "agent", run.AgentId.ToString(CultureInfo.InvariantCulture), $"{CareModule.CareDisplayName} {run.Module} cancelado",
            cancellationToken: ct);
        return TypedResults.Accepted((string?)null);
    }

    private static async Task<IResult> CollectAsync(int id, CybereyesDbContext db, CareService svc, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        try
        {
            return await svc.CollectHealthAsync(agent, ct) is { } report
                ? Results.Content(report.ToJsonString(), "application/json")
                : Problems.BadRequest("Este agente nao tem o Health Check (atualize para a versao 2.12.0 ou superior)");
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static async Task<IResult> SaveSelfServiceAsync(SelfServiceSettings r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var tasks = r.Tasks.Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToList();
        if (tasks.Any(t => t.Length > 130 || t.Split('.').Length != 2))
        {
            return Problems.Validation("tasks", "Use o formato modulo.tarefa");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        settings.SelfServiceEnabled = r.Enabled;
        settings.SelfServiceTasks = tasks;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("care.self-service", "settings", null, $"Autoatendimento {(r.Enabled ? "ativo" : "inativo")}: {string.Join(", ", tasks)}",
            cancellationToken: ct);
        return TypedResults.Ok(new SelfServiceSettings(settings.SelfServiceEnabled, tasks));
    }

    // App de bandeja

    private static async Task<List<(string Module, string Key, string Label, string Description)>> AllowedAsync(AgentRef agent, CybereyesDbContext db,
        CareService svc, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        var result = new List<(string, string, string, string)>();
        if (!settings.SelfServiceEnabled || settings.SelfServiceTasks.Count == 0)
        {
            return result;
        }
        var catalog = await svc.CatalogAsync(agent, ct);
        foreach (var module in catalog?["modules"]?.AsArray() ?? [])
        {
            var moduleKey = CareJson.Str(module?["key"]);
            foreach (var task in module?["tasks"]?.AsArray() ?? [])
            {
                var key = CareJson.Str(task?["key"]);
                if (moduleKey is null || key is null || task?["selfService"]?.GetValueKind() != JsonValueKind.True ||
                    !settings.SelfServiceTasks.Contains($"{moduleKey}.{key}"))
                {
                    continue;
                }
                result.Add((moduleKey, key, CareJson.Str(task["label"]) ?? key, CareJson.Str(task["description"]) ?? string.Empty));
            }
        }
        return result;
    }

    private static async Task<IResult> TrayOptionsAsync(ClaimsPrincipal principal, CybereyesDbContext db, CareService svc, CancellationToken ct)
    {
        var session = Tray.Session(principal)!;
        var agent = await AgentRef.FindAsync(db, session.AgentId, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        try
        {
            var tasks = await AllowedAsync(agent, db, svc, ct);
            return TypedResults.Ok(new
            {
                enabled = settings.SelfServiceEnabled && tasks.Count > 0,
                tasks = tasks.Select(t => new { module = t.Module, key = t.Key, label = t.Label, description = t.Description }),
            });
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static async Task<IResult> TrayRunAsync(SelfServiceRunRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CareService svc, IAuditService audit,
        CancellationToken ct)
    {
        var session = Tray.Session(principal)!;
        var agent = await AgentRef.FindAsync(db, session.AgentId, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        List<(string Module, string Key, string Label, string Description)> allowed;
        try
        {
            allowed = await AllowedAsync(agent, db, svc, ct);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        if (!allowed.Any(t => t.Module == r.Module && t.Key == r.Key))
        {
            return Problems.Forbidden("Esta acao nao esta liberada para o autoatendimento");
        }
        var result = await svc.StartAsync(agent, r.Module, [r.Key], null, $"tray:{session.Username}", "tray", ct);
        await audit.LogAsync("agent.self-service", "agent", agent.Id.ToString(CultureInfo.InvariantCulture),
            $"Autoatendimento {r.Module}.{r.Key} por {session.Username} em {agent.Hostname}: {result.Outcome}", username: $"tray:{session.Username}",
            cancellationToken: ct);
        return result.Outcome == StartOutcome.Started
            ? TypedResults.Accepted($"/api/tray/self-service/runs/{result.Run!.RunId}", new { runId = result.Run.RunId })
            : FromStart(result);
    }

    private static async Task<IResult> TrayRunStatusAsync(string runId, ClaimsPrincipal principal, CybereyesDbContext db, CareService svc, CancellationToken ct)
    {
        var session = Tray.Session(principal)!;
        var run = await db.CareRuns.AsNoTracking()
            .FirstOrDefaultAsync(r => r.RunId == runId && r.AgentId == session.AgentId && r.RequestedBy == $"tray:{session.Username}", ct);
        if (run is null)
        {
            return Problems.NotFound("Execucao");
        }
        var dto = (await svc.ToDtosAsync([run], ct))[0];
        var messages = (await db.CareRunEvents.AsNoTracking().Where(e => e.RunId == runId && e.Type == "log").OrderBy(e => e.Seq).Select(e => e.Data)
                .Take(200).ToListAsync(ct))
            .Select(d => CareJson.Str(JsonNode.Parse(d)?["message"])).OfType<string>().ToList();
        return TypedResults.Ok(new { runId, dto.Status, dto.Progress, label = $"{run.Module}.{string.Join(", ", run.Tasks)}", messages });
    }
}
