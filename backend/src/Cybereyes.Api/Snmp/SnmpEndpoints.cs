using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Snmp;

public sealed record SnmpV3Credentials(
    [property: Required, StringLength(200, MinimumLength = 1)] string Username,
    [property: Required] string SecurityLevel,
    string? AuthProtocol,
    [property: StringLength(200)] string? AuthPassword,
    string? PrivProtocol,
    [property: StringLength(200)] string? PrivPassword);

public sealed record SaveSnmpDevice(
    [property: Range(1, int.MaxValue)] int ClientId,
    int? SiteId,
    [property: Range(1, int.MaxValue)] int CollectorAgentId,
    int? AssetId,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required, StringLength(255, MinimumLength = 1)] string Host,
    [property: Range(1, 65535)] int Port,
    [property: Required] string Version,
    [property: StringLength(200)] string? Community,
    SnmpV3Credentials? V3,
    [property: Range(60, 3600)] int Interval,
    [property: Range(1, 60)] int Timeout,
    [property: Range(0, 5)] int Retries,
    bool PollInterfaces,
    bool Enabled,
    [property: Required] string TrapSeverity,
    int? Id = null);

public sealed record SaveSnmpSensor(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required, StringLength(255, MinimumLength = 3)] string Oid,
    [property: StringLength(32)] string? Unit,
    double? WarnAbove, double? CritAbove, double? WarnBelow, double? CritBelow);

public sealed record MonitoredRequest(bool Monitored);

public sealed record CollectorRequest(bool Enabled);

public static partial class SnmpEndpoints
{
    private static readonly HashSet<string> TrapSeverities = new(StringComparer.Ordinal) { "none", Severity.Info, Severity.Warning, Severity.Error };
    private static readonly HashSet<string> SecurityLevels = new(StringComparer.Ordinal) { "noAuthNoPriv", "authNoPriv", "authPriv" };
    private static readonly HashSet<string> AuthProtocols = new(StringComparer.Ordinal) { "SHA", "SHA256", "SHA512", "MD5" };
    private static readonly HashSet<string> PrivProtocols = new(StringComparer.Ordinal) { "AES", "AES256", "DES" };
    public const int MaxPoints = 1000;

    [GeneratedRegex(@"^\.?[0-9]+(\.[0-9]+){1,127}$")]
    private static partial Regex OidPattern();

    [GeneratedRegex(@"^[A-Za-z0-9.\-:\[\]]+$")]
    private static partial Regex HostPattern();

    [GeneratedRegex(@"^(rtt|if:[0-9]+:(in|out)|sensor:[0-9]+)$")]
    private static partial Regex MetricPattern();

    private static int AgentPk(ClaimsPrincipal principal) => int.Parse(principal.FindFirstValue(CybereyesClaims.AgentPk)!, CultureInfo.InvariantCulture);

