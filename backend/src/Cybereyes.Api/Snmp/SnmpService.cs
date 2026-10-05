using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Logs;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Snmp;

public sealed record SnmpDeviceDto(int Id, int ClientId, string? ClientName, int? SiteId, int? CollectorAgentId, string? CollectorHostname, int? AssetId,
    string Name, string Host, int Port, string Version, int Interval, bool Enabled, string TrapSeverity, string Status, DateTimeOffset? LastPolledAt,
    string? LastError, string? SysName, string? SysDescr, string? SysLocation, string? SysContact, long? UptimeSeconds, bool HasCredentials,
    int InterfaceCount, int InterfacesDown);

/// <summary>Regras de SNMP no servidor: alvos do coletor, resultados de coleta, taxas, status, sensores e traps.</summary>
public sealed partial class SnmpService(CybereyesDbContext db, Vault vault, AlertService alerts, IHubContext<ConsoleHub> hub, TimeProvider time,
    ILogger<SnmpService> logger)
{
    public const int FailuresBeforeDown = 2;
    public static readonly Version MinimumAgent = new(2, 13, 0);

    public static bool Supports(string version) => Version.TryParse(version, out var v) && v >= MinimumAgent;

    public IQueryable<SnmpDeviceDto> Dtos(IQueryable<SnmpDevice> devices) =>
        devices.Select(d => new SnmpDeviceDto(d.Id, d.ClientId, db.Clients.Where(c => c.Id == d.ClientId).Select(c => c.Name).FirstOrDefault(),
            d.SiteId, d.CollectorAgentId, db.Agents.Where(a => a.Id == d.CollectorAgentId).Select(a => a.Hostname).FirstOrDefault(), d.AssetId,
            d.Name, d.Host, d.Port, d.Version, d.Interval, d.Enabled, d.TrapSeverity, d.Status, d.LastPolledAt, d.LastError, d.SysName, d.SysDescr,
            d.SysLocation, d.SysContact, d.UptimeSeconds,
            d.Version == "v3" ? d.V3Username != null : d.CommunityEncrypted != null,
            db.SnmpInterfaces.Count(i => i.DeviceId == d.Id),
            db.SnmpInterfaces.Count(i => i.DeviceId == d.Id && i.AdminStatus == "up" && (i.OperStatus == "down" || i.OperStatus == "lowerLayerDown"))));

    // Alvos entregues ao coletor (unico ponto em que as credenciais saem decifradas).

    public Dictionary<string, object?> Target(SnmpDevice d, IEnumerable<SnmpSensor> sensors, bool includeId)
    {
        var target = new Dictionary<string, object?>
        {
            ["host"] = d.Host,
            ["port"] = d.Port,
            ["version"] = d.Version,
            ["community"] = d.Version == "v2c" ? Decrypt(d.CommunityEncrypted) : string.Empty,
            ["v3"] = d.Version == "v3"
                ? new Dictionary<string, object?>
                {
                    ["username"] = d.V3Username ?? string.Empty,
                    ["security_level"] = d.V3SecurityLevel ?? "noAuthNoPriv",
                    ["auth_protocol"] = d.V3AuthProtocol ?? string.Empty,
                    ["auth_password"] = Decrypt(d.V3AuthPasswordEncrypted),
                    ["priv_protocol"] = d.V3PrivProtocol ?? string.Empty,
                    ["priv_password"] = Decrypt(d.V3PrivPasswordEncrypted),
                }
                : null,
            ["interval"] = d.Interval,
            ["timeout"] = d.Timeout,
            ["retries"] = d.Retries,
            ["interfaces"] = d.PollInterfaces,
            ["sensors"] = sensors.Select(s => new Dictionary<string, object?> { ["id"] = s.Id, ["oid"] = s.Oid }).ToList(),
        };
        if (includeId)
        {
            target["id"] = d.Id;
        }
        return target;
    }

    private string Decrypt(string? stored)
    {
        if (string.IsNullOrEmpty(stored))
        {
            return string.Empty;
        }
        try
        {
            return vault.Decrypt(stored);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Security.Cryptography.CryptographicException or FormatException)
        {
            LogDecryptFailed(logger, ex);
            return string.Empty;
        }
    }

    public async Task<object> CollectorConfigAsync(int agentPk, CancellationToken ct)
    {
        var collector = await db.Agents.AsNoTracking().Where(a => a.Id == agentPk).Select(a => a.SnmpCollector).FirstOrDefaultAsync(ct);
        if (!collector)
        {
            return new Dictionary<string, object?> { ["enabled"] = false, ["trap_port"] = 162, ["devices"] = Array.Empty<object>() };
        }
        var devices = await db.SnmpDevices.AsNoTracking().Where(d => d.CollectorAgentId == agentPk && d.Enabled).OrderBy(d => d.Id).ToListAsync(ct);
        var ids = devices.Select(d => d.Id).ToList();
        var sensors = await db.SnmpSensors.AsNoTracking().Where(s => ids.Contains(s.DeviceId)).ToListAsync(ct);
        return new Dictionary<string, object?>
        {
            ["enabled"] = true,
            ["trap_port"] = 162,
            ["devices"] = devices.Select(d => Target(d, sensors.Where(s => s.DeviceId == d.Id), includeId: true)).ToList(),
        };
    }

    // Resultados de coleta

    public async Task ApplyResultsAsync(int agentPk, JsonElement results, CancellationToken ct)
    {
        foreach (var r in results.EnumerateArray())
        {
            if (r.ValueKind == JsonValueKind.Object && Int(r, "device_id") is { } id)
            {
                await ApplyResultAsync(agentPk, (int)id, r, ct);
            }
        }
    }

    private async Task ApplyResultAsync(int agentPk, int deviceId, JsonElement r, CancellationToken ct)
    {
        var device = await db.SnmpDevices.FirstOrDefaultAsync(d => d.Id == deviceId && d.CollectorAgentId == agentPk, ct);
        if (device is null)
        {
            return;
        }
        var now = time.GetUtcNow();
        var at = DateTimeOffset.TryParse(Str(r, "time"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t.ToUniversalTime() : now;
        if (at > now.AddMinutes(5))
        {
            at = now;
        }
        // Reenvio do mesmo lote pelo coletor: ja aplicado.
        if (device.LastPolledAt is { } last && at <= last)
        {
            return;
        }
        var previousStatus = device.Status;
        device.LastPolledAt = at;
        var reachable = r.TryGetProperty("reachable", out var reach) && reach.ValueKind == JsonValueKind.True;
        var samples = new List<SnmpSample>();

        if (!reachable)
        {
            device.FailCount++;
            device.LastError = LogIngest.Clean(Str(r, "error") ?? "Sem resposta", 1000);
            if (device.FailCount >= FailuresBeforeDown)
            {
                device.Status = SnmpStatus.Down;
            }
        }
        else
        {
            device.FailCount = 0;
            device.LastError = null;
            device.Status = SnmpStatus.Up;
            if (Dbl(r, "rtt_ms") is { } rtt)
            {
                samples.Add(new SnmpSample { DeviceId = device.Id, Metric = "rtt", Time = at, Value = rtt });
            }
            if (r.TryGetProperty("system", out var sys) && sys.ValueKind == JsonValueKind.Object)
            {
                device.SysDescr = Trim(Str(sys, "descr"), 1000);
                device.SysObjectId = Trim(Str(sys, "object_id"), 255);
                device.SysContact = Trim(Str(sys, "contact"), 255);
                device.SysName = Trim(Str(sys, "name"), 255);
                device.SysLocation = Trim(Str(sys, "location"), 255);
                device.UptimeSeconds = Int(sys, "uptime_ticks") is { } ticks ? ticks / 100 : null;
            }
        }
        await db.SaveChangesAsync(ct);

        var interfaceAlerts = reachable && r.TryGetProperty("interfaces", out var ifs) && ifs.ValueKind == JsonValueKind.Array
            ? await ApplyInterfacesAsync(device, at, ifs, samples, ct)
            : [];
        var sensorAlerts = reachable && r.TryGetProperty("sensors", out var ss) && ss.ValueKind == JsonValueKind.Array
            ? await ApplySensorsAsync(device, at, ss, samples, ct)
            : [];
        db.SnmpSamples.AddRange(samples);
        await db.SaveChangesAsync(ct);

        if (device.Status != previousStatus)
        {
            if (device.Status == SnmpStatus.Down)
            {
                await alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, device.Id, "device", AlertTypes.SnmpDevice, Severity.Error,
                    $"Dispositivo {device.Name} ({device.Host}) sem resposta SNMP: {device.LastError}"), ct);
            }
            else if (device.Status == SnmpStatus.Up)
            {
                await alerts.ResolveSubjectAsync(null, device.Id, AlertTypes.SnmpDevice, "device", ct);
            }
            await BroadcastAsync(device.Id, ct);
        }
        foreach (var action in interfaceAlerts.Concat(sensorAlerts))
        {
            await action();
        }
    }

    private async Task<List<Func<Task>>> ApplyInterfacesAsync(SnmpDevice device, DateTimeOffset at, JsonElement items, List<SnmpSample> samples,
        CancellationToken ct)
    {
        var actions = new List<Func<Task>>();
        var existing = await db.SnmpInterfaces.Where(i => i.DeviceId == device.Id).ToDictionaryAsync(i => i.Index, ct);
        foreach (var item in items.EnumerateArray().Take(2048))
        {
            if (item.ValueKind != JsonValueKind.Object || Int(item, "index") is not { } idx || idx is < 0 or > int.MaxValue)
            {
                continue;
            }
            var index = (int)idx;
            if (!existing.TryGetValue(index, out var row))
            {
                row = new SnmpInterface { DeviceId = device.Id, Index = index };
                db.SnmpInterfaces.Add(row);
                existing[index] = row;
            }
            var previousOper = row.OperStatus;
            row.Name = Trim(Str(item, "name"), 255) ?? string.Empty;
            row.Descr = Trim(Str(item, "descr"), 255) ?? string.Empty;
            row.Alias = Trim(Str(item, "alias"), 255) ?? string.Empty;
            row.Type = (int)Math.Clamp(Int(item, "type") ?? 0, 0, int.MaxValue);
            row.SpeedBps = Int(item, "speed_bps") ?? 0;
            row.AdminStatus = IfStatus(item, "admin_status");
            row.OperStatus = IfStatus(item, "oper_status");
            row.InErrors = Int(item, "in_errors") ?? row.InErrors;
            row.OutErrors = Int(item, "out_errors") ?? row.OutErrors;

            var inOctets = Dec(item, "in_octets");
            var outOctets = Dec(item, "out_octets");
            var seconds = row.LastAt is { } lastAt ? (at - lastAt).TotalSeconds : 0;
            row.InBps = Rate(row.LastIn, inOctets, seconds);
            row.OutBps = Rate(row.LastOut, outOctets, seconds);
            if (row.InBps is { } inBps)
            {
                samples.Add(new SnmpSample { DeviceId = device.Id, Metric = $"if:{index}:in", Time = at, Value = inBps });
            }
            if (row.OutBps is { } outBps)
            {
                samples.Add(new SnmpSample { DeviceId = device.Id, Metric = $"if:{index}:out", Time = at, Value = outBps });
            }
            row.LastIn = inOctets;
            row.LastOut = outOctets;
            row.LastAt = at;

            if (row.Monitored)
            {
                var subject = string.Create(CultureInfo.InvariantCulture, $"if:{index}");
                var label = row.Name.Length > 0 ? row.Name : row.Descr;
                if (previousOper == "up" && row.OperStatus is "down" or "lowerLayerDown" && row.AdminStatus == "up")
                {
                    actions.Add(() => alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, device.Id, subject, AlertTypes.SnmpInterface, Severity.Warning,
                        $"Interface {label} de {device.Name} caiu"), ct));
                }
                else if (row.OperStatus == "up" && previousOper != "up")
                {
                    actions.Add(() => alerts.ResolveSubjectAsync(null, device.Id, AlertTypes.SnmpInterface, subject, ct));
                }
            }
        }
        return actions;
    }

    /// <summary>Bits por segundo entre duas leituras do contador; volta ou reinicio do contador descarta a amostra.</summary>
    public static double? Rate(decimal? previous, decimal? current, double seconds) =>
        previous is { } p && current is { } c && c >= p && seconds > 0 ? (double)(c - p) * 8 / seconds : null;

    private async Task<List<Func<Task>>> ApplySensorsAsync(SnmpDevice device, DateTimeOffset at, JsonElement items, List<SnmpSample> samples,
        CancellationToken ct)
    {
        var actions = new List<Func<Task>>();
        var sensors = await db.SnmpSensors.Where(s => s.DeviceId == device.Id).ToDictionaryAsync(s => s.Id, ct);
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || Int(item, "id") is not { } id || !sensors.TryGetValue((int)id, out var sensor))
            {
                continue;
            }
            var value = Dbl(item, "value");
            sensor.LastValue = value;
            sensor.LastText = value is null ? Trim(Str(item, "text"), 500) : null;
            sensor.LastAt = at;
            if (value is not { } v)
            {
                continue;
            }
            samples.Add(new SnmpSample { DeviceId = device.Id, Metric = $"sensor:{sensor.Id}", Time = at, Value = v });
            var subject = string.Create(CultureInfo.InvariantCulture, $"sensor:{sensor.Id}");
            var (severity, limit) = Evaluate(sensor, v);
            if (severity is not null)
            {
                var text = string.Create(CultureInfo.InvariantCulture, $"Sensor {sensor.Name} de {device.Name} em {v:0.##}{sensor.Unit} (limite {limit:0.##}{sensor.Unit})");
                actions.Add(() => alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, device.Id, subject, AlertTypes.SnmpSensor, severity, text), ct));
            }
            else
            {
                actions.Add(() => alerts.ResolveSubjectAsync(null, device.Id, AlertTypes.SnmpSensor, subject, ct));
            }
        }
        return actions;
    }

    public static (string? Severity, double? Limit) Evaluate(SnmpSensor s, double v)
    {
        if (s.CritAbove is { } ca && v > ca)
        {
            return (Severity.Error, ca);
        }
        if (s.CritBelow is { } cb && v < cb)
        {
            return (Severity.Error, cb);
        }
        if (s.WarnAbove is { } wa && v > wa)
        {
            return (Severity.Warning, wa);
        }
        if (s.WarnBelow is { } wb && v < wb)
        {
            return (Severity.Warning, wb);
        }
        return (null, null);
    }

    // Traps

    public async Task ApplyTrapsAsync(int collectorPk, JsonElement traps, CancellationToken ct)
    {
        var clientId = await db.Agents.AsNoTracking().Where(a => a.Id == collectorPk).Select(a => a.Site!.ClientId).FirstAsync(ct);
        var now = time.GetUtcNow();
        var raised = new List<(SnmpDevice Device, string Oid, string Severity, string Message)>();
        foreach (var trap in traps.EnumerateArray().Take(1000))
        {
            if (trap.ValueKind != JsonValueKind.Object || Str(trap, "source_ip") is not { Length: > 0 } source)
            {
                continue;
            }
            var version = Str(trap, "version") ?? string.Empty;
            if (version == "v3")
            {
                continue;
            }
            var at = DateTimeOffset.TryParse(Str(trap, "time"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t.ToUniversalTime() : now;
            if (at > now.AddMinutes(5) || at < now.AddDays(-1))
            {
                at = now;
            }
            var oid = Trim(Str(trap, "trap_oid"), 255) ?? string.Empty;
            var message = TrapMessage(oid, trap);
            var device = await db.SnmpDevices.AsNoTracking().FirstOrDefaultAsync(d => d.ClientId == clientId && d.Host == source, ct);
            if (device is not null && device.Version == "v2c" && Decrypt(device.CommunityEncrypted) != (Str(trap, "community") ?? string.Empty))
            {
                db.SystemLogs.Add(TrapLog(collectorPk, null, clientId, LogLevels.Info, at, now, source, $"Trap de {source} descartado: comunidade nao confere"));
                continue;
            }
            if (device is null)
            {
                db.SystemLogs.Add(TrapLog(collectorPk, null, clientId, LogLevels.Info, at, now, source, message));
                continue;
            }
            var level = device.TrapSeverity is Severity.Warning or Severity.Error ? device.TrapSeverity : LogLevels.Info;
            db.SystemLogs.Add(TrapLog(null, device.Id, clientId, level, at, now, source, message));
            if (device.TrapSeverity != "none")
            {
                raised.Add((device, oid, device.TrapSeverity, message));
            }
        }
        await db.SaveChangesAsync(ct);
        foreach (var (device, oid, severity, message) in raised)
        {
            var subject = "trap:" + (oid.Length > 59 ? oid[^59..] : oid);
            await alerts.RaiseSubjectAsync(new SubjectAlertRequest(null, device.Id, subject, AlertTypes.SnmpTrap, severity,
                $"Trap de {device.Name}: {message}"), ct);
        }
    }

    private static SystemLog TrapLog(int? agentId, int? deviceId, int clientId, string level, DateTimeOffset at, DateTimeOffset now, string source, string message) =>
        new()
        {
            Time = at,
            ReceivedAt = now,
            AgentId = agentId,
            SnmpDeviceId = deviceId,
            ClientId = clientId,
            Level = level,
            Source = "snmp-trap",
            Log = "trap",
            Message = LogIngest.Clean(message, 8000),
            Host = LogIngest.Clean(source, 255),
        };

    private static string TrapMessage(string oid, JsonElement trap)
    {
        var text = new StringBuilder(oid.Length > 0 ? oid : "trap");
        if (trap.TryGetProperty("varbinds", out var vbs) && vbs.ValueKind == JsonValueKind.Array)
        {
            foreach (var vb in vbs.EnumerateArray().Take(100))
            {
                if (vb.ValueKind == JsonValueKind.Object)
                {
                    text.Append("; ").Append(Str(vb, "oid")).Append('=').Append(Str(vb, "value"));
                }
            }
        }
        return text.ToString();
    }

    public async Task BroadcastAsync(int deviceId, CancellationToken ct)
    {
        var dto = await Dtos(db.SnmpDevices.AsNoTracking().Where(d => d.Id == deviceId)).FirstOrDefaultAsync(ct);
        if (dto is not null)
        {
            await hub.Clients.All.SendAsync("snmpDeviceChanged", dto, ct);
        }
    }

    // Leitura tolerante do JSON do agente.

    private static string IfStatus(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.ValueKind switch
    {
        JsonValueKind.Number when v.TryGetInt32(out var n) => n switch
        {
            1 => "up",
            2 => "down",
            3 => "testing",
            5 => "dormant",
            6 => "notPresent",
            7 => "lowerLayerDown",
            _ => "unknown",
        },
        JsonValueKind.String => Trim(v.GetString(), 16) ?? "unknown",
        _ => "unknown",
    } : "unknown";

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.ValueKind switch
    {
        JsonValueKind.String => v.GetString(),
        JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => v.GetRawText(),
        _ => null,
    } : null;

    private static string? Trim(string? text, int max) => text is null ? null : LogIngest.Clean(text, max);

    private static long? Int(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
        ? v.TryGetInt64(out var n) ? n : v.TryGetDecimal(out var d) ? (long)Math.Min(d, long.MaxValue) : null
        : null;

    private static decimal? Dec(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d) ? d : null;

    private static double? Dbl(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) &&
        double.IsFinite(d) ? d : null;

    [LoggerMessage(Level = LogLevel.Warning, Message = "Nao foi possivel decifrar a credencial SNMP (VAULT_KEY ausente ou trocada)")]
    private static partial void LogDecryptFailed(ILogger logger, Exception ex);
}
