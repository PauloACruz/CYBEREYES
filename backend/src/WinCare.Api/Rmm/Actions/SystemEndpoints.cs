using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm.Actions;

public sealed record ServiceActionRequest(string Action);
public sealed record StartTypeRequest(string StartType);
public sealed record RegistryPathRequest(string Path);
public sealed record RegistryRenameKeyRequest(string OldPath, string NewPath);
public sealed record RegistryValueRequest(string Path, string Name, string Type, string? Data);
public sealed record RegistryRenameValueRequest(string Path, string OldName, string NewName);

/// <summary>Processos, servicos, Event Log, registro, energia e inventario: cada rota chama um comando NATS do agente.</summary>
public static partial class SystemEndpoints
{
    private static readonly TimeSpan Short = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan Long = TimeSpan.FromSeconds(60);
    private static readonly string[] RestartSteps = ["stop", "start"];
    private static readonly HashSet<string> EventLogs = new(StringComparer.Ordinal) { "Application", "System", "Security" };
    private static readonly HashSet<string> StartTypes = new(StringComparer.Ordinal) { "auto", "autodelay", "manual", "disabled" };
    private static readonly HashSet<string> RegistryTypes = new(StringComparer.Ordinal)
        { "REG_SZ", "REG_EXPAND_SZ", "REG_MULTI_SZ", "REG_DWORD", "REG_QWORD", "REG_BINARY" };

    [GeneratedRegex(@"^[A-Za-z0-9_.\- ]{1,256}$")]
    private static partial Regex ServiceName();

    public static void MapSystemEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var control = Policies.Permission(Permissions.AgentsControl);
        var g = app.MapGroup("/api/agents/{id:int}").WithTags("Acoes no agente");

        g.MapGet("/processes", ProcessesAsync).RequireAuthorization(view);
        g.MapDelete("/processes/{pid:int}", KillProcessAsync).RequireAuthorization(control);

        g.MapGet("/services", ServicesAsync).RequireAuthorization(view);
        g.MapGet("/services/{name}", ServiceDetailAsync).RequireAuthorization(view);
        g.MapPost("/services/{name}/action", ServiceActionAsync).RequireAuthorization(control);
        g.MapPut("/services/{name}/start-type", StartTypeAsync).RequireAuthorization(control);

        g.MapGet("/eventlog/{logName}", EventLogAsync).RequireAuthorization(view);

        g.MapGet("/registry", RegistryBrowseAsync).RequireAuthorization(view);
        g.MapPost("/registry/keys", (int id, RegistryPathRequest r, Deps d, CancellationToken ct) =>
            RegistryWriteAsync(id, d, "registry_create_key", new() { ["path"] = r.Path }, $"criou a chave {r.Path}", ct)).RequireAuthorization(control);
        g.MapDelete("/registry/keys", (int id, [FromQuery] string path, Deps d, CancellationToken ct) =>
            RegistryWriteAsync(id, d, "registry_delete_key", new() { ["path"] = path }, $"excluiu a chave {path}", ct)).RequireAuthorization(control);
        g.MapPut("/registry/keys/rename", (int id, RegistryRenameKeyRequest r, Deps d, CancellationToken ct) =>
            RegistryWriteAsync(id, d, "registry_rename_key", new() { ["old_path"] = r.OldPath, ["new_path"] = r.NewPath },
                $"renomeou a chave {r.OldPath} para {r.NewPath}", ct)).RequireAuthorization(control);
        g.MapPost("/registry/values", (int id, RegistryValueRequest r, Deps d, CancellationToken ct) =>
            RegistryValueAsync(id, d, "registry_create_value", r, ct)).RequireAuthorization(control);
        g.MapPut("/registry/values", (int id, RegistryValueRequest r, Deps d, CancellationToken ct) =>
            RegistryValueAsync(id, d, "registry_modify_value", r, ct)).RequireAuthorization(control);
        g.MapPut("/registry/values/rename", (int id, RegistryRenameValueRequest r, Deps d, CancellationToken ct) =>
            RegistryWriteAsync(id, d, "registry_rename_value", new() { ["path"] = r.Path, ["old_name"] = r.OldName, ["new_name"] = r.NewName },
                $"renomeou o valor {r.Path}\\{r.OldName} para {r.NewName}", ct)).RequireAuthorization(control);
        g.MapDelete("/registry/values", (int id, [FromQuery] string path, [FromQuery] string name, Deps d, CancellationToken ct) =>
            RegistryWriteAsync(id, d, "registry_delete_value", new() { ["path"] = path, ["name"] = name }, $"excluiu o valor {path}\\{name}", ct))
            .RequireAuthorization(control);

