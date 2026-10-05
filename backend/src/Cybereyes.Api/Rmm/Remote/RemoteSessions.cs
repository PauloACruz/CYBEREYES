using System.Collections.Concurrent;
using System.Globalization;
using System.Net.WebSockets;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Uma ponta conectada ao relay. Envios serializados: WebSocket nao aceita dois envios ao mesmo tempo.</summary>
public sealed class RelayEnd(WebSocket socket) : IDisposable
{
    private readonly SemaphoreSlim sendLock = new(1, 1);

    public WebSocket Socket { get; } = socket;

    public async Task SendAsync(ReadOnlyMemory<byte> frame, CancellationToken ct)
    {
        await sendLock.WaitAsync(ct);
        try
        {
            await Socket.SendAsync(frame, WebSocketMessageType.Binary, true, ct);
        }
        finally
        {
            sendLock.Release();
        }
    }

    public void Dispose() => sendLock.Dispose();

    public async Task CloseAsync(int code, string reason)
    {
        if (Socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived))
        {
            return;
        }
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await sendLock.WaitAsync(timeout.Token);
            try
            {
                await Socket.CloseOutputAsync((WebSocketCloseStatus)code, reason, timeout.Token);
            }
            finally
            {
                sendLock.Release();
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // a outra ponta ja caiu
        }
    }
}

