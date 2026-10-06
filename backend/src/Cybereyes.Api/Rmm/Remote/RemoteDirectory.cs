using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Extensions.Options;
using StackExchange.Redis;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Onde a sessao vive: replica dona, chave de encaminhamento e identidades permitidas (contrato, secao 4.1).</summary>
public sealed record RemoteDirectoryEntry(string Owner, string HopKey, Guid UserId, int AgentPk);

/// <summary>Diretorio das sessoes entre replicas. Sem Redis, so a replica local existe.</summary>
public interface IRemoteDirectory
{
    Task RegisterAsync(string sessionId, RemoteDirectoryEntry entry, TimeSpan ttl);

    Task<RemoteDirectoryEntry?> GetAsync(string sessionId);

    Task RemoveAsync(string sessionId);
}

public sealed class LocalRemoteDirectory : IRemoteDirectory
{
    private readonly ConcurrentDictionary<string, RemoteDirectoryEntry> entries = new(StringComparer.Ordinal);

    public Task RegisterAsync(string sessionId, RemoteDirectoryEntry entry, TimeSpan ttl)
    {
        entries[sessionId] = entry;
        return Task.CompletedTask;
    }

    public Task<RemoteDirectoryEntry?> GetAsync(string sessionId) =>
        Task.FromResult(entries.TryGetValue(sessionId, out var e) ? e : null);

    public Task RemoveAsync(string sessionId)
    {
        entries.TryRemove(sessionId, out _);
        return Task.CompletedTask;
    }
}

public sealed class RedisRemoteDirectory(IConnectionMultiplexer redis) : IRemoteDirectory
{
    private static RedisKey Key(string sessionId) => "cybereyes:remote:session:" + sessionId;

    public Task RegisterAsync(string sessionId, RemoteDirectoryEntry entry, TimeSpan ttl) =>
        redis.GetDatabase().StringSetAsync(Key(sessionId), JsonSerializer.Serialize(entry), ttl);

    public async Task<RemoteDirectoryEntry?> GetAsync(string sessionId)
    {
        var value = await redis.GetDatabase().StringGetAsync(Key(sessionId));
        return value.HasValue ? JsonSerializer.Deserialize<RemoteDirectoryEntry>(value.ToString()) : null;
    }

    public Task RemoveAsync(string sessionId) => redis.GetDatabase().KeyDeleteAsync(Key(sessionId));
}

/// <summary>Endereco interno desta replica, usado pelas outras para encaminhar.</summary>
public sealed class RemoteNode(IOptions<RemoteSettings> options)
{
    private readonly Lazy<string> self = new(() => Resolve(options.Value));

    public string SelfUrl => self.Value;

    private static string Resolve(RemoteSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.AdvertiseUrl))
        {
            return settings.AdvertiseUrl.TrimEnd('/');
        }
        var ip = Dns.GetHostAddresses(Dns.GetHostName())
            .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) ?? IPAddress.Loopback;
        var port = Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS")?.Split(';', ',')[0] is { Length: > 0 } p ? p : "8080";
        return $"http://{ip}:{port}";
    }
}
