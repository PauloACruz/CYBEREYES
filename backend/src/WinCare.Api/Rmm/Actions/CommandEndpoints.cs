using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Endpoints;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm.Actions;

public sealed record CommandRequest(
    [property: Required, StringLength(32)] string Shell,
    [property: Required, StringLength(20000)] string Command,
    [property: Range(10, 3600)] int Timeout,
    bool RunAsUser);

public sealed record RunScriptRequest(int ScriptId, IReadOnlyList<string>? Args, IReadOnlyList<string>? EnvVars,
    [property: Range(5, 86400)] int? Timeout, bool? RunAsUser);

public sealed record ScriptResultDto(string Stdout, string Stderr, int Retcode, double ExecutionTime);

public sealed record AgentHistoryDto(long Id, DateTimeOffset Time, string Type, string Command, string Username, int? ScriptId,
    string? ScriptName, string? Results, ScriptResultDto? ScriptResults);

public static class CommandEndpoints
{
    public static readonly IReadOnlySet<string> WindowsShells = new HashSet<string>(StringComparer.Ordinal) { "cmd", "powershell" };
    public static readonly IReadOnlySet<string> UnixShells = new HashSet<string>(StringComparer.Ordinal) { "/bin/bash", "/bin/sh", "/bin/zsh" };

    public static void MapCommandEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/agents/{id:int}").WithTags("Acoes no agente");
        group.MapGet("/history", HistoryAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        group.MapPost("/command", CommandAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsRun));
        group.MapPost("/runscript", RunScriptAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsRun));
    }

    private static async Task<IResult> HistoryAsync(int id, WinCareDbContext db, int? page, int? pageSize, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize);
        var query = db.AgentHistory.AsNoTracking().Where(h => h.AgentId == id);
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(h => h.Time).ThenByDescending(h => h.Id).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        return TypedResults.Ok(new Paged<AgentHistoryDto>(rows.Select(ToDto).ToList(), total, p, size));
    }

    private static async Task<IResult> CommandAsync(int id, CommandRequest request, ClaimsPrincipal principal, WinCareDbContext db,
        IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var shells = agent.IsWindows ? WindowsShells : UnixShells;
        if (!shells.Contains(request.Shell))
        {
            return Problems.Validation("shell", $"Shell invalido para {agent.Plat}: use {string.Join(", ", shells)}");
        }

        var history = new AgentHistory
        {
            AgentId = id,
            Type = AgentHistoryType.CommandRun,
            Command = request.Command,
            Username = principal.Identity?.Name ?? "?",
        };
        db.AgentHistory.Add(history);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("agent.command", "agent", Id(id), $"{agent.Hostname} ({request.Shell}): {Truncate(request.Command, 500)}", cancellationToken: ct);

        try
        {
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = "rawcmd",
                ["timeout"] = request.Timeout,
                ["payload"] = new Dictionary<string, string> { ["command"] = request.Command, ["shell"] = request.Shell },
                ["run_as_user"] = request.RunAsUser && agent.IsWindows,
                ["id"] = (int)history.Id,
            }, TimeSpan.FromSeconds(request.Timeout + 2), ct);

            var output = reply as string ?? string.Empty;
            history.Results = output;
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new { historyId = history.Id, output });
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static async Task<IResult> RunScriptAsync(int id, RunScriptRequest request, ClaimsPrincipal principal, WinCareDbContext db,
        IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var script = await db.Scripts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.ScriptId, ct);
        if (script is null)
        {
            return Problems.Validation("scriptId", "Script nao encontrado");
        }
        if (script.Platforms.Count > 0 && !script.Platforms.Contains(agent.Plat))
        {
            return Problems.Validation("scriptId", $"O script nao e compativel com {agent.Plat}");
        }

        var resolve = await Variables.ResolverAsync(db, agent, urlEncode: false, ct);
        var args = (request.Args ?? script.DefaultArgs).Select(resolve).ToList();
        var envVars = (request.EnvVars ?? script.EnvVars).Select(resolve).ToList();
        var timeout = request.Timeout ?? script.DefaultTimeout;
        var code = await Variables.ExpandSnippetsAsync(db, script.Body, ct);

        var history = new AgentHistory
        {
            AgentId = id,
            Type = AgentHistoryType.ScriptRun,
            Command = string.Join(' ', args),
            Username = principal.Identity?.Name ?? "?",
            ScriptId = script.Id,
            ScriptName = script.Name,
        };
        db.AgentHistory.Add(history);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("agent.script", "agent", Id(id), $"{agent.Hostname}: script {script.Name}", cancellationToken: ct);

        try
        {
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = "runscriptfull",
                ["timeout"] = timeout,
                ["script_args"] = args,
                ["payload"] = new Dictionary<string, string> { ["code"] = code, ["shell"] = script.Shell },
                ["run_as_user"] = (request.RunAsUser ?? script.RunAsUser) && agent.IsWindows,
                ["env_vars"] = envVars,
                ["nushell_enable_config"] = false,
                ["deno_default_permissions"] = string.Empty,
                ["id"] = (int)history.Id,
            }, TimeSpan.FromSeconds(timeout + 5), ct);

            var result = ParseScriptResult(reply);
            history.ScriptResults = JsonSerializer.Serialize(result);
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new { historyId = history.Id, result.Stdout, result.Stderr, result.Retcode, result.ExecutionTime });
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    public static ScriptResultDto ParseScriptResult(object? reply)
    {
        if (reply is not IReadOnlyDictionary<string, object?> map)
        {
            return new ScriptResultDto(string.Empty, reply as string ?? string.Empty, 1, 0);
        }
        return new ScriptResultDto(map.GetString("stdout") ?? string.Empty, map.GetString("stderr") ?? string.Empty,
            (int)(map.GetNumber("retcode") ?? 1), map.GetNumber("execution_time") ?? 0);
    }

    private static AgentHistoryDto ToDto(AgentHistory h) => new(h.Id, h.Time, h.Type, h.Command, h.Username, h.ScriptId, h.ScriptName,
        h.Results, h.ScriptResults is null ? null : JsonSerializer.Deserialize<ScriptResultDto>(h.ScriptResults));

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max] + "...";
}