    public static void MapSnmpEndpoints(this IEndpointRouteBuilder app)
    {
        var agent = app.MapGroup("/api/v3").RequireAuthorization(Policies.Agent).ExcludeFromDescription();
        agent.MapGet("/{agentId}/snmp/", async (ClaimsPrincipal p, SnmpService svc, CancellationToken ct) => Results.Json(await svc.CollectorConfigAsync(AgentPk(p), ct)));
        agent.MapPost("/snmp/results/", async (JsonElement body, ClaimsPrincipal p, SnmpService svc, CancellationToken ct) =>
        {
            if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array ||
                results.GetArrayLength() > 1000)
            {
                return Results.Json("Invalid data", statusCode: StatusCodes.Status400BadRequest);
            }
            await svc.ApplyResultsAsync(AgentPk(p), results, ct);
            return Results.Json("ok");
        });
        agent.MapPost("/snmp/traps/", async (JsonElement body, ClaimsPrincipal p, SnmpService svc, CancellationToken ct) =>
        {
            if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("traps", out var traps) || traps.ValueKind != JsonValueKind.Array ||
                traps.GetArrayLength() > 1000)
            {
                return Results.Json("Invalid data", statusCode: StatusCodes.Status400BadRequest);
            }
            await svc.ApplyTrapsAsync(AgentPk(p), traps, ct);
            return Results.Json("ok");
        });

        var view = Policies.Permission(Permissions.SnmpView);
        var manage = Policies.Permission(Permissions.SnmpManage);
        var g = app.MapGroup("/api/snmp").WithTags("SNMP");
        g.MapGet("/devices", async (int? clientId, string? status, CybereyesDbContext db, SnmpService svc, CancellationToken ct) =>
        {
            var query = db.SnmpDevices.AsNoTracking();
            if (clientId is { } c)
            {
                query = query.Where(d => d.ClientId == c);
            }
            if (!string.IsNullOrWhiteSpace(status))
            {
                query = query.Where(d => d.Status == status);
            }
            return TypedResults.Ok(await svc.Dtos(query.OrderBy(d => d.Name)).ToListAsync(ct));
        }).RequireAuthorization(view);
        g.MapGet("/devices/{id:int}", DetailAsync).RequireAuthorization(view);
        g.MapPost("/devices", (SaveSnmpDevice r, CybereyesDbContext db, Vault vault, SnmpService svc, IAuditService audit, CancellationToken ct) =>
            SaveAsync(null, r, db, vault, svc, audit, ct)).RequireAuthorization(manage);
        g.MapPut("/devices/{id:int}", (int id, SaveSnmpDevice r, CybereyesDbContext db, Vault vault, SnmpService svc, IAuditService audit, CancellationToken ct) =>
            SaveAsync(id, r, db, vault, svc, audit, ct)).RequireAuthorization(manage);
        g.MapDelete("/devices/{id:int}", DeleteAsync).RequireAuthorization(manage);
        g.MapPost("/devices/test", TestAsync).RequireAuthorization(manage);
        g.MapPut("/devices/{id:int}/interfaces/{index:int}", SetMonitoredAsync).RequireAuthorization(manage);
        g.MapPost("/devices/{id:int}/sensors", (int id, SaveSnmpSensor r, CybereyesDbContext db, AlertService alerts, CancellationToken ct) =>
            SaveSensorAsync(id, null, r, db, alerts, ct)).RequireAuthorization(manage);
        g.MapPut("/devices/{id:int}/sensors/{sensorId:int}", (int id, int sensorId, SaveSnmpSensor r, CybereyesDbContext db, AlertService alerts, CancellationToken ct) =>
            SaveSensorAsync(id, sensorId, r, db, alerts, ct)).RequireAuthorization(manage);
        g.MapDelete("/devices/{id:int}/sensors/{sensorId:int}", async (int id, int sensorId, CybereyesDbContext db, AlertService alerts, CancellationToken ct) =>
        {
            var deleted = await db.SnmpSensors.Where(s => s.Id == sensorId && s.DeviceId == id).ExecuteDeleteAsync(ct);
            if (deleted == 0)
            {
                return Problems.NotFound("Sensor");
            }
            await alerts.ResolveSubjectAsync(null, id, AlertTypes.SnmpSensor, $"sensor:{sensorId}", ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(manage);
        g.MapGet("/devices/{id:int}/metrics", MetricsAsync).RequireAuthorization(view);
        g.MapGet("/collectors", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await db.Agents.AsNoTracking()
            .Where(a => a.SnmpCollector).OrderBy(a => a.Hostname)
            .Select(a => new
            {
                agentId = a.Id, a.Hostname, a.Site!.ClientId, a.SiteId, a.Status, a.Version,
                deviceCount = db.SnmpDevices.Count(d => d.CollectorAgentId == a.Id),
            }).ToListAsync(ct))).RequireAuthorization(view);

        app.MapPut("/api/agents/{id:int}/snmp-collector", SetCollectorAsync).WithTags("Agentes")
            .RequireAuthorization(Policies.Permission(Permissions.AgentsManage));
    }

    private static async Task<IResult> DetailAsync(int id, CybereyesDbContext db, SnmpService svc, CancellationToken ct)
    {
        var device = await svc.Dtos(db.SnmpDevices.AsNoTracking().Where(d => d.Id == id)).FirstOrDefaultAsync(ct);
        if (device is null)
        {
            return Problems.NotFound("Dispositivo");
        }
        var interfaces = await db.SnmpInterfaces.AsNoTracking().Where(i => i.DeviceId == id).OrderBy(i => i.Index)
            .Select(i => new { i.Index, i.Name, i.Descr, i.Alias, i.Type, i.SpeedBps, i.AdminStatus, i.OperStatus, i.InBps, i.OutBps, i.InErrors, i.OutErrors, i.LastAt, i.Monitored })
            .ToListAsync(ct);
        var sensors = await db.SnmpSensors.AsNoTracking().Where(s => s.DeviceId == id).OrderBy(s => s.Name).ToListAsync(ct);
        var extra = await db.SnmpDevices.AsNoTracking().Where(d => d.Id == id)
            .Select(d => new { d.Timeout, d.Retries, d.PollInterfaces, d.SysObjectId, d.V3Username, d.V3SecurityLevel, d.V3AuthProtocol, d.V3PrivProtocol })
            .FirstAsync(ct);
        return TypedResults.Ok(new
        {
            device.Id, device.ClientId, device.ClientName, device.SiteId, device.CollectorAgentId, device.CollectorHostname, device.AssetId, device.Name,
            device.Host, device.Port, device.Version, device.Interval, device.Enabled, device.TrapSeverity, device.Status, device.LastPolledAt, device.LastError,
            device.SysName, device.SysDescr, device.SysLocation, device.SysContact, device.UptimeSeconds, device.HasCredentials, device.InterfaceCount,
            device.InterfacesDown, extra.Timeout, extra.Retries, extra.PollInterfaces, extra.SysObjectId,
            v3 = extra.V3Username is null ? null : new
            {
                username = extra.V3Username, securityLevel = extra.V3SecurityLevel, authProtocol = extra.V3AuthProtocol, privProtocol = extra.V3PrivProtocol,
            },
            interfaces,
            sensors = sensors.Select(s => new { s.Id, s.Name, s.Oid, s.Unit, s.WarnAbove, s.CritAbove, s.WarnBelow, s.CritBelow, s.LastValue, s.LastText, s.LastAt }),
        });
    }

    /// <summary>Valida o cadastro e preenche o dispositivo; credenciais ausentes mantem as atuais.</summary>
    private static async Task<IResult?> ApplyAsync(SnmpDevice device, SaveSnmpDevice r, bool creating, CybereyesDbContext db, Vault vault, CancellationToken ct)
    {
        if (r.Version is not ("v2c" or "v3"))
        {
            return Problems.Validation("version", "Use v2c ou v3");
        }
        if (!TrapSeverities.Contains(r.TrapSeverity))
        {
            return Problems.Validation("trapSeverity", "Use none, info, warning ou error");
        }
        var host = r.Host.Trim();
        if (!HostPattern().IsMatch(host))
        {
            return Problems.Validation("host", "Informe um IP ou nome de host valido");
        }
        if (!await db.Clients.AnyAsync(c => c.Id == r.ClientId, ct))
        {
            return Problems.Validation("clientId", "Cliente nao encontrado");
        }
        if (r.SiteId is { } siteId && !await db.Sites.AnyAsync(s => s.Id == siteId && s.ClientId == r.ClientId, ct))
        {
            return Problems.Validation("siteId", "O site precisa ser do mesmo cliente");
        }
        if (r.AssetId is { } assetId && !await db.Assets.AnyAsync(a => a.Id == assetId && a.ClientId == r.ClientId, ct))
        {
            return Problems.Validation("assetId", "O ativo precisa ser do mesmo cliente");
        }
        var collector = await db.Agents.AsNoTracking().Where(a => a.Id == r.CollectorAgentId)
            .Select(a => new { a.SnmpCollector, a.Site!.ClientId }).FirstOrDefaultAsync(ct);
        if (collector is null || !collector.SnmpCollector)
        {
            return Problems.Validation("collectorAgentId", "Escolha um agente marcado como coletor SNMP");
        }
        if (collector.ClientId != r.ClientId)
        {
            return Problems.Validation("collectorAgentId", "O coletor precisa ser do mesmo cliente do dispositivo");
        }

        var versionChanged = device.Version != r.Version;
        if (r.Version == "v2c")
        {
            var community = r.Community?.Trim();
            if (string.IsNullOrEmpty(community) && (creating || versionChanged || device.CommunityEncrypted is null))
            {
                return Problems.Validation("community", "Informe a comunidade SNMP");
            }
            if (!string.IsNullOrEmpty(community))
            {
                if (!vault.Enabled)
                {
                    return Problems.BadRequest("O cofre esta sem chave (VAULT_KEY); nao e possivel guardar a comunidade");
                }
                device.CommunityEncrypted = vault.Encrypt(community);
            }
            device.V3Username = device.V3SecurityLevel = device.V3AuthProtocol = device.V3AuthPasswordEncrypted = null;
            device.V3PrivProtocol = device.V3PrivPasswordEncrypted = null;
        }
        else
        {
            if (r.V3 is not { } v3 || !SecurityLevels.Contains(v3.SecurityLevel))
            {
                return Problems.Validation("v3", "Informe usuario e nivel de seguranca (noAuthNoPriv, authNoPriv ou authPriv)");
            }
            var needsAuth = v3.SecurityLevel != "noAuthNoPriv";
            var needsPriv = v3.SecurityLevel == "authPriv";
            if (needsAuth && (v3.AuthProtocol is null || !AuthProtocols.Contains(v3.AuthProtocol)))
            {
                return Problems.Validation("v3.authProtocol", "Use SHA, SHA256, SHA512 ou MD5");
            }
            if (needsPriv && (v3.PrivProtocol is null || !PrivProtocols.Contains(v3.PrivProtocol)))
            {
                return Problems.Validation("v3.privProtocol", "Use AES, AES256 ou DES");
            }
            var keepAuth = !creating && !versionChanged && device.V3AuthPasswordEncrypted is not null;
            var keepPriv = !creating && !versionChanged && device.V3PrivPasswordEncrypted is not null;
            if (needsAuth && string.IsNullOrEmpty(v3.AuthPassword) && !keepAuth)
            {
                return Problems.Validation("v3.authPassword", "Informe a senha de autenticacao");
            }
            if (needsPriv && string.IsNullOrEmpty(v3.PrivPassword) && !keepPriv)
            {
                return Problems.Validation("v3.privPassword", "Informe a senha de privacidade");
            }
            if (v3.AuthPassword is { Length: > 0 and < 8 } || v3.PrivPassword is { Length: > 0 and < 8 })
            {
                return Problems.Validation("v3", "As senhas SNMPv3 precisam de pelo menos 8 caracteres");
            }
            if ((!string.IsNullOrEmpty(v3.AuthPassword) || !string.IsNullOrEmpty(v3.PrivPassword)) && !vault.Enabled)
            {
                return Problems.BadRequest("O cofre esta sem chave (VAULT_KEY); nao e possivel guardar as senhas");
            }
            device.V3Username = v3.Username.Trim();
            device.V3SecurityLevel = v3.SecurityLevel;
            device.V3AuthProtocol = needsAuth ? v3.AuthProtocol : null;
            device.V3PrivProtocol = needsPriv ? v3.PrivProtocol : null;
            device.V3AuthPasswordEncrypted = !needsAuth ? null : string.IsNullOrEmpty(v3.AuthPassword) ? device.V3AuthPasswordEncrypted : vault.Encrypt(v3.AuthPassword);
            device.V3PrivPasswordEncrypted = !needsPriv ? null : string.IsNullOrEmpty(v3.PrivPassword) ? device.V3PrivPasswordEncrypted : vault.Encrypt(v3.PrivPassword);
            device.CommunityEncrypted = null;
        }

        device.ClientId = r.ClientId;
        device.SiteId = r.SiteId;
        device.CollectorAgentId = r.CollectorAgentId;
        device.AssetId = r.AssetId;
        device.Name = r.Name.Trim();
        device.Host = host;
        device.Port = r.Port;
        device.Version = r.Version;
        device.Interval = r.Interval;
        device.Timeout = r.Timeout;
        device.Retries = r.Retries;
        device.PollInterfaces = r.PollInterfaces;
        device.Enabled = r.Enabled;
        device.TrapSeverity = r.TrapSeverity;
        return null;
    }

    private static async Task<IResult> SaveAsync(int? id, SaveSnmpDevice r, CybereyesDbContext db, Vault vault, SnmpService svc, IAuditService audit, CancellationToken ct)
    {
        var device = id is null ? new SnmpDevice { Name = r.Name, Host = r.Host } : await db.SnmpDevices.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (device is null)
        {
            return Problems.NotFound("Dispositivo");
        }
        if (await ApplyAsync(device, r, id is null, db, vault, ct) is { } problem)
        {
            return problem;
        }
        if (id is null)
        {
            db.SnmpDevices.Add(device);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "snmp.device.created" : "snmp.device.updated", "snmp_device", device.Id.ToString(CultureInfo.InvariantCulture),
            $"Dispositivo SNMP {device.Name} ({device.Host})", cancellationToken: ct);
        var dto = await svc.Dtos(db.SnmpDevices.AsNoTracking().Where(d => d.Id == device.Id)).FirstAsync(ct);
        return id is null ? TypedResults.Created($"/api/snmp/devices/{device.Id}", dto) : TypedResults.Ok(dto);
    }

    private static async Task<IResult> DeleteAsync(int id, CybereyesDbContext db, IAuditService audit, AlertService alerts, CancellationToken ct)
    {
        var device = await db.SnmpDevices.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (device is null)
        {
            return Problems.NotFound("Dispositivo");
        }
        var openAlerts = await db.Alerts.Where(a => a.SnmpDeviceId == id && !a.Resolved).Select(a => a.Id).ToListAsync(ct);
        await alerts.AlertsResolvedAsync(openAlerts, ct);
        await db.SnmpSamples.Where(s => s.DeviceId == id).ExecuteDeleteAsync(ct);
        db.SnmpDevices.Remove(device);
        await db.SaveChangesAsync(ct);
        await alerts.BroadcastAsync(ct);
        await audit.LogAsync("snmp.device.deleted", "snmp_device", id.ToString(CultureInfo.InvariantCulture), $"Dispositivo SNMP {device.Name} excluido",
            cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> TestAsync(SaveSnmpDevice r, CybereyesDbContext db, Vault vault, SnmpService svc, IAgentRpc rpc, CancellationToken ct)
    {
        var stored = r.Id is { } existingId ? await db.SnmpDevices.AsNoTracking().FirstOrDefaultAsync(d => d.Id == existingId, ct) : null;
        if (r.Id is not null && stored is null)
        {
            return Problems.NotFound("Dispositivo");
        }
        var device = stored ?? new SnmpDevice { Name = r.Name, Host = r.Host };
        if (await ApplyAsync(device, r, stored is null, db, vault, ct) is { } problem)
        {
            return problem;
        }
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == r.CollectorAgentId).Select(a => new { a.AgentId, a.Version }).FirstAsync(ct);
        if (!SnmpService.Supports(agent.Version))
        {
            return Problems.BadRequest("O coletor precisa do agente 2.13.0 ou superior");
        }
        var target = JsonSerializer.Serialize(svc.Target(device, [], includeId: false));
        try
        {
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = "snmp_test",
                ["payload"] = new Dictionary<string, object?> { ["target"] = target },
            }, TimeSpan.FromSeconds(Math.Min(120, (r.Timeout * (r.Retries + 1)) + 10)), ct);
            if (reply is not string json)
            {
                return Problems.BadRequest("Resposta invalida do coletor");
            }
            if (json.StartsWith("error", StringComparison.Ordinal))
            {
                return Problems.BadRequest(json);
            }
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            return TypedResults.Ok(new
            {
                reachable = root.TryGetProperty("reachable", out var ok) && ok.ValueKind == JsonValueKind.True,
                error = root.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String ? err.GetString() : null,
                rttMs = root.TryGetProperty("rtt_ms", out var rtt) && rtt.ValueKind == JsonValueKind.Number ? rtt.GetDouble() : (double?)null,
                system = root.TryGetProperty("system", out var sys) && sys.ValueKind == JsonValueKind.Object ? (object?)sys.Clone() : null,
            });
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        catch (JsonException)
        {
            return Problems.BadRequest("Resposta invalida do coletor");
        }
    }

    private static async Task<IResult> SetMonitoredAsync(int id, int index, MonitoredRequest r, CybereyesDbContext db, AlertService alerts, CancellationToken ct)
    {
        var row = await db.SnmpInterfaces.FirstOrDefaultAsync(i => i.DeviceId == id && i.Index == index, ct);
        if (row is null)
        {
            return Problems.NotFound("Interface");
        }
        row.Monitored = r.Monitored;
        await db.SaveChangesAsync(ct);
        if (!r.Monitored)
        {
            await alerts.ResolveSubjectAsync(null, id, AlertTypes.SnmpInterface, $"if:{index}", ct);
        }
        return TypedResults.Ok(new { row.Index, row.Monitored });
    }

    private static async Task<IResult> SaveSensorAsync(int id, int? sensorId, SaveSnmpSensor r, CybereyesDbContext db, AlertService alerts, CancellationToken ct)
    {
        if (!OidPattern().IsMatch(r.Oid.Trim()))
        {
            return Problems.Validation("oid", "Use um OID numerico, por exemplo 1.3.6.1.2.1.25.3.3.1.2.1");
        }
        if (!await db.SnmpDevices.AnyAsync(d => d.Id == id, ct))
        {
            return Problems.NotFound("Dispositivo");
        }
        var sensor = sensorId is null ? new SnmpSensor { DeviceId = id, Name = r.Name, Oid = r.Oid }
            : await db.SnmpSensors.FirstOrDefaultAsync(s => s.Id == sensorId && s.DeviceId == id, ct);
        if (sensor is null)
        {
            return Problems.NotFound("Sensor");
        }
        sensor.Name = r.Name.Trim();
        sensor.Oid = r.Oid.Trim().TrimStart('.');
        sensor.Unit = r.Unit?.Trim() ?? string.Empty;
        sensor.WarnAbove = r.WarnAbove;
        sensor.CritAbove = r.CritAbove;
        sensor.WarnBelow = r.WarnBelow;
        sensor.CritBelow = r.CritBelow;
        if (sensorId is null)
        {
            db.SnmpSensors.Add(sensor);
        }
        await db.SaveChangesAsync(ct);
        if (sensorId is not null && (sensor.LastValue is not { } v || SnmpService.Evaluate(sensor, v).Severity is null))
        {
            await alerts.ResolveSubjectAsync(null, id, AlertTypes.SnmpSensor, $"sensor:{sensor.Id}", ct);
        }
        var dto = new { sensor.Id, sensor.Name, sensor.Oid, sensor.Unit, sensor.WarnAbove, sensor.CritAbove, sensor.WarnBelow, sensor.CritBelow, sensor.LastValue, sensor.LastText, sensor.LastAt };
        return sensorId is null ? TypedResults.Created($"/api/snmp/devices/{id}/sensors/{sensor.Id}", dto) : TypedResults.Ok(dto);
    }

    public sealed record Point(DateTimeOffset Time, double Value);

    private static async Task<IResult> MetricsAsync(int id, string? metric, DateTimeOffset? from, DateTimeOffset? to, CybereyesDbContext db, TimeProvider clock,
        CancellationToken ct)
    {
        if (metric is null || !MetricPattern().IsMatch(metric))
        {
            return Problems.Validation("metric", "Use rtt, if:<indice>:in, if:<indice>:out ou sensor:<id>");
        }
        var end = (to ?? clock.GetUtcNow()).ToUniversalTime();
        var start = (from ?? end.AddHours(-24)).ToUniversalTime();
        if (start >= end || end - start > TimeSpan.FromDays(400))
        {
            return Problems.BadRequest("Periodo invalido");
        }
        // A agregacao em SQL puro nao passa pelo filtro de clientes do EF: confere o dispositivo antes.
        if (!await db.SnmpDevices.AnyAsync(d => d.Id == id, ct))
        {
            return Problems.NotFound("Dispositivo");
        }
        var query = db.SnmpSamples.AsNoTracking().Where(s => s.DeviceId == id && s.Metric == metric && s.Time >= start && s.Time < end);
        var count = await query.CountAsync(ct);
        List<Point> points;
        if (count <= MaxPoints)
        {
            points = await query.OrderBy(s => s.Time).Select(s => new Point(s.Time, s.Value)).ToListAsync(ct);
        }
        else
        {
            var bucket = Math.Max(1, (long)Math.Ceiling((end - start).TotalSeconds / MaxPoints));
            points = await db.Database.SqlQuery<Point>($"""
                SELECT to_timestamp(floor(extract(epoch FROM "Time") / {bucket}) * {bucket}) AS "Time", avg("Value") AS "Value"
                FROM snmp_samples
                WHERE "DeviceId" = {id} AND "Metric" = {metric} AND "Time" >= {start} AND "Time" < {end}
                GROUP BY 1 ORDER BY 1
                """).ToListAsync(ct);
        }
        return TypedResults.Ok(new { metric, points });
    }

    private static async Task<IResult> SetCollectorAsync(int id, CollectorRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var agent = await db.Agents.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (r.Enabled && !SnmpService.Supports(agent.Version))
        {
            return Problems.BadRequest("O coletor SNMP precisa do agente 2.13.0 ou superior");
        }
        if (!r.Enabled && await db.SnmpDevices.AnyAsync(d => d.CollectorAgentId == id, ct))
        {
            return Problems.Conflict("Este coletor ainda tem dispositivos; mova-os para outro coletor antes");
        }
        agent.SnmpCollector = r.Enabled;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("agent.snmp-collector", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"Coletor SNMP {(r.Enabled ? "ativado" : "desativado")} em {agent.Hostname}", cancellationToken: ct);
        return TypedResults.Ok(new { agentId = id, enabled = r.Enabled });
    }
}