/// <summary>Estado em memoria de uma sessao na replica dona.</summary>
public sealed class RemoteSessionHandle
{
    public required string SessionId { get; init; }
    public required int AgentPk { get; init; }
    public required string AgentId { get; init; }
    public required string Hostname { get; init; }
    public required Guid UserId { get; init; }
    public required string Username { get; init; }
    public required IReadOnlyList<string> Channels { get; init; }
    public required bool ViewOnly { get; init; }
    public required EffectiveRemotePolicy Policy { get; init; }
    public int? TicketId { get; init; }
    public required byte[] ViewerTokenHash { get; init; }
    public required byte[] AgentTokenHash { get; init; }
    public required string HopKey { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset ConnectDeadline { get; init; }

    public object Gate { get; } = new();
    public HashSet<string> UsedViewerChannels { get; } = new(StringComparer.Ordinal);
    public HashSet<string> UsedAgentChannels { get; } = new(StringComparer.Ordinal);
    public RelayEnd? ViewerDesktop { get; set; }
    public RelayEnd? AgentDesktop { get; set; }
    public TaskCompletionSource Paired { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public RemoteFilesChannel? Files { get; set; }
    public CancellationTokenSource Ended { get; } = new();
    public string State { get; set; } = RemoteSessionState.Starting;
    public string? ConsentResult { get; set; }
    public DateTimeOffset? FirstFrameAt { get; set; }
    public DateTimeOffset LastActivity { get; set; }
    private long bytesToViewer;
    private long bytesToAgent;
    private int clipboardToRemote;
    private int clipboardToLocal;

    public long BytesToViewer => Interlocked.Read(ref bytesToViewer);
    public long BytesToAgent => Interlocked.Read(ref bytesToAgent);
    public int ClipboardToRemote => Volatile.Read(ref clipboardToRemote);
    public int ClipboardToLocal => Volatile.Read(ref clipboardToLocal);

    public void CountToViewer(int bytes, bool clipboard)
    {
        Interlocked.Add(ref bytesToViewer, bytes);
        if (clipboard)
        {
            Interlocked.Increment(ref clipboardToLocal);
        }
    }

    public void CountToAgent(int bytes, bool clipboard)
    {
        Interlocked.Add(ref bytesToAgent, bytes);
        if (clipboard)
        {
            Interlocked.Increment(ref clipboardToRemote);
        }
    }

    public bool HasChannel(string channel) => Channels.Contains(channel, StringComparer.Ordinal);
}

/// <summary>Sessoes de acesso remoto desta replica: criacao, encerramento, auditoria e avisos ao console.</summary>
public sealed partial class RemoteSessionManager(
    IServiceScopeFactory scopes, IRemoteDirectory directory, RemoteNode node, IAgentRpc rpc, IHubContext<ConsoleHub> hub,
    IOptions<RemoteSettings> options, TimeProvider time, ILogger<RemoteSessionManager> logger)
{
    private readonly ConcurrentDictionary<string, RemoteSessionHandle> sessions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<Guid, Queue<DateTimeOffset>> creations = new();

    public RemoteSettings Settings => options.Value;

    public IEnumerable<RemoteSessionHandle> Local => sessions.Values;

    public bool TryGet(string sessionId, out RemoteSessionHandle handle) => sessions.TryGetValue(sessionId, out handle!);

    /// <summary>Limite de criacoes por minuto por tecnico (contrato, secao 10), contado nesta replica.</summary>
    public bool AllowCreate(Guid userId)
    {
        var now = time.GetUtcNow();
        var queue = creations.GetOrAdd(userId, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            while (queue.Count > 0 && now - queue.Peek() > TimeSpan.FromMinutes(1))
            {
                queue.Dequeue();
            }
            if (queue.Count >= Settings.MaxCreatePerMinute)
            {
                return false;
            }
            queue.Enqueue(now);
            return true;
        }
    }

    public async Task<RemoteSessionHandle> RegisterAsync(RemoteSessionHandle handle)
    {
        handle.LastActivity = handle.CreatedAt;
        sessions[handle.SessionId] = handle;
        await directory.RegisterAsync(handle.SessionId, new RemoteDirectoryEntry(node.SelfUrl, handle.HopKey, handle.UserId, handle.AgentPk),
            TimeSpan.FromHours(handle.Policy.MaxHours + 1));
        await NotifyAsync(handle);
        return handle;
    }

    public async Task SetStateAsync(RemoteSessionHandle handle, string state)
    {
        lock (handle.Gate)
        {
            if (handle.State == RemoteSessionState.Ended || handle.State == state)
            {
                return;
            }
            handle.State = state;
        }
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        await db.RemoteSessions.Where(s => s.SessionId == handle.SessionId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.State, state).SetProperty(x => x.ConsentResult, handle.ConsentResult));
        await NotifyAsync(handle);
    }

    public async Task MarkFirstFrameAsync(RemoteSessionHandle handle)
    {
        var now = time.GetUtcNow();
        lock (handle.Gate)
        {
            if (handle.FirstFrameAt is not null)
            {
                return;
            }
            handle.FirstFrameAt = now;
        }
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        await db.RemoteSessions.Where(s => s.SessionId == handle.SessionId).ExecuteUpdateAsync(s => s.SetProperty(x => x.FirstFrameAt, now));
    }

    /// <summary>Encerra a sessao uma unica vez: fecha as pontas, avisa o agente, grava e audita.</summary>
    public async Task EndAsync(RemoteSessionHandle handle, string reason, bool notifyAgent = true)
    {
        lock (handle.Gate)
        {
            if (handle.State == RemoteSessionState.Ended)
            {
                return;
            }
            handle.State = RemoteSessionState.Ended;
        }
        sessions.TryRemove(handle.SessionId, out _);
        // Primeiro o aviso de fechamento as pontas; so depois o cancelamento, que encerra os lacos e descarta os sockets.
        foreach (var end in new[] { handle.ViewerDesktop, handle.AgentDesktop })
        {
            if (end is not null)
            {
                await end.CloseAsync(RemoteFrames.CloseEnded, reason);
            }
        }
        if (handle.Files is { } files)
        {
            await files.CloseAsync(RemoteFrames.CloseEnded, reason);
        }
        await handle.Ended.CancelAsync();
        handle.Paired.TrySetCanceled();
        if (notifyAgent)
        {
            try
            {
                await rpc.PublishAsync(handle.AgentId, new Dictionary<string, object?>
                {
                    ["func"] = "remote_stop",
                    ["payload"] = new Dictionary<string, string> { ["session_id"] = handle.SessionId, ["reason"] = reason },
                });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogStopFailed(logger, handle.SessionId, ex);
            }
        }
        await directory.RemoveAsync(handle.SessionId);

        var now = time.GetUtcNow();
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.RemoteSessions.Where(s => s.SessionId == handle.SessionId).ExecuteUpdateAsync(s => s
                .SetProperty(x => x.State, RemoteSessionState.Ended)
                .SetProperty(x => x.EndedAt, now)
                .SetProperty(x => x.EndReason, reason)
                .SetProperty(x => x.ConsentResult, handle.ConsentResult)
                .SetProperty(x => x.BytesToViewer, handle.BytesToViewer)
                .SetProperty(x => x.BytesToAgent, handle.BytesToAgent)
                .SetProperty(x => x.ClipboardToRemote, handle.ClipboardToRemote)
                .SetProperty(x => x.ClipboardToLocal, handle.ClipboardToLocal));
            var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
            var minutes = Math.Max(0, (int)Math.Round((now - handle.CreatedAt).TotalMinutes));
            await audit.LogAsync("remote.session-end", "agent", handle.AgentPk.ToString(CultureInfo.InvariantCulture),
                string.Create(CultureInfo.InvariantCulture,
                    $"Fim do acesso remoto a {handle.Hostname} ({reason}, {minutes} min, area de transferencia {handle.ClipboardToRemote}/{handle.ClipboardToLocal})"),
                username: handle.Username);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogPersistFailed(logger, handle.SessionId, ex);
        }
        await NotifyAsync(handle);
    }

