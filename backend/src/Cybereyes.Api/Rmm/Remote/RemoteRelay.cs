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
/// visualizador com o remote-helper no canal desktop (ou o cliente RDP do navegador com o EYES no canal rdp) e
/// entrega o canal files ao <see cref="RemoteFilesChannel"/>.
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
        if (channel is not (RemoteFrames.Desktop or RemoteFrames.Files or RemoteFrames.Rdp))
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
        var (role, pending) = await AuthenticateAsync(ctx, end, handle, channel);
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
                handle.FilesReady.TrySetResult();
                if (!handle.HasScreen)
                {
                    // Sessao so de arquivos: fica ativa quando o agente conecta.
                    await manager.SetStateAsync(handle, RemoteSessionState.Active);
                }
                await files.RunAsync(handle.Ended.Token);
                return;
            }
            await RunScreenAsync(end, role, handle, channel == RemoteFrames.Rdp, pending);
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            // fim da conexao
        }
        finally
        {
            if (RemoteFrames.IsScreen(channel) && handle.State != RemoteSessionState.Ended)
            {
                var peer = role == "viewer" ? handle.AgentDesktop : handle.ViewerDesktop;
                // No canal rdp as duas pontas levam RDP puro: sem PEER_GONE, cada uma ve o fechamento.
                if (peer is not null && channel == RemoteFrames.Desktop)
                {
                    await SendJsonAsync(peer, RemoteFrames.PeerGone, new { reason = role == "viewer" ? "viewer" : "agent" }, CancellationToken.None);
                }
                await manager.EndAsync(handle, role == "viewer" ? "technician" : "agent");
            }
        }
    }

    /// <summary>
    /// Le o AUTH e confere token, papel, canal e identidade externa. Devolve o papel ou null (ja fechado). No canal rdp
    /// o visualizador e o cliente RDP do navegador: o token vem no pedido RDCleanPath, que fica guardado para o agente.
    /// </summary>
    private async Task<(string? Role, byte[]? Pending)> AuthenticateAsync(HttpContext ctx, RelayEnd end, RemoteSessionHandle handle, string channel)
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
        byte[]? pending = null;
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
        else if (channel == RemoteFrames.Rdp && frame is not null && RdCleanPath.ReadProxyAuth(frame) is { } token)
        {
            auth = new AuthMessage(token, "rdp-viewer", 1);
            pending = frame;
        }
        var role = auth?.Role == "rdp-viewer" ? "viewer" : auth?.Role;
        var ok = auth is { Proto: >= 1 } && auth.Role switch
        {
            "viewer" => channel == RemoteFrames.Desktop && IsSessionUser(ctx.User, handle) && RemoteTokens.Matches(handle.ViewerTokenHash, auth.Token),
            "rdp-viewer" => IsSessionUser(ctx.User, handle) && RemoteTokens.Matches(handle.ViewerTokenHash, auth.Token),
            "agent" => IsSessionAgent(ctx.User, handle) && RemoteTokens.Matches(handle.AgentTokenHash, auth.Token),
            _ => false,
        };
        var rdpViewer = channel == RemoteFrames.Rdp && auth?.Role != "agent";
        if (!ok || !handle.HasChannel(channel) || time.GetUtcNow() > handle.ConnectDeadline)
        {
            if (rdpViewer && frame is not null)
            {
                await end.SendAsync(RdCleanPath.HttpError(StatusCodes.Status401Unauthorized), CancellationToken.None);
            }
            await end.CloseAsync(RemoteFrames.CloseAuth, "autenticacao invalida");
            return (null, null);
        }
        lock (handle.Gate)
        {
            var used = role == "viewer" ? handle.UsedViewerChannels : handle.UsedAgentChannels;
            if (!used.Add(channel) || handle.State == RemoteSessionState.Ended)
            {
                ok = false;
            }
            else if (RemoteFrames.IsScreen(channel))
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
            if (rdpViewer)
            {
                await end.SendAsync(RdCleanPath.HttpError(StatusCodes.Status409Conflict), CancellationToken.None);
            }
            await end.CloseAsync(RemoteFrames.CloseDuplicate, "canal ja conectado");
            return (null, null);
        }
        if (!rdpViewer)
        {
            await SendJsonAsync(end, RemoteFrames.AuthOk, new { sessionId = handle.SessionId }, handle.Ended.Token);
        }
        return (role, pending);
    }

    private static bool IsSessionUser(ClaimsPrincipal user, RemoteSessionHandle handle) =>
        user.UserId() == handle.UserId && user.IsMfaSatisfied();

    private static bool IsSessionAgent(ClaimsPrincipal user, RemoteSessionHandle handle) =>
        user.FindFirstValue(CybereyesClaims.AgentPk) == handle.AgentPk.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// Canal de tela: emparelha e repassa. No canal rdp (contrato, secao 5.4) o visualizador manda RDP puro, que vai
    /// ao agente como chegou (primeiro o pedido RDCleanPath guardado); do agente so seguem os quadros RdpData, sem o
    /// byte de tipo, e CONSENT e BYE ficam no relay.
    /// </summary>
    private async Task RunScreenAsync(RelayEnd self, string role, RemoteSessionHandle handle, bool rdp, byte[]? pending)
    {
        var bothConnected = false;
        lock (handle.Gate)
        {
            bothConnected = handle.ViewerDesktop is not null && handle.AgentDesktop is not null;
        }
        if (bothConnected && handle.Paired.TrySetResult())
        {
            if (!rdp)
            {
                await SendJsonAsync(handle.ViewerDesktop!, RemoteFrames.Paired, new { }, handle.Ended.Token);
            }
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
            if (rdp && role == "viewer")
            {
                await self.SendAsync(RdCleanPath.HttpError(StatusCodes.Status504GatewayTimeout), CancellationToken.None);
            }
            await self.CloseAsync(RemoteFrames.ClosePeerTimeout, "a outra ponta nao conectou");
            return;
        }
        var peer = role == "viewer" ? handle.AgentDesktop! : handle.ViewerDesktop!;
        if (pending is not null)
        {
            handle.LastActivity = time.GetUtcNow();
            handle.CountToAgent(pending.Length, false);
            await peer.SendAsync(pending, handle.Ended.Token);
        }
        var windowStart = time.GetUtcNow();
        var inWindow = 0;
        var limit = rdp ? RemoteFrames.MaxRdpFrame : RemoteFrames.MaxDesktopFrame;
        while (!handle.Ended.IsCancellationRequested)
        {
            var frame = await ReceiveAsync(self.Socket, limit, handle.Ended.Token);
            if (frame is null)
            {
                return;
            }
            if (frame.Length == 0)
            {
                continue;
            }
            var type = frame[0];
            if (role == "viewer" && rdp)
            {
                // RDP puro: sem limite de quadros por segundo (o cliente junta a entrada em pacotes do proprio RDP).
                handle.LastActivity = time.GetUtcNow();
                handle.CountToAgent(frame.Length, false);
            }
            else if (role == "viewer")
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
            else if (rdp)
            {
                if (type != RemoteFrames.RdpData)
                {
                    await ObserveAgentFrameAsync(handle, type, frame);
                    continue;
                }
                if (handle.FirstFrameAt is null)
                {
                    await manager.MarkFirstFrameAsync(handle);
                }
                handle.CountToViewer(frame.Length - 1, false);
                await peer.SendAsync(frame.AsMemory(1), handle.Ended.Token);
                continue;
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
