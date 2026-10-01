using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm;

/// <summary>
/// Rotas chamadas pelo agente Go (contrato herdado do Tactical RMM em /api/v3 e /api/v4).
/// Respostas de sucesso sao a string JSON "ok"; erros de negocio sao HTTP 400 com a mensagem em string JSON.
/// </summary>
public static class AgentProtocolEndpoints
{
    private static readonly IResult Ok = Results.Json("ok");

    public static void MapAgentProtocolEndpoints(this IEndpointRouteBuilder app)
    {
        var installer = app.MapGroup("/api/v3").RequireAuthorization(Policies.Installer).ExcludeFromDescription();
        installer.MapGet("/installer/", () => Ok);
        installer.MapPost("/installer/", CheckInstallerVersion);
        installer.MapPost("/newagent/", NewAgentAsync);
        installer.MapPost("/meshexe/", () => Error("Arch not supported"));

        var agent = app.MapGroup("/api/v3").RequireAuthorization(Policies.Agent).ExcludeFromDescription();
        agent.MapGet("/{agentId}/config/", Config);
        agent.MapGet("/{agentId}/checkinterval/", CheckIntervalAsync);
        agent.MapGet("/{agentId}/checkrunner/", ChecksAsync);
        agent.MapGet("/{agentId}/runchecks/", ChecksAsync);
        agent.MapPatch("/checkrunner/", () => Ok);
        agent.MapPost("/checkin/", () => Ok);
        agent.MapPost("/syncmesh/", SyncMeshAsync);
        agent.MapPost("/choco/", ChocoAsync);
        agent.MapPost("/software/", SoftwareAsync);
        agent.MapPut("/winupdates/", () => Ok);
        agent.MapPatch("/winupdates/", () => Ok);
        agent.MapPost("/winupdates/", () => Ok);
        agent.MapPost("/superseded/", () => Ok);
        agent.MapGet("/{pk:int}/{agentId}/taskrunner/", () => Results.Json(new { detail = "Not found." }, statusCode: StatusCodes.Status404NotFound));
        agent.MapPatch("/{pk:int}/{agentId}/taskrunner/", () => Ok);
        agent.MapPatch("/{pk:int}/{agentId}/histresult/", () => Ok);
        agent.MapGet("/{agentId}/meshreinstall/", () => Error("MeshCentral ainda nao configurado"));
        app.MapPatch("/api/v4/{agentId}/{pk:int}/chocoresult/", () => Ok).RequireAuthorization(Policies.Agent).ExcludeFromDescription();
    }

    private static IResult Error(string message) => Results.Json(message, statusCode: StatusCodes.Status400BadRequest);

