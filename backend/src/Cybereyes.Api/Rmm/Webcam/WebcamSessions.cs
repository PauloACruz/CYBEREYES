using System.Buffers;
using System.Collections.Concurrent;
using MessagePack;
using Microsoft.AspNetCore.SignalR;
using NATS.Client.Core;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Rmm.Webcam;

/// <summary>Quadro enviado pelo agente no assunto &lt;agent_id&gt;.webcam.&lt;sessao&gt;.</summary>
public sealed record WebcamFrame(byte[]? Image, bool Done, string? Error);

/// <summary>
/// Sessoes de webcam ao vivo: o navegador fala com o hub SignalR, a API repassa webcam_start/webcam_stop ao agente
/// pelo NATS e devolve cada JPEG recebido no assunto da sessao. Uma camera por agente por vez: webcam_start com um id
/// novo substitui o visualizador antigo. Cada sessao vive na replica que atende a conexao WebSocket do navegador.
/// </summary>
public sealed partial class WebcamSessions(INatsConnection? nats, IAgentRpc rpc, IHubContext<ConsoleHub> hub, ILogger<WebcamSessions> logger)
{
    private sealed record Session(string ConnectionId, string AgentId, string Username, CancellationTokenSource Cancel);

    private readonly ConcurrentDictionary<string, Session> sessions = new(StringComparer.Ordinal);

    public async Task<string> StartAsync(string connectionId, string username, string agentId)
    {
        if (nats is null)
        {
            throw new HubException("NATS nao configurado");
        }

        var sessionId = Guid.NewGuid().ToString("N");
        var session = new Session(connectionId, agentId, username, new CancellationTokenSource());
        sessions[sessionId] = session;

        var ready = new TaskCompletionSource();
        _ = Task.Run(() => PumpAsync(sessionId, session, ready));
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await rpc.PublishAsync(agentId, new Dictionary<string, object?>
        {
            ["func"] = "webcam_start",
            ["payload"] = new Dictionary<string, string> { ["session_id"] = sessionId },
            ["run_as_user"] = false,
        });
        return sessionId;
    }

    public Task PingAsync(string connectionId, string sessionId) =>
        Owned(connectionId, sessionId) is { } s
            ? rpc.PublishAsync(s.AgentId, Command("webcam_start", sessionId))
            : Task.CompletedTask;

    public async Task StopAsync(string connectionId, string sessionId)
    {
        if (Owned(connectionId, sessionId) is not { } s || !sessions.TryRemove(sessionId, out _))
        {
            return;
        }
        await rpc.PublishAsync(s.AgentId, Command("webcam_stop", sessionId));
        await s.Cancel.CancelAsync();
        s.Cancel.Dispose();
    }

    public async Task StopAllAsync(string connectionId)
    {
        foreach (var (id, s) in sessions.Where(kv => kv.Value.ConnectionId == connectionId).ToList())
        {
            await StopAsync(s.ConnectionId, id);
        }
    }

    public string? UsernameOf(string sessionId) => sessions.TryGetValue(sessionId, out var s) ? s.Username : null;

    private Session? Owned(string connectionId, string sessionId) =>
        sessions.TryGetValue(sessionId, out var s) && s.ConnectionId == connectionId ? s : null;

    private static Dictionary<string, object?> Command(string func, string sessionId) => new()
    {
        ["func"] = func,
        ["payload"] = new Dictionary<string, string> { ["session_id"] = sessionId },
    };

    private async Task PumpAsync(string sessionId, Session session, TaskCompletionSource ready)
    {
        var client = hub.Clients.Client(session.ConnectionId);
        try
        {
            await using var sub = await nats!.SubscribeCoreAsync($"{session.AgentId}.webcam.{sessionId}",
                serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: session.Cancel.Token);
            ready.TrySetResult();
            await foreach (var msg in sub.Msgs.ReadAllAsync(session.Cancel.Token))
            {
                if (msg.Data is null || Decode(msg.Data) is not { } frame)
                {
                    continue;
                }
                if (frame.Image is { Length: > 0 } image)
                {
                    await client.SendAsync("webcamFrame", sessionId, Convert.ToBase64String(image), session.Cancel.Token);
                }
                if (frame.Done)
                {
                    sessions.TryRemove(sessionId, out _);
                    await client.SendAsync("webcamClosed", sessionId, frame.Error, CancellationToken.None);
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex) when (ex is NatsException or HubException or InvalidOperationException)
        {
            ready.TrySetException(ex);
            LogPumpFailed(logger, ex, sessionId);
            sessions.TryRemove(sessionId, out _);
            await client.SendAsync("webcamClosed", sessionId, "Falha na sessao de webcam", CancellationToken.None);
        }
    }

    /// <summary>
    /// O agente envia o JPEG como msgpack "bin" (ou "str" nos clientes antigos) e o fim da sessao como mapa
    /// { done, error? }.
    /// </summary>
    public static WebcamFrame? Decode(ReadOnlyMemory<byte> data)
    {
        var reader = new MessagePackReader(data);
        switch (reader.NextMessagePackType)
        {
            case MessagePackType.Binary:
                return new WebcamFrame(reader.ReadBytes()?.ToArray(), false, null);
            case MessagePackType.String:
                return new WebcamFrame(reader.ReadStringSequence()?.ToArray(), false, null);
            case MessagePackType.Map:
                var map = MsgPack.DeserializeMap(data);
                if (map is null)
                {
                    return null;
                }
                return new WebcamFrame(null, map.GetBool("done"), map.GetString("error"));
            default:
                return null;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Sessao de webcam {SessionId} interrompida")]
    private static partial void LogPumpFailed(ILogger logger, Exception ex, string sessionId);
}