        g.MapPost("/reboot", (int id, Deps d, CancellationToken ct) => PowerAsync(id, d, "rebootnow", "reiniciou", ct)).RequireAuthorization(control);
        g.MapPost("/shutdown", (int id, Deps d, CancellationToken ct) => PowerAsync(id, d, "shutdown", "desligou", ct)).RequireAuthorization(control);
        g.MapPost("/refresh", RefreshAsync).RequireAuthorization(view);
    }

    /// <summary>Dependencias comuns das rotas, injetadas de uma vez.</summary>
    public sealed class Deps(WinCareDbContext db, IAgentRpc rpc, IAuditService audit)
    {
        public WinCareDbContext Db { get; } = db;
        public IAgentRpc Rpc { get; } = rpc;
        public IAuditService Audit { get; } = audit;
    }

    private static async Task<IResult> WithAgentAsync(int id, Deps d, bool windowsOnly, Func<AgentRef, Task<IResult>> action, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(d.Db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (windowsOnly && !agent.IsWindows)
        {
            return Problems.BadRequest("Recurso disponivel somente para agentes Windows");
        }
        try
        {
            return await action(agent);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static Dictionary<string, object?> Message(string func, Dictionary<string, string>? payload = null, Dictionary<string, object?>? extra = null)
    {
        var message = new Dictionary<string, object?> { ["func"] = func };
        if (payload is not null)
        {
            message["payload"] = payload;
        }
        foreach (var (key, value) in extra ?? [])
        {
            message[key] = value;
        }
        return message;
    }

    private static IEnumerable<IReadOnlyDictionary<string, object?>> Items(object? reply) =>
        (reply as IEnumerable<object?> ?? []).OfType<IReadOnlyDictionary<string, object?>>();

    private static Task<IResult> ProcessesAsync(int id, Deps d, CancellationToken ct) => WithAgentAsync(id, d, false, async agent =>
    {
        var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("procs"), Short, ct);
        return TypedResults.Ok(Items(reply).Select(p => new
        {
            pid = (int)(p.GetNumber("pid") ?? 0),
            name = p.GetString("name") ?? string.Empty,
            username = p.GetString("username") ?? string.Empty,
            memBytes = (long)(p.GetNumber("membytes") ?? 0),
            cpuPercent = p.GetString("cpu_percent") ?? string.Empty,
        }).ToList());
    }, ct);

    private static Task<IResult> KillProcessAsync(int id, int pid, Deps d, CancellationToken ct) => WithAgentAsync(id, d, false, async agent =>
    {
        var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("killproc", extra: new() { ["procpid"] = pid }), Short, ct) as string;
        await d.Audit.LogAsync("agent.process-killed", "agent", Id(id), $"{agent.Hostname}: encerrou o processo {pid}", cancellationToken: ct);
        return reply == "ok" ? TypedResults.NoContent() : Problems.BadRequest(reply ?? "Falha ao encerrar o processo");
    }, ct);

    private static object ServiceDto(IReadOnlyDictionary<string, object?> s) => new
    {
        name = s.GetString("name") ?? string.Empty,
        displayName = s.GetString("display_name") ?? string.Empty,
        status = s.GetString("status") ?? string.Empty,
        startType = s.GetString("start_type") ?? string.Empty,
        autodelay = s.GetBool("autodelay"),
        pid = (long)(s.GetNumber("pid") ?? 0),
        binpath = s.GetString("binpath") ?? string.Empty,
        username = s.GetString("username") ?? string.Empty,
        description = s.GetString("description") ?? string.Empty,
    };

    private static Task<IResult> ServicesAsync(int id, Deps d, CancellationToken ct) => WithAgentAsync(id, d, true, async agent =>
        TypedResults.Ok(Items(await d.Rpc.RequestAsync(agent.AgentId, Message("winservices"), Short, ct)).Select(ServiceDto).ToList()), ct);

    private static Task<IResult> ServiceDetailAsync(int id, string name, Deps d, CancellationToken ct) => WithAgentAsync(id, d, true, async agent =>
    {
        if (!ServiceName().IsMatch(name))
        {
            return Problems.BadRequest("Nome de servico invalido");
        }
        var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("winsvcdetail", new() { ["name"] = name }), Short, ct);
        return reply is IReadOnlyDictionary<string, object?> map ? TypedResults.Ok(ServiceDto(map)) : Problems.NotFound("Servico");
    }, ct);

    private static Task<IResult> ServiceActionAsync(int id, string name, ServiceActionRequest request, Deps d, CancellationToken ct) =>
        WithAgentAsync(id, d, true, async agent =>
        {
            if (!ServiceName().IsMatch(name) || request.Action is not ("start" or "stop" or "restart"))
            {
                return Problems.BadRequest("Servico ou acao invalida");
            }

            var steps = request.Action == "restart" ? RestartSteps : [request.Action];
            (bool Success, string Message) result = (true, "ok");
            foreach (var step in steps)
            {
                var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("winsvcaction", new() { ["name"] = name, ["action"] = step }), Long, ct);
                result = SvcResult(reply);
                if (!result.Success)
                {
                    break;
                }
            }
            await d.Audit.LogAsync("agent.service-action", "agent", Id(id), $"{agent.Hostname}: {request.Action} no servico {name}", cancellationToken: ct);
            return TypedResults.Ok(new { success = result.Success, message = result.Message });
        }, ct);

    private static Task<IResult> StartTypeAsync(int id, string name, StartTypeRequest request, Deps d, CancellationToken ct) =>
        WithAgentAsync(id, d, true, async agent =>
        {
            if (!ServiceName().IsMatch(name) || !StartTypes.Contains(request.StartType))
            {
                return Problems.BadRequest("Servico ou tipo de inicializacao invalido");
            }
            var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("editwinsvc", new() { ["name"] = name, ["startType"] = request.StartType }), Short, ct);
            var (success, message) = SvcResult(reply);
            await d.Audit.LogAsync("agent.service-start-type", "agent", Id(id), $"{agent.Hostname}: servico {name} para {request.StartType}", cancellationToken: ct);
            return TypedResults.Ok(new { success, message });
        }, ct);

    private static (bool Success, string Message) SvcResult(object? reply) =>
        reply is IReadOnlyDictionary<string, object?> map
            ? (map.GetBool("success"), map.GetString("errormsg") is { Length: > 0 } err ? err : "ok")
            : (false, "Resposta inesperada do agente");

    private static Task<IResult> EventLogAsync(int id, string logName, int? days, Deps d, CancellationToken ct) =>
        WithAgentAsync(id, d, true, async agent =>
        {
            var range = Math.Clamp(days ?? 1, 1, 30);
            if (!EventLogs.Contains(logName))
            {
                return Problems.BadRequest("Log invalido: use Application, System ou Security");
            }
            var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("eventlog",
                new() { ["logname"] = logName, ["days"] = range.ToString(CultureInfo.InvariantCulture) },
                new() { ["timeout"] = 90 }), TimeSpan.FromSeconds(92), ct);
            return TypedResults.Ok(Items(reply).Select(e => new
            {
                source = e.GetString("source") ?? string.Empty,
                eventType = e.GetString("eventType") ?? string.Empty,
                eventId = (long)(e.GetNumber("eventID") ?? 0),
                message = e.GetString("message") ?? string.Empty,
                time = e.GetString("time") ?? string.Empty,
            }).ToList());
        }, ct);

    private static Task<IResult> RegistryBrowseAsync(int id, string? path, int? page, Deps d, CancellationToken ct) =>
        WithAgentAsync(id, d, true, async agent =>
        {
            var reply = await d.Rpc.RequestAsync(agent.AgentId, Message("registry_browse", new()
            {
                ["path"] = string.IsNullOrWhiteSpace(path) ? "computer" : path,
                ["page"] = Math.Max(page ?? 1, 1).ToString(CultureInfo.InvariantCulture),
                ["page_size"] = "200",
            }), Short, ct);
            if (reply is not IReadOnlyDictionary<string, object?> map)
            {
                return Problems.BadRequest("Resposta inesperada do agente");
            }
            if (map.GetString("error") is { } error)
            {
                return Problems.BadRequest(error);
            }
            return TypedResults.Ok(new
            {
                path = map.GetString("path") ?? path ?? string.Empty,
                subkeys = Items(map.GetValueOrDefault("subkeys")).Select(k => new { name = k.GetString("name") ?? string.Empty, hasSubkeys = k.GetBool("hasSubkeys") }).ToList(),
                values = Items(map.GetValueOrDefault("values")).Select(v => new { name = v.GetString("name") ?? string.Empty, type = v.GetString("type") ?? string.Empty, data = v.GetValueOrDefault("data") }).ToList(),
                hasMore = map.GetBool("has_more"),
            });
        }, ct);

    private static Task<IResult> RegistryValueAsync(int id, Deps d, string func, RegistryValueRequest r, CancellationToken ct)
    {
        if (!RegistryTypes.Contains(r.Type))
        {
            return Task.FromResult(Problems.BadRequest("Tipo de valor invalido"));
        }
        return RegistryWriteAsync(id, d, func, new() { ["path"] = r.Path, ["name"] = r.Name, ["type"] = r.Type, ["data"] = r.Data ?? string.Empty },
            $"gravou o valor {r.Path}\\{r.Name} ({r.Type})", ct);
    }

    private static Task<IResult> RegistryWriteAsync(int id, Deps d, string func, Dictionary<string, string> payload, string description, CancellationToken ct) =>
        WithAgentAsync(id, d, true, async agent =>
        {
            if (payload.Values.Any(string.IsNullOrWhiteSpace) && func != "registry_create_value" && func != "registry_modify_value")
            {
                return Problems.BadRequest("Informe todos os campos");
            }
            var reply = await d.Rpc.RequestAsync(agent.AgentId, Message(func, payload), Short, ct);
            if (reply is IReadOnlyDictionary<string, object?> map && map.GetString("error") is { } error)
            {
                return Problems.BadRequest(error);
            }
            await d.Audit.LogAsync("agent.registry", "agent", Id(id), $"{agent.Hostname}: {description}", cancellationToken: ct);
            return TypedResults.Ok(new { success = true });
        }, ct);

    private static Task<IResult> PowerAsync(int id, Deps d, string func, string verb, CancellationToken ct) => WithAgentAsync(id, d, false, async agent =>
    {
        await d.Rpc.RequestAsync(agent.AgentId, Message(func), Short, ct);
        await d.Audit.LogAsync($"agent.{func}", "agent", Id(id), $"{verb} {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Accepted((string?)null);
    }, ct);

    private static Task<IResult> RefreshAsync(int id, Deps d, CancellationToken ct) => WithAgentAsync(id, d, false, async agent =>
    {
        await d.Rpc.RequestAsync(agent.AgentId, Message("sysinfo"), Short, ct);
        return TypedResults.Accepted((string?)null);
    }, ct);

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
