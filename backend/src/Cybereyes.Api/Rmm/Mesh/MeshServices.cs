using System.Globalization;
using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Mesh;

/// <summary>Estado da integracao, compartilhado entre a sincronizacao e as rotas.</summary>
public sealed class MeshState
{
    public string? GroupId { get; set; }
    public DateTimeOffset? LastSync { get; set; }
    public string? LastError { get; set; }
    public int Users { get; set; }
}

/// <summary>
/// Mantem o MeshCentral alinhado com o Cybereyes: garante o grupo de dispositivos e cria um usuario do MeshCentral para cada
/// tecnico com permissao de acesso remoto (removendo os que perderam a permissao). Roda na partida, a cada 4 minutos e sob demanda.
/// </summary>
public sealed partial class MeshSync(MeshClient mesh, MeshState state, IServiceScopeFactory scopes, TimeProvider time, ILogger<MeshSync> logger) : BackgroundService
{
    public const int DeviceRights = 4 | 8 | 16 | 32 | 64 | 128;

    private readonly Channel<bool> requests = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    public void Request() => requests.Writer.TryWrite(true);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Request();
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(4));
        var tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
        while (!stoppingToken.IsCancellationRequested)
        {
            var read = requests.Reader.WaitToReadAsync(stoppingToken).AsTask();
            if (await Task.WhenAny(read, tick) == tick)
            {
                tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
            }
            requests.Reader.TryRead(out _);
            await SyncAsync(stoppingToken);
        }
    }

    public async Task SyncAsync(CancellationToken ct)
    {
        if (!mesh.Enabled)
        {
            return;
        }
        try
        {
            state.GroupId = await mesh.EnsureDeviceGroupAsync(ct);
            var desired = await DesiredUsersAsync(ct);
            var users = await mesh.SendAsync(new JsonObject { ["action"] = "users" }, ct);
            var existing = (users["users"] as JsonArray ?? []).OfType<JsonObject>()
                .Select(u => u["_id"]?.GetValue<string>() ?? string.Empty)
                .Where(id => id.StartsWith("user//ce-", StringComparison.Ordinal))
                .Select(id => id[6..]).ToHashSet(StringComparer.Ordinal);

            var commands = new List<JsonObject>();
            foreach (var user in desired.Where(u => !existing.Contains(u)))
            {
                commands.Add(new JsonObject { ["action"] = "adduser", ["username"] = user, ["pass"] = "x", ["randomPassword"] = true, ["siteadmin"] = 0 });
            }
            if (desired.Count > 0)
            {
                commands.Add(new JsonObject
                {
                    ["action"] = "addmeshuser", ["meshid"] = state.GroupId, ["usernames"] = new JsonArray(desired.Select(u => (JsonNode)u).ToArray()), ["meshadmin"] = DeviceRights,
                });
            }
            foreach (var user in existing.Where(u => !desired.Contains(u)))
            {
                commands.Add(new JsonObject { ["action"] = "deleteuser", ["userid"] = $"user//{user}" });
            }
            if (commands.Count > 0)
            {
                await mesh.SendAsync(commands, ct);
            }
            state.Users = desired.Count;
            state.LastSync = time.GetUtcNow();
            state.LastError = null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            state.LastError = ex.Message;
            LogSyncFailed(logger, ex);
        }
    }

    private async Task<HashSet<string>> DesiredUsersAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var rows = await (
            from u in db.Users.AsNoTracking()
            where u.IsActive
            join ur in db.UserRoles.AsNoTracking() on u.Id equals ur.UserId
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            select new { u.UserName, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        return rows.Where(r => r.IsSuperuser || r.Permissions.Contains(Permissions.AgentsRemote))
            .Select(r => MeshTokens.MeshUsername(r.UserName!)).ToHashSet(StringComparer.Ordinal);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao sincronizar com o MeshCentral")]
    private static partial void LogSyncFailed(ILogger logger, Exception ex);
}

public static class MeshEndpoints
{
    /// <summary>Pede uma sincronizacao com o MeshCentral depois de alteracoes em usuarios ou papeis.</summary>
    public static RouteHandlerBuilder RequestsMeshSync(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var result = await next(context);
            context.HttpContext.RequestServices.GetService<MeshSync>()?.Request();
            return result;
        });

    public static readonly Dictionary<(string Plat, string Arch), int> Idents = new()
    {
        [("windows", "amd64")] = 4, [("windows", "386")] = 3,
        [("linux", "amd64")] = 6, [("linux", "386")] = 5, [("linux", "arm64")] = 26, [("linux", "arm")] = 25,
        [("darwin", "amd64")] = 10005, [("darwin", "arm64")] = 10005,
    };

    public static void MapMeshEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/agents/{id:int}/remote", RemoteAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsRemote));
        app.MapPost("/api/agents/{id:int}/remote/rdp", RdpAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsRemote));
        app.MapPost("/api/agents/{id:int}/wake", WakeAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsControl));
        app.MapPost("/api/agents/{id:int}/mesh/recover", RecoverAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsControl));
        app.MapGet("/api/mesh/status", (MeshClient mesh, MeshState state, Microsoft.Extensions.Options.IOptions<MeshSettings> options) => TypedResults.Ok(new
        {
            enabled = mesh.Enabled, url = options.Value.Url, deviceGroup = options.Value.DeviceGroup, groupId = state.GroupId,
            lastSync = state.LastSync, lastError = state.LastError, users = state.Users,
        })).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.SettingsManage));
        app.MapPost("/api/mesh/sync", async (MeshSync sync, MeshState state, CancellationToken ct) =>
        {
            await sync.SyncAsync(ct);
            return TypedResults.Ok(new { lastSync = state.LastSync, lastError = state.LastError, users = state.Users });
        }).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.SettingsManage));
    }

    /// <summary>URL de download do MeshAgent ja vinculado ao grupo de dispositivos (formato do MeshCentral).</summary>
    public static string? AgentDownloadUrl(string baseUrl, string? groupId, string plat, string goarch)
    {
        if (groupId is null || !Idents.TryGetValue((plat, goarch), out var ident))
        {
            return null;
        }
        return plat == "windows"
            ? $"{baseUrl}/meshagents?id={ident}&meshid={groupId}&installflags=0"
            : $"{baseUrl}/meshagents?id={groupId}&installflags=2&meshinstall={ident}";
    }

    public static async Task<IResult> DownloadAsync(MeshClient mesh, MeshState state, IHttpClientFactory http, string plat, string goarch, CancellationToken ct)
    {
        if (!mesh.Enabled || state.GroupId is null)
        {
            return Results.Json("Unable to connect to mesh to get group id information", statusCode: StatusCodes.Status400BadRequest);
        }
        if (AgentDownloadUrl(mesh.InternalBaseUrl, state.GroupId, plat, goarch) is not { } url)
        {
            return Results.Json("Arch not supported", statusCode: StatusCodes.Status400BadRequest);
        }
        var client = http.CreateClient("mesh");
        var response = await client.GetAsync(new Uri(url), HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            return Results.Json($"Unable to download mesh agent: HTTP {(int)response.StatusCode}", statusCode: StatusCodes.Status400BadRequest);
        }
        var stream = await response.Content.ReadAsStreamAsync(ct);
        return Results.File(stream, "application/octet-stream", "meshagent");
    }

    private static async Task<IResult> RemoteAsync(int id, ClaimsPrincipal principal, CybereyesDbContext db, MeshClient mesh, IAuditService audit, CancellationToken ct)
    {
        if (!mesh.Enabled)
        {
            return Problems.Create(StatusCodes.Status503ServiceUnavailable, "MeshCentral nao configurado", "MESH_DISABLED");
        }
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id).Select(a => new { a.Hostname, a.MeshNodeId }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (string.IsNullOrWhiteSpace(agent.MeshNodeId))
        {
            return Problems.Conflict("Este agente ainda nao tem o MeshAgent instalado ou sincronizado");
        }

        var token = Uri.EscapeDataString(mesh.LoginToken(MeshTokens.MeshUsername(principal.Identity?.Name ?? string.Empty)));
        var node = Uri.EscapeDataString(MeshTokens.NodeId(agent.MeshNodeId));
        string Link(int view) => $"{mesh.BaseUrl}/?login={token}&gotonode={node}&viewmode={view.ToString(CultureInfo.InvariantCulture)}&hide=31";
        await audit.LogAsync("agent.remote-session", "agent", id.ToString(CultureInfo.InvariantCulture), $"Acesso remoto a {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Ok(new { hostname = agent.Hostname, control = Link(11), terminal = Link(12), files = Link(13) });
    }

    /// <summary>
    /// Acesso grafico por RDP em Linux com sessao Wayland (o MeshAgent so captura X11): o EYES ativa o
    /// compartilhamento RDP do GNOME na sessao do usuario e o tecnico conecta pelo Web-RDP do MeshCentral,
    /// num tunel do MeshAgent ate a porta local. A senha muda a cada pedido.
    /// </summary>
    private static async Task<IResult> RdpAsync(int id, CybereyesDbContext db, MeshClient mesh, Nats.IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        if (!mesh.Enabled)
        {
            return Problems.Create(StatusCodes.Status503ServiceUnavailable, "MeshCentral nao configurado", "MESH_DISABLED");
        }
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id).Select(a => new { a.AgentId, a.Hostname, a.MeshNodeId, a.Plat }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (agent.Plat != "linux")
        {
            return Problems.Validation("plat", "O acesso RDP e usado em Linux; nos demais sistemas use a Tela do acesso remoto");
        }
        if (string.IsNullOrWhiteSpace(agent.MeshNodeId))
        {
            return Problems.Conflict("Este agente ainda nao tem o MeshAgent instalado ou sincronizado");
        }

        object? reply;
        try
        {
            reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "rdp_enable" }, TimeSpan.FromSeconds(85), ct);
        }
        catch (Nats.AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        if (reply is string text)
        {
            return Problems.Validation("agent", text.StartsWith("error: ", StringComparison.Ordinal) ? text[7..] : text);
        }
        if (reply is not IReadOnlyDictionary<string, object?> access || access.GetString("password") is not { Length: > 0 } password)
        {
            return Problems.Validation("agent", "Resposta invalida do agente");
        }
        var port = (int)(access.GetNumber("port") ?? 3389);

        var cookieReply = await mesh.SendAsync(new System.Text.Json.Nodes.JsonObject
        {
            ["action"] = "getcookie", ["nodeid"] = MeshTokens.NodeId(agent.MeshNodeId), ["tcpport"] = port, ["tag"] = "mstsc",
        }, ct);
        if (cookieReply["cookie"]?.GetValue<string>() is not { Length: > 0 } cookie)
        {
            return Problems.Conflict("O MeshCentral nao liberou o tunel RDP para este dispositivo");
        }
        await audit.LogAsync("agent.remote-rdp", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"Acesso RDP a {agent.Hostname} (sessao de {access.GetString("user")})", cancellationToken: ct);
        return TypedResults.Ok(new
        {
            url = $"{mesh.BaseUrl}/mstsc.html?ws={Uri.EscapeDataString(cookie)}",
            username = access.GetString("username") ?? "eyes",
            password,
            port,
            sessionUser = access.GetString("user"),
        });
    }

    private static async Task<IResult> WakeAsync(int id, CybereyesDbContext db, MeshClient mesh, IAuditService audit, CancellationToken ct)
    {
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id).Select(a => new { a.Hostname, a.MeshNodeId }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (!mesh.Enabled || string.IsNullOrWhiteSpace(agent.MeshNodeId))
        {
            return Problems.Conflict("Wake-on-LAN precisa do MeshCentral configurado e do MeshAgent instalado");
        }
        var reply = await mesh.SendAsync(new JsonObject { ["action"] = "wakedevices", ["nodeids"] = new JsonArray(MeshTokens.NodeId(agent.MeshNodeId)) }, ct);
        var result = reply["result"]?.ToString() ?? "ok";
        if (result != "ok")
        {
            return Problems.BadRequest($"MeshCentral recusou o Wake-on-LAN: {result}");
        }
        await audit.LogAsync("agent.wake", "agent", id.ToString(CultureInfo.InvariantCulture), $"Wake-on-LAN enviado para {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Ok(new { result });
    }

    private static async Task<IResult> RecoverAsync(int id, CybereyesDbContext db, IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        try
        {
            await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "recover", ["payload"] = new Dictionary<string, string> { ["mode"] = "mesh" } },
                TimeSpan.FromSeconds(60), ct);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        await audit.LogAsync("agent.mesh-recover", "agent", id.ToString(CultureInfo.InvariantCulture), $"Recuperacao do MeshAgent em {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Accepted((string?)null);
    }
}
