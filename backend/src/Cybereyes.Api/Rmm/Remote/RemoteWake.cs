using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Placa de rede do inventario: MAC e um endereco IPv4 com o prefixo da rede.</summary>
public sealed record WakeNic(string Mac, IPAddress Address, int Prefix)
{
    /// <summary>Endereco de broadcast da rede (ultimo endereco do bloco).</summary>
    public IPAddress Broadcast
    {
        get
        {
            var bytes = Address.GetAddressBytes();
            var host = Prefix >= 32 ? 0u : uint.MaxValue >> Prefix;
            var value = ((uint)bytes[0] << 24 | (uint)bytes[1] << 16 | (uint)bytes[2] << 8 | bytes[3]) | host;
            return new IPAddress([(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value]);
        }
    }

    public bool SameNetwork(IPAddress other) =>
        other.AddressFamily == Address.AddressFamily && NetUtil.Mask(other, Prefix).Equals(NetUtil.Mask(Address, Prefix));
}

/// <summary>
/// Wake-on-LAN pelo EYES (contrato do acesso remoto, secao 3): a API escolhe um agente online do mesmo site com placa na
/// mesma rede do alvo e manda o comando "wol" com os MACs e os broadcasts. Substitui o envio pelo MeshCentral.
/// </summary>
public static class RemoteWake
{
    public static void MapWakeEndpoint(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/agents/{id:int}/wake", WakeAsync).WithTags("Acesso remoto").RequireAuthorization(Policies.Permission(Permissions.AgentsControl));

    /// <summary>Le as placas IPv4 com MAC do inventario: WMI no Windows ("network_config"), "nics" no Linux e no macOS.</summary>
    public static IReadOnlyList<WakeNic> Nics(string? wmiJson, string plat)
    {
        var result = new List<WakeNic>();
        JsonElement root;
        try
        {
            root = string.IsNullOrWhiteSpace(wmiJson) ? default : JsonDocument.Parse(wmiJson).RootElement;
        }
        catch (JsonException)
        {
            return result;
        }
        if (root.ValueKind != JsonValueKind.Object)
        {
            return result;
        }
        if (plat == "windows")
        {
            foreach (var cfg in Flatten(root, "network_config"))
            {
                if (NetUtil.NormalizeMac(Str(cfg, "MACAddress")) is not { } mac)
                {
                    continue;
                }
                var ips = StrList(cfg, "IPAddress");
                var masks = StrList(cfg, "IPSubnet");
                for (var i = 0; i < ips.Count; i++)
                {
                    if (IPAddress.TryParse(ips[i], out var ip) && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                        && i < masks.Count && MaskPrefix(masks[i]) is { } prefix)
                    {
                        result.Add(new WakeNic(mac, ip, prefix));
                    }
                }
            }
            return result;
        }
        if (root.TryGetProperty("nics", out var nics) && nics.ValueKind == JsonValueKind.Array)
        {
            foreach (var nic in nics.EnumerateArray())
            {
                if (NetUtil.NormalizeMac(Str(nic, "mac")) is not { } mac)
                {
                    continue;
                }
                foreach (var cidr in StrList(nic, "ips"))
                {
                    var parts = cidr.Split('/');
                    if (parts.Length == 2 && IPAddress.TryParse(parts[0], out var ip) && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                        && int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var prefix) && prefix is >= 0 and <= 32)
                    {
                        result.Add(new WakeNic(mac, ip, prefix));
                    }
                }
            }
        }
        return result;
    }

    private static IEnumerable<JsonElement> Flatten(JsonElement root, string key)
    {
        if (!root.TryGetProperty(key, out var section) || section.ValueKind != JsonValueKind.Array)
        {
            yield break;
        }
        foreach (var item in section.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                yield return item;
            }
            else if (item.ValueKind == JsonValueKind.Array)
            {
                foreach (var inner in item.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Object))
                {
                    yield return inner;
                }
            }
        }
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<string> StrList(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : [];

    /// <summary>Converte a mascara "255.255.255.0" em prefixo; recusa mascaras nao contiguas.</summary>
    public static int? MaskPrefix(string mask)
    {
        if (!IPAddress.TryParse(mask, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return null;
        }
        var b = ip.GetAddressBytes();
        var value = (uint)b[0] << 24 | (uint)b[1] << 16 | (uint)b[2] << 8 | b[3];
        var prefix = System.Numerics.BitOperations.LeadingZeroCount(~value);
        return prefix == 32 || value << prefix == 0 ? prefix : null;
    }

    private static async Task<IResult> WakeAsync(int id, CybereyesDbContext db, IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var target = await db.Agents.AsNoTracking().Where(a => a.Id == id)
            .Select(a => new { a.Id, a.Hostname, a.SiteId, a.Plat, a.WmiDetail }).FirstOrDefaultAsync(ct);
        if (target is null)
        {
            return Problems.NotFound("Agente");
        }
        var nics = Nics(target.WmiDetail, target.Plat).ToList();
        if (nics.Count == 0)
        {
            return Problems.Conflict("O inventario desta maquina nao tem placa de rede com MAC e IPv4 para o Wake-on-LAN");
        }
        var candidates = await db.Agents.AsNoTracking()
            .Where(a => a.SiteId == target.SiteId && a.Id != target.Id && a.Status == AgentStatus.Online)
            .Select(a => new { a.Id, a.AgentId, a.Hostname, a.Plat, a.WmiDetail, a.Version }).ToListAsync(ct);
        var relays = candidates
            .Where(a => Version.TryParse(a.Version, out var v) && v >= new Version(3, 1, 0))
            .Select(a => new { Agent = a, Shared = Nics(a.WmiDetail, a.Plat).Where(r => nics.Any(n => n.SameNetwork(r.Address))).ToList() })
            .Where(x => x.Shared.Count > 0)
            .ToList();
        if (relays.Count == 0)
        {
            return Problems.Conflict("Nenhum agente online do mesmo site (EYES 3.1.0 ou mais novo) esta na mesma rede desta maquina");
        }
        var macs = nics.Select(n => n.Mac).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var macsJson = JsonSerializer.Serialize(macs);
        string? lastError = null;
        foreach (var relay in relays)
        {
            var broadcasts = nics.Where(n => relay.Shared.Any(r => n.SameNetwork(r.Address))).Select(n => n.Broadcast.ToString()).Distinct().ToList();
            try
            {
                var answer = await rpc.RequestAsync(relay.Agent.AgentId, new Dictionary<string, object?>
                {
                    ["func"] = "wol",
                    ["payload"] = new Dictionary<string, string> { ["macs"] = macsJson, ["broadcast"] = JsonSerializer.Serialize(broadcasts) },
                }, TimeSpan.FromSeconds(15), ct);
                if (answer as string == "ok")
                {
                    await audit.LogAsync("agent.wake", "agent", id.ToString(CultureInfo.InvariantCulture),
                        $"Wake-on-LAN enviado para {target.Hostname} por {relay.Agent.Hostname}", cancellationToken: ct);
                    return TypedResults.Ok(new { result = "ok", via = relay.Agent.Hostname });
                }
                lastError = answer as string ?? "resposta invalida";
            }
            catch (AgentRpcTimeoutException)
            {
                lastError = $"{relay.Agent.Hostname} nao respondeu";
            }
        }
        return Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: "Nenhum agente conseguiu enviar o Wake-on-LAN", detail: lastError,
            extensions: new Dictionary<string, object?> { ["code"] = RemoteErrors.AgentError });
    }
}