    private static IResult CheckInstallerVersion(JsonElement body, IOptions<AgentSettings> settings)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("version", out var v) || v.GetString() is not { } version)
        {
            return Error("Invalid data");
        }

        var latest = settings.Value.LatestVersion;
        if (Version.TryParse(version, out var parsed) && Version.TryParse(latest, out var expected) && parsed < expected)
        {
            return Error($"Old installer detected (version {version} ). Latest version is {latest} Please generate a new installer from the RMM");
        }
        return Ok;
    }

    private static async Task<IResult> NewAgentAsync(JsonElement body, ClaimsPrincipal principal, WinCareDbContext db,
        NatsAuthSync natsAuth, IAgentNotifier notifier, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var agentId = Text(body, "agent_id");
        var hostname = Text(body, "hostname");
        var siteText = Text(body, "site");
        if (string.IsNullOrWhiteSpace(agentId) || agentId.Length > 200 || string.IsNullOrWhiteSpace(hostname) ||
            !int.TryParse(siteText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var siteId))
        {
            return Error("Invalid data");
        }
        if (!await db.Sites.AnyAsync(s => s.Id == siteId, ct))
        {
            return Error("Site not found");
        }
        if (await db.Agents.AnyAsync(a => a.AgentId == agentId, ct))
        {
            return Error("Agent already exists. Remove old agent first if trying to re-install");
        }

        var monitoringType = Text(body, "monitoring_type");
        var token = AgentSecrets.NewAgentToken();
        var agent = new Agent
        {
            AgentId = agentId,
            Hostname = Truncate(hostname, 255) ?? hostname,
            SiteId = siteId,
            MonitoringType = MonitoringType.IsValid(monitoringType) ? monitoringType! : MonitoringType.Server,
            Description = Truncate(Text(body, "description"), 255),
            MeshNodeId = Truncate(Text(body, "mesh_node_id"), 255),
            GoArch = Truncate(Text(body, "goarch"), 32),
            Plat = Truncate(Text(body, "plat"), 32) ?? "windows",
            LastSeen = time.GetUtcNow(),
            Status = AgentStatus.Online,
            TokenHash = AgentSecrets.Hash(token),
            NatsPasswordHash = AgentSecrets.NatsPasswordHash(token),
        };
        db.Agents.Add(agent);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Error("Agent already exists. Remove old agent first if trying to re-install");
        }

        natsAuth.Request();
        await audit.LogAsync("agent.installed", "agent", agent.Id.ToString(CultureInfo.InvariantCulture),
            $"{principal.Identity?.Name} instalou o agente {agent.Hostname}", principal.Identity?.Name, ct);
        await notifier.AgentsChangedAsync(ct);
        return Results.Json(new { pk = agent.Id, token });
    }

    private static IResult Config()
    {
        static int Between(int min, int max) => Random.Shared.Next(min, max + 1);
        return Results.Json(new Dictionary<string, object>
        {
            ["checkin_hello"] = Between(30, 60),
            ["checkin_agentinfo"] = Between(200, 400),
            ["checkin_winsvc"] = Between(2400, 3000),
            ["checkin_pubip"] = Between(300, 500),
            ["checkin_disks"] = Between(1000, 2000),
            ["checkin_sw"] = Between(2800, 3500),
            ["checkin_wmi"] = Between(3000, 4000),
            ["checkin_syncmesh"] = Between(800, 1200),
            ["limit_data"] = false,
            ["install_nushell"] = false,
            ["install_nushell_version"] = string.Empty,
            ["install_nushell_url"] = string.Empty,
            ["nushell_enable_config"] = false,
            ["install_deno"] = false,
            ["install_deno_version"] = string.Empty,
            ["install_deno_url"] = string.Empty,
            ["deno_default_permissions"] = string.Empty,
        });
    }

    private static async Task<IResult> CheckIntervalAsync(ClaimsPrincipal principal, WinCareDbContext db, CancellationToken ct)
    {
        var agent = await CurrentAsync(principal, db, ct);
        return agent is null
            ? Results.NotFound()
            : Results.Json(new { agent = agent.Id, check_interval = agent.CheckInterval + Random.Shared.Next(1, 61) });
    }

    private static async Task<IResult> ChecksAsync(ClaimsPrincipal principal, WinCareDbContext db, CancellationToken ct)
    {
        var agent = await CurrentAsync(principal, db, ct);
        return agent is null
            ? Results.NotFound()
            : Results.Json(new { agent = agent.Id, check_interval = agent.CheckInterval + Random.Shared.Next(1, 61), checks = Array.Empty<object>() });
    }

    private static async Task<IResult> SyncMeshAsync(JsonElement body, ClaimsPrincipal principal, WinCareDbContext db, CancellationToken ct)
    {
        var nodeId = Truncate(Text(body, "nodeid"), 255);
        var pk = AgentPk(principal);
        await db.Agents.Where(a => a.Id == pk && a.MeshNodeId != nodeId).ExecuteUpdateAsync(s => s.SetProperty(a => a.MeshNodeId, nodeId), ct);
        return Ok;
    }

    private static async Task<IResult> ChocoAsync(JsonElement body, ClaimsPrincipal principal, WinCareDbContext db, CancellationToken ct)
    {
        var installed = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("installed", out var v) && v.ValueKind == JsonValueKind.True;
        var pk = AgentPk(principal);
        await db.Agents.Where(a => a.Id == pk).ExecuteUpdateAsync(s => s.SetProperty(a => a.ChocoInstalled, installed), ct);
        return Ok;
    }

    private static async Task<IResult> SoftwareAsync(JsonElement body, ClaimsPrincipal principal, WinCareDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("software", out var software) || software.ValueKind != JsonValueKind.Array)
        {
            return Error("Invalid data");
        }

        var pk = AgentPk(principal);
        var row = await db.AgentSoftware.FirstOrDefaultAsync(s => s.AgentId == pk, ct);
        if (row is null)
        {
            db.AgentSoftware.Add(new AgentSoftware { AgentId = pk, Software = software.GetRawText(), UpdatedAt = time.GetUtcNow() });
        }
        else
        {
            row.Software = software.GetRawText();
            row.UpdatedAt = time.GetUtcNow();
        }
        await db.SaveChangesAsync(ct);
        return Ok;
    }

    private static int AgentPk(ClaimsPrincipal principal) =>
        int.Parse(principal.FindFirstValue(WinCareClaims.AgentPk)!, CultureInfo.InvariantCulture);

    private static Task<Agent?> CurrentAsync(ClaimsPrincipal principal, WinCareDbContext db, CancellationToken ct)
    {
        var pk = AgentPk(principal);
        return db.Agents.AsNoTracking().FirstOrDefaultAsync(a => a.Id == pk, ct);
    }

    private static string? Text(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                _ => null,
            }
            : null;

    private static string? Truncate(string? value, int max) => value is null || value.Length <= max ? value : value[..max];
}
