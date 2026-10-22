using System.Text.Json;

namespace Cybereyes.Api.Rmm.SpeedTest;

/// <summary>
/// Relatorio do teste de velocidade como o EYES envia (JSON em snake_case, ver docs/agente/contrato-eyes.md 4.3) e como fica
/// gravado (camelCase). <see cref="Normalize"/> so aceita os campos conhecidos e corta textos e listas.
/// </summary>
public sealed record SpeedTestReport
{
    public string Mode { get; init; } = string.Empty;
    public DateTimeOffset? StartedAt { get; init; }
    public DateTimeOffset? FinishedAt { get; init; }
    public SpeedTestServer Server { get; init; } = new();
    public SpeedTestConnection Connection { get; init; } = new();
    public SpeedTestNetwork Network { get; init; } = new();
    public SpeedTestLatency Latency { get; init; } = new();
    public List<SpeedTestDns> Dns { get; init; } = [];
    public SpeedTestDirection Download { get; init; } = new();
    public SpeedTestDirection Upload { get; init; } = new();
    public long BytesUsed { get; init; }
    public List<string> Warnings { get; init; } = [];

    private static readonly JsonSerializerOptions Agent = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private static readonly JsonSerializerOptions Stored = new(JsonSerializerDefaults.Web);

    /// <summary>Le o relatorio enviado pelo agente; nulo quando o corpo nao e um objeto valido.</summary>
    public static SpeedTestReport? Normalize(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        try
        {
            return body.Deserialize<SpeedTestReport>(Agent)?.Limited();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public string Serialize() => JsonSerializer.Serialize(this, Stored);

    public static SpeedTestReport? Read(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<SpeedTestReport>(json, Stored);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // Campos ausentes ou nulos no JSON viram valores vazios: o console e o PDF nao precisam testar nulos.
    private SpeedTestReport Limited()
    {
        var server = Server ?? new();
        var connection = Connection ?? new();
        var network = Network ?? new();
        var latency = Latency ?? new();
        var wifi = network.Wifi;
        return this with
        {
            Mode = Cut(Mode, 16),
            Server = server with { Provider = Cut(server.Provider, 60), Host = Cut(server.Host, 200), Colo = Cut(server.Colo, 10) },
            Connection = connection with
            {
                PublicIp = Cut(connection.PublicIp, 64), City = Cut(connection.City, 120), Region = Cut(connection.Region, 120),
                Country = Cut(connection.Country, 10), Timezone = Cut(connection.Timezone, 64),
            },
            Network = network with
            {
                Interface = Cut(network.Interface, 120), Description = Cut(network.Description, 200), Type = Cut(network.Type, 16),
                LocalIp = Cut(network.LocalIp, 64), Mac = Cut(network.Mac, 32), Gateway = Cut(network.Gateway, 64),
                DnsServers = (network.DnsServers ?? []).Take(8).Select(s => Cut(s, 64)).ToList(),
                Wifi = wifi is null ? null : wifi with
                {
                    Ssid = Cut(wifi.Ssid, 64), Bssid = Cut(wifi.Bssid, 32), Band = Cut(wifi.Band, 16), Radio = Cut(wifi.Radio, 32),
                },
            },
            Latency = latency with
            {
                Idle = latency.Idle ?? new(),
                Targets = (latency.Targets ?? []).Take(10).Select(t => t with
                {
                    Stats = t.Stats ?? new(), Kind = Cut(t.Kind, 16), Name = Cut(t.Name, 80), Host = Cut(t.Host, 200), Method = Cut(t.Method, 8),
                    Error = Cut(t.Error, 300),
                }).ToList(),
            },
            Dns = (Dns ?? []).Take(10).Select(d => d with
            {
                Host = Cut(d.Host, 200), Error = Cut(d.Error, 300), Addresses = (d.Addresses ?? []).Take(3).Select(a => Cut(a, 64)).ToList(),
            }).ToList(),
            Download = (Download ?? new()).Limited(),
            Upload = (Upload ?? new()).Limited(),
            Warnings = (Warnings ?? []).Take(20).Select(w => Cut(w, 300)).ToList(),
        };
    }

    internal static string Cut(string? s, int max) => s is null ? string.Empty : s.Length > max ? s[..max] : s;
}

public sealed record SpeedTestServer
{
    public string Provider { get; init; } = string.Empty;
    public string Host { get; init; } = string.Empty;
    public string Colo { get; init; } = string.Empty;
    public double DnsMs { get; init; }
    public double ConnectMs { get; init; }
    public double TlsMs { get; init; }
    public double TcpRttMs { get; init; }
}

public sealed record SpeedTestConnection
{
    public string PublicIp { get; init; } = string.Empty;
    public int Asn { get; init; }
    public string City { get; init; } = string.Empty;
    public string Region { get; init; } = string.Empty;
    public string Country { get; init; } = string.Empty;
    public string Timezone { get; init; } = string.Empty;
    public bool Proxy { get; init; }
}

public sealed record SpeedTestNetwork
{
    public string Interface { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string LocalIp { get; init; } = string.Empty;
    public string Mac { get; init; } = string.Empty;
    public int Mtu { get; init; }
    public double LinkMbps { get; init; }
    public string Gateway { get; init; } = string.Empty;
    public List<string> DnsServers { get; init; } = [];
    public SpeedTestWifi? Wifi { get; init; }
}

public sealed record SpeedTestWifi
{
    public string Ssid { get; init; } = string.Empty;
    public string Bssid { get; init; } = string.Empty;
    public int SignalPct { get; init; }
    public int RssiDbm { get; init; }
    public int NoiseDbm { get; init; }
    public int Channel { get; init; }
    public string Band { get; init; } = string.Empty;
    public string Radio { get; init; } = string.Empty;
    public double RxMbps { get; init; }
    public double TxMbps { get; init; }
}

public sealed record SpeedTestStats
{
    public int Samples { get; init; }
    public double MinMs { get; init; }
    public double MedianMs { get; init; }
    public double AvgMs { get; init; }
    public double P90Ms { get; init; }
    public double MaxMs { get; init; }
    public double JitterMs { get; init; }
}

public sealed record SpeedTestLatency
{
    public SpeedTestStats Idle { get; init; } = new();
    public List<SpeedTestTarget> Targets { get; init; } = [];
}

/// <summary>Destino medido: <c>gateway</c> (rede local), <c>internet</c> (DNS publicos) ou <c>server</c> (Cybereyes).</summary>
public sealed record SpeedTestTarget
{
    public string Kind { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Host { get; init; } = string.Empty;
    public string Method { get; init; } = string.Empty;
    public int Sent { get; init; }
    public int Received { get; init; }
    public double LossPct { get; init; }
    public SpeedTestStats Stats { get; init; } = new();
    public string Error { get; init; } = string.Empty;
}

public sealed record SpeedTestDns
{
    public string Host { get; init; } = string.Empty;
    public double Ms { get; init; }
    public List<string> Addresses { get; init; } = [];
    public string Error { get; init; } = string.Empty;
}

public sealed record SpeedTestStage
{
    public long Bytes { get; init; }
    public int Count { get; init; }
    public double MedianMbps { get; init; }
    public double MaxMbps { get; init; }
    public double MedianMs { get; init; }
}

public sealed record SpeedTestDirection
{
    public double Mbps { get; init; }
    public double SingleMbps { get; init; }
    public double MultiMbps { get; init; }
    public int Streams { get; init; }
    public List<SpeedTestStage> Stages { get; init; } = [];
    public List<double> Timeline { get; init; } = [];
    public int TimelineStepMs { get; init; }
    public SpeedTestStats Loaded { get; init; } = new();
    public double RetransPct { get; init; }
    public long Bytes { get; init; }
    public double DurationMs { get; init; }
    public string Error { get; init; } = string.Empty;

    internal SpeedTestDirection Limited() => this with
    {
        Loaded = Loaded ?? new(),
        Stages = (Stages ?? []).Take(10).ToList(),
        Timeline = (Timeline ?? []).Take(240).ToList(),
        Error = SpeedTestReport.Cut(Error, 300),
    };
}