    private Task NotifyAsync(RemoteSessionHandle handle) =>
        hub.Clients.All.SendAsync("remoteSessionChanged",
            new { agentId = handle.AgentPk, sessionId = handle.SessionId, state = handle.State, user = handle.Username });

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao avisar o agente do fim da sessao remota {SessionId}")]
    private static partial void LogStopFailed(ILogger logger, string sessionId, Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao gravar o fim da sessao remota {SessionId}")]
    private static partial void LogPersistFailed(ILogger logger, string sessionId, Exception ex);
}

/// <summary>Encerra sessoes vencidas, ociosas, sem pontas conectadas ou de tecnicos que perderam a permissao.</summary>
public sealed class RemoteSessionReaper(RemoteSessionManager manager, IRemoteDirectory directory, IServiceScopeFactory scopes, TimeProvider time) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15), time);
        var lastPermissionCheck = DateTimeOffset.MinValue;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var now = time.GetUtcNow();
            foreach (var s in manager.Local.ToList())
            {
                var waitingDesktop = s.HasChannel(RemoteFrames.Desktop) && !s.Paired.Task.IsCompleted;
                if (waitingDesktop && now > s.ConnectDeadline && s.State != RemoteSessionState.WaitingConsent)
                {
                    await manager.EndAsync(s, "timeout");
                }
                else if (now - s.LastActivity > TimeSpan.FromMinutes(s.Policy.IdleMinutes) || now - s.CreatedAt > TimeSpan.FromHours(s.Policy.MaxHours))
                {
                    await manager.EndAsync(s, "timeout");
                }
            }
            if (now - lastPermissionCheck > TimeSpan.FromMinutes(1))
            {
                lastPermissionCheck = now;
                await RevokeAsync(stoppingToken);
                await CloseOrphansAsync(stoppingToken);
            }
        }
    }

    /// <summary>Sessoes abertas no banco cuja replica dona sumiu (reinicio) sao fechadas como "server".</summary>
    private async Task CloseOrphansAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var cutoff = time.GetUtcNow().AddMinutes(-2);
        var open = await db.RemoteSessions.AsNoTracking().Where(s => s.State != RemoteSessionState.Ended && s.StartedAt < cutoff)
            .Select(s => s.SessionId).ToListAsync(ct);
        foreach (var id in open)
        {
            if (!manager.TryGet(id, out _) && await directory.GetAsync(id) is null)
            {
                var now = time.GetUtcNow();
                await db.RemoteSessions.Where(s => s.SessionId == id && s.State != RemoteSessionState.Ended).ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.State, RemoteSessionState.Ended).SetProperty(x => x.EndedAt, now).SetProperty(x => x.EndReason, "server"), ct);
            }
        }
    }

    private async Task RevokeAsync(CancellationToken ct)
    {
        var active = manager.Local.ToList();
        if (active.Count == 0)
        {
            return;
        }
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var userIds = active.Select(s => s.UserId).Distinct().ToList();
        var allowed = await RemoteAccess.UsersWithPermissionsAsync(db, userIds, ct);
        foreach (var s in active)
        {
            var needs = s.HasChannel(RemoteFrames.Desktop) ? Core.Security.Permissions.AgentsRemote : Core.Security.Permissions.AgentsFiles;
            if (!allowed.TryGetValue(s.UserId, out var perms) || !perms.Contains(needs))
            {
                await manager.EndAsync(s, "permission");
            }
        }
    }
}
