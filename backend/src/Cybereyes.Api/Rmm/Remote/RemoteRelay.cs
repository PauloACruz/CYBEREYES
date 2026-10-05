using System.Buffers;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Text.Json;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>
/// Relay WebSocket do acesso remoto (contrato, secao 4): autentica cada ponta pelo primeiro quadro, emparelha o
/// visualizador com o remote-helper no canal desktop e entrega o canal files ao <see cref="RemoteFilesChannel"/>.
/// So le o tipo de cada quadro, salvo AUTH, CLIPBOARD, CONSENT e BYE (contagem, estado e auditoria).
/// </summary>
public sealed class RemoteRelay(RemoteSessionManager manager, RemoteForwarder forwarder, TimeProvider time)
{
    private sealed record AuthMessage(string? Token, string? Role, int Proto);

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task HandleAsync(HttpContext ctx, string sessionId, string channel)
    {
        if (!ctx.WebSockets.IsWebSocketRequest)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        if (channel is not (RemoteFrames.Desktop or RemoteFrames.Files))
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        if (!manager.TryGet(sessionId, out var handle))
        {
            if (await forwarder.TryForwardWebSocketAsync(ctx, sessionId))
            {
                return;
            }
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
        using var end = new RelayEnd(socket);
        var role = await AuthenticateAsync(ctx, end, handle, channel);
        if (role is null)
        {
            return;
        }
        try
        {
            if (channel == RemoteFrames.Files)
            {
                var files = new RemoteFilesChannel(end, handle, time);
                handle.Files = files;
                await files.RunAsync(handle.Ended.Token);
                return;
            }
            await RunDesktopAsync(end, role, handle);
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            // fim da conexao
        }
        finally
        {
            if (channel == RemoteFrames.Desktop && handle.State != RemoteSessionState.Ended)
            {
                var peer = role == "viewer" ? handle.AgentDesktop : handle.ViewerDesktop;
                if (peer is not null)
                {
                    await SendJsonAsync(peer, RemoteFrames.PeerGone, new { reason = role == "viewer" ? "viewer" : "agent" }, CancellationToken.None);
                }
                await manager.EndAsync(handle, role == "viewer" ? "technician" : "agent");
            }
        }
    }

    /// <summary>Le o AUTH e confere token, papel, canal e identidade externa. Devolve o papel ou null (ja fechado).</summary>
    private async Task<string?> AuthenticateAsync(HttpContext ctx, RelayEnd end, RemoteSessionHandle handle, string channel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(handle.Ended.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        byte[]? frame;
        try
        {
            frame = await ReceiveAsync(end.Socket, 64 << 10, timeout.Token);
        }
        catch (Exception ex) when (ex is OperationCanceledException or WebSocketException)
        {
            frame = null;
        }
        AuthMessage? auth = null;
        if (frame is { Length: > 1 } && frame[0] == RemoteFrames.Auth)
        {
            try
            {
                auth = JsonSerializer.Deserialize<AuthMessage>(frame.AsSpan(1), Web);
            }
            catch (JsonException)
            {
                auth = null;
            }
        }
        var role = auth?.Role;
        var ok = auth is { Proto: >= 1 } && role switch
        {
            "viewer" => channel == RemoteFrames.Desktop && IsSessionUser(ctx.User, handle) && RemoteTokens.Matches(handle.ViewerTokenHash, auth.Token),
            "agent" => IsSessionAgent(ctx.User, handle) && RemoteTokens.Matches(handle.AgentTokenHash, auth.Token),
            _ => false,
        };
        if (!ok || !handle.HasChannel(channel) || time.GetUtcNow() > handle.ConnectDeadline)
        {
            await end.CloseAsync(RemoteFrames.CloseAuth, "autenticacao invalida");
            return null;
        }
        lock (handle.Gate)
        {
            var used = role == "viewer" ? handle.UsedViewerChannels : handle.UsedAgentChannels;
            if (!used.Add(channel) || handle.State == RemoteSessionState.Ended)
            {
                ok = false;
            }
            else if (channel == RemoteFrames.Desktop)
            {
                if (role == "viewer")
                {
                    handle.ViewerDesktop = end;
                }
                else
                {
                    handle.AgentDesktop = end;
                }
            }
        }
        if (!ok)
        {
            await end.CloseAsync(RemoteFrames.CloseDuplicate, "canal ja conectado");
            return null;
        }
        await SendJsonAsync(end, RemoteFrames.AuthOk, new { sessionId = handle.SessionId }, handle.Ended.Token);
        return role;
    }

    private static bool IsSessionUser(ClaimsPrincipal user, RemoteSessionHandle handle) =>
        user.UserId() == handle.UserId && user.IsMfaSatisfied();

    private static bool IsSessionAgent(ClaimsPrincipal user, RemoteSessionHandle handle) =>
        user.FindFirstValue(CybereyesClaims.AgentPk) == handle.AgentPk.ToString(System.Globalization.CultureInfo.InvariantCulture);

    private async Task RunDesktopAsync(RelayEnd self, string role, RemoteSessionHandle handle)
    {
        var bothConnected = false;
        lock (handle.Gate)
        {
            bothConnected = handle.ViewerDesktop is not null && handle.AgentDesktop is not null;
        }
        if (bothConnected && handle.Paired.TrySetResult())
        {
            await SendJsonAsync(handle.ViewerDesktop!, RemoteFrames.Paired, new { }, handle.Ended.Token);
            await SendJsonAsync(handle.AgentDesktop!, RemoteFrames.Paired, new { }, handle.Ended.Token);
            await manager.SetStateAsync(handle, RemoteSessionState.Active);
        }
        var wait = handle.ConnectDeadline - time.GetUtcNow();
        try
        {
            await handle.Paired.Task.WaitAsync(wait > TimeSpan.Zero ? wait : TimeSpan.Zero, handle.Ended.Token);
        }
        catch (TimeoutException)
        {
            await self.CloseAsync(RemoteFrames.ClosePeerTimeout, "a outra ponta nao conectou");
            return;
        }
        var peer = role == "viewer" ? handle.AgentDesktop! : handle.ViewerDesktop!;
        var windowStart = time.GetUtcNow();
        var inWindow = 0;
        while (!handle.Ended.IsCancellationRequested)
        {
            var frame = await ReceiveAsync(self.Socket, RemoteFrames.MaxDesktopFrame, handle.Ended.Token);
            if (frame is null)
            {
                return;
            }
            if (frame.Length == 0)
            {
                continue;
            }
            var type = frame[0];
            if (role == "viewer")
            {
                var now = time.GetUtcNow();
                if (now - windowStart >= TimeSpan.FromSeconds(1))
                {
                    windowStart = now;
                    inWindow = 0;
                }
                if (++inWindow > RemoteFrames.MaxViewerFramesPerSecond)
                {
                    await self.CloseAsync(RemoteFrames.CloseRate, "quadros demais");
                    return;
                }
                if (type is >= RemoteFrames.FirstInput and <= RemoteFrames.LastInput or RemoteFrames.Clipboard)
                {
                    handle.LastActivity = now;
                }
                handle.CountToAgent(frame.Length, type == RemoteFrames.Clipboard);
            }
            else
            {
                await ObserveAgentFrameAsync(handle, type, frame);
                handle.CountToViewer(frame.Length, type == RemoteFrames.Clipboard);
            }
            await peer.SendAsync(frame, handle.Ended.Token);
        }
    }

    private async Task ObserveAgentFrameAsync(RemoteSessionHandle handle, byte type, byte[] frame)
    {
        switch (type)
        {
            case RemoteFrames.FrameEnd when handle.FirstFrameAt is null:
                await manager.MarkFirstFrameAsync(handle);
                break;
            case RemoteFrames.Consent:
                var state = ReadString(frame, "state");
                if (state == "waiting")
                {
                    await manager.SetStateAsync(handle, RemoteSessionState.WaitingConsent);
                }
                else if (state is "accepted" or "denied" or "timeout")
                {
                    handle.ConsentResult = state;
                    await manager.SetStateAsync(handle, RemoteSessionState.Active);
                    if (state != "accepted")
                    {
                        _ = Task.Run(() => manager.EndAsync(handle, "consent-" + state));
                    }
                }
                break;
            case RemoteFrames.Bye:
                var reason = ReadString(frame, "reason") ?? "agent";
                _ = Task.Run(async () =>
                {
                    await Task.Delay(200);
                    await manager.EndAsync(handle, reason == "user" ? "user" : "agent", notifyAgent: false);
                });
                break;
        }
    }

    private static string? ReadString(byte[] frame, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(frame.AsMemory(1));
            return doc.RootElement.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static Task SendJsonAsync(RelayEnd end, byte type, object body, CancellationToken ct)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(body, Web);
        var frame = new byte[json.Length + 1];
        frame[0] = type;
        json.CopyTo(frame, 1);
        return end.SendAsync(frame, ct);
    }

    /// <summary>Le uma mensagem inteira. Devolve null no fechamento; fecha com 4413 acima do limite.</summary>
    public static async Task<byte[]?> ReceiveAsync(WebSocket socket, int limit, CancellationToken ct)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(64 << 10);
        try
        {
            using var stream = new MemoryStream();
            while (true)
            {
                var result = await socket.ReceiveAsync(buffer.AsMemory(), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return null;
                }
                if (stream.Length + result.Count > limit)
                {
                    await socket.CloseOutputAsync((WebSocketCloseStatus)RemoteFrames.CloseTooLarge, "quadro grande demais", CancellationToken.None);
                    return null;
                }
                stream.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    return stream.ToArray();
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }
}
