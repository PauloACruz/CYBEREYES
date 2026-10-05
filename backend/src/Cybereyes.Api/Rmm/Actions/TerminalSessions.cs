using System.Buffers;
using System.Collections.Concurrent;
using MessagePack;
using Microsoft.AspNetCore.SignalR;
using NATS.Client.Core;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Rmm.Actions;

/// <summary>Quadro enviado pelo agente no assunto &lt;agent_id&gt;.terminal.&lt;sessao&gt;.</summary>
public sealed record TerminalFrame(byte[]? Output, bool Done, int ExitCode);

/// <summary>
/// Sessoes de terminal: o navegador fala com o hub SignalR, a API repassa ao agente pelo NATS e devolve a saida
/// do terminal como bytes crus (base64), sem decodificar texto, para nao quebrar caracteres divididos entre blocos.
/// Cada sessao vive na replica que atende a conexao WebSocket do navegador.
/// </summary>
public sealed partial class TerminalSessions(INatsConnection? nats, IAgentRpc rpc, IHubContext<ConsoleHub> hub, ILogger<TerminalSessions> logger)
{
    private sealed record Session(string ConnectionId, string AgentId, string Username, CancellationTokenSource Cancel);

    private readonly ConcurrentDictionary<string, Session> sessions = new(StringComparer.Ordinal);

    public async Task<string> StartAsync(string connectionId, string username, string agentId, string shell, int cols, int rows)
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
            ["func"] = "terminal_start",
            ["payload"] = new Dictionary<string, string> { ["session_id"] = sessionId, ["shell"] = shell },
            ["run_as_user"] = false,
        });
        await ResizeAsync(connectionId, sessionId, cols, rows);
        return sessionId;
    }

    public Task InputAsync(string connectionId, string sessionId, string data) =>
        Owned(connectionId, sessionId) is { } s && data.Length > 0
            ? rpc.PublishAsync(s.AgentId, Command("terminal_input", sessionId, new() { ["data"] = data }))
            : Task.CompletedTask;

    public Task ResizeAsync(string connectionId, string sessionId, int cols, int rows) =>
        Owned(connectionId, sessionId) is { } s && cols > 0 && rows > 0
            ? rpc.PublishAsync(s.AgentId, Command("terminal_resize", sessionId, new()
            {
                ["cols"] = cols.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["rows"] = rows.ToString(System.Globalization.CultureInfo.InvariantCulture),
            }))
            : Task.CompletedTask;

    public async Task StopAsync(string connectionId, string sessionId)
    {
        if (Owned(connectionId, sessionId) is not { } s || !sessions.TryRemove(sessionId, out _))
        {
            return;
        }
        await rpc.PublishAsync(s.AgentId, Command("terminal_kill", sessionId, []));
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

    private static Dictionary<string, object?> Command(string func, string sessionId, Dictionary<string, string> payload)
    {
        payload["session_id"] = sessionId;
        return new Dictionary<string, object?> { ["func"] = func, ["payload"] = payload };
    }

    private async Task PumpAsync(string sessionId, Session session, TaskCompletionSource ready)
    {
        var client = hub.Clients.Client(session.ConnectionId);
        try
        {
            await using var sub = await nats!.SubscribeCoreAsync($"{session.AgentId}.terminal.{sessionId}",
                serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: session.Cancel.Token);
            ready.TrySetResult();
            await foreach (var msg in sub.Msgs.ReadAllAsync(session.Cancel.Token))
            {
                if (msg.Data is null || Decode(msg.Data) is not { } frame)
                {
                    continue;
                }
                if (frame.Output is { Length: > 0 } output)
                {
                    await client.SendAsync("terminalOutput", sessionId, Convert.ToBase64String(output), session.Cancel.Token);
                }
                if (frame.Done)
                {
                    sessions.TryRemove(sessionId, out _);
                    await client.SendAsync("terminalClosed", sessionId, frame.ExitCode, (string?)null, CancellationToken.None);
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
            await client.SendAsync("terminalClosed", sessionId, 1, "Falha na sessao de terminal", CancellationToken.None);
        }
    }

    /// <summary>
    /// O agente envia a saida como msgpack "str" (formato antigo, bytes crus) ou "bin", e o fim da sessao como mapa
    /// { done, exit_code, output? }.
    /// </summary>
    public static TerminalFrame? Decode(ReadOnlyMemory<byte> data)
    {
        var reader = new MessagePackReader(data);
        switch (reader.NextMessagePackType)
        {
            case MessagePackType.String:
                return new TerminalFrame(reader.ReadStringSequence()?.ToArray(), false, 0);
            case MessagePackType.Binary:
                return new TerminalFrame(reader.ReadBytes()?.ToArray(), false, 0);
            case MessagePackType.Map:
                var map = MsgPack.DeserializeMap(data);
                if (map is null)
                {
                    return null;
                }
                var output = map.GetString("output");
                return new TerminalFrame(output is null ? null : System.Text.Encoding.UTF8.GetBytes(output), map.GetBool("done"),
                    (int)(map.GetNumber("exit_code") ?? 0));
            default:
                return null;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Sessao de terminal {SessionId} interrompida")]
    private static partial void LogPumpFailed(ILogger logger, Exception ex, string sessionId);
}
