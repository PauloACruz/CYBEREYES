using System.Buffers.Text;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Identidade ja conferida na replica de entrada, levada a replica dona da sessao.</summary>
public sealed record ForwardedPrincipal(string Kind, Guid? UserId, string? Name, bool Mfa, int? AgentPk, string? AgentId)
{
    public const string UserKind = "user";
    public const string AgentKind = "agent";

    public static ForwardedPrincipal? From(ClaimsPrincipal user)
    {
        if (user.FindFirstValue(CybereyesClaims.AgentPk) is { } pk && int.TryParse(pk, out var agentPk))
        {
            return new ForwardedPrincipal(AgentKind, null, user.Identity?.Name, false, agentPk, user.FindFirstValue(CybereyesClaims.AgentIdentifier));
        }
        return user.UserId() is { } id ? new ForwardedPrincipal(UserKind, id, user.Identity?.Name, user.IsMfaSatisfied(), null, null) : null;
    }

    public string Encode() => Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(this));

    public static ForwardedPrincipal? Decode(string value)
    {
        try
        {
            return JsonSerializer.Deserialize<ForwardedPrincipal>(Base64Url.DecodeFromChars(value));
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// Autentica requisicoes encaminhadas entre replicas: a chave da sessao (so no Redis, nunca fora do servidor) prova que a
/// identidade em X-Remote-Principal foi conferida na replica de entrada. As permissoes sao relidas do banco.
/// </summary>
public sealed partial class RemoteForwardAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, IRemoteDirectory directory)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "RemoteForward";
    public const string KeyHeader = "X-Remote-Forward";
    public const string PrincipalHeader = "X-Remote-Principal";

    [GeneratedRegex("^/api/remote/(?:relay|sessions)/([0-9a-f]{32})(?:/|$)")]
    private static partial Regex SessionPath();

    public static bool Matches(HttpRequest request) => request.Headers.ContainsKey(KeyHeader);

    public static string? SessionIdFromPath(PathString path) =>
        SessionPath().Match(path.Value ?? string.Empty) is { Success: true } m ? m.Groups[1].Value : null;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var sessionId = SessionIdFromPath(Request.Path);
        var key = Request.Headers[KeyHeader].ToString();
        if (sessionId is null || await directory.GetAsync(sessionId) is not { } entry
            || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(entry.HopKey), System.Text.Encoding.UTF8.GetBytes(key))
            || ForwardedPrincipal.Decode(Request.Headers[PrincipalHeader].ToString()) is not { } fp)
        {
            return AuthenticateResult.Fail("encaminhamento invalido");
        }
        var claims = new List<Claim>();
        if (fp.Kind == ForwardedPrincipal.AgentKind && fp.AgentPk == entry.AgentPk)
        {
            claims.Add(new Claim(CybereyesClaims.AgentPk, fp.AgentPk.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            claims.Add(new Claim(CybereyesClaims.AgentIdentifier, fp.AgentId ?? string.Empty));
            claims.Add(new Claim(ClaimTypes.Name, fp.Name ?? "agent"));
        }
        else if (fp.Kind == ForwardedPrincipal.UserKind && fp.UserId == entry.UserId)
        {
            claims.Add(new Claim(ClaimTypes.NameIdentifier, fp.UserId.Value.ToString()));
            claims.Add(new Claim(ClaimTypes.Name, fp.Name ?? string.Empty));
            if (fp.Mfa)
            {
                claims.Add(new Claim(CybereyesClaims.AuthMethods, CybereyesClaims.Mfa));
            }
        }
        else
        {
            return AuthenticateResult.Fail("identidade fora da sessao");
        }
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }
}

/// <summary>
/// Encaminha para a replica dona as conexoes e rotas de uma sessao que vive em outra replica (prova S3: o hash do
/// Nginx nao funciona com resolve). Sem Redis, nao ha outras replicas e nada e encaminhado.
/// </summary>
public sealed class RemoteForwarder(IRemoteDirectory directory, RemoteNode node, IHttpClientFactory http)
{
    public const string HttpClientName = "remote-forward";

    private static readonly string[] RequestHeaders = ["Content-Type", "Content-Range", "Range", "Content-Length"];
    private static readonly string[] ResponseHeaders = ["Content-Type", "Content-Range", "Content-Disposition", "Accept-Ranges", "Content-Length"];

    /// <summary>Confere a identidade externa contra o dono da sessao e monta os cabecalhos de encaminhamento.</summary>
    private async Task<(RemoteDirectoryEntry Entry, ForwardedPrincipal Principal)?> ResolveAsync(HttpContext ctx, string sessionId)
    {
        if (await directory.GetAsync(sessionId) is not { } entry || entry.Owner == node.SelfUrl)
        {
            return null;
        }
        var fp = ForwardedPrincipal.From(ctx.User);
        var allowed = fp switch
        {
            { Kind: ForwardedPrincipal.AgentKind } => fp.AgentPk == entry.AgentPk,
            { Kind: ForwardedPrincipal.UserKind } => fp.UserId == entry.UserId && fp.Mfa,
            _ => false,
        };
        return allowed ? (entry, fp!) : null;
    }

    public async Task<bool> TryForwardWebSocketAsync(HttpContext ctx, string sessionId)
    {
        if (await ResolveAsync(ctx, sessionId) is not { } target)
        {
            return false;
        }
        using var upstream = new ClientWebSocket();
        upstream.Options.SetRequestHeader(RemoteForwardAuthenticationHandler.KeyHeader, target.Entry.HopKey);
        upstream.Options.SetRequestHeader(RemoteForwardAuthenticationHandler.PrincipalHeader, target.Principal.Encode());
        var uri = new Uri(target.Entry.Owner.Replace("http://", "ws://", StringComparison.Ordinal).Replace("https://", "wss://", StringComparison.Ordinal)
            + ctx.Request.Path + ctx.Request.QueryString);
        try
        {
            await upstream.ConnectAsync(uri, ctx.RequestAborted);
        }
        catch (WebSocketException)
        {
            ctx.Response.StatusCode = StatusCodes.Status502BadGateway;
            return true;
        }
        using var client = await ctx.WebSockets.AcceptWebSocketAsync();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        var a = PumpAsync(client, upstream, cts.Token);
        var b = PumpAsync(upstream, client, cts.Token);
        await Task.WhenAny(a, b);
        await cts.CancelAsync();
        return true;
    }

    private static async Task PumpAsync(WebSocket from, WebSocket to, CancellationToken ct)
    {
        var buffer = new byte[64 << 10];
        try
        {
            while (true)
            {
                var result = await from.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    if (to.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    {
                        await to.CloseOutputAsync(from.CloseStatus ?? WebSocketCloseStatus.NormalClosure, from.CloseStatusDescription, CancellationToken.None);
                    }
                    return;
                }
                await to.SendAsync(buffer.AsMemory(0, result.Count), result.MessageType, result.EndOfMessage, ct);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            // uma das pontas caiu
        }
    }

    /// <summary>Encaminha uma rota REST da sessao, em streaming nos dois sentidos.</summary>
    public async Task<bool> TryForwardHttpAsync(HttpContext ctx, string sessionId)
    {
        if (await ResolveAsync(ctx, sessionId) is not { } target)
        {
            return false;
        }
        using var request = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), target.Entry.Owner + ctx.Request.Path + ctx.Request.QueryString);
        if (ctx.Request.ContentLength > 0 || ctx.Request.Headers.TransferEncoding.Count > 0)
        {
            request.Content = new StreamContent(ctx.Request.Body);
        }
        foreach (var name in RequestHeaders)
        {
            if (ctx.Request.Headers.TryGetValue(name, out var value) && !request.Headers.TryAddWithoutValidation(name, value.ToArray()))
            {
                request.Content?.Headers.TryAddWithoutValidation(name, value.ToArray());
            }
        }
        request.Headers.TryAddWithoutValidation(RemoteForwardAuthenticationHandler.KeyHeader, target.Entry.HopKey);
        request.Headers.TryAddWithoutValidation(RemoteForwardAuthenticationHandler.PrincipalHeader, target.Principal.Encode());
        using var response = await http.CreateClient(HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
        ctx.Response.StatusCode = (int)response.StatusCode;
        foreach (var name in ResponseHeaders)
        {
            if (response.Headers.TryGetValues(name, out var values) || response.Content.Headers.TryGetValues(name, out values))
            {
                ctx.Response.Headers[name] = values.ToArray();
            }
        }
        await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
        return true;
    }

    /// <summary>Filtro das rotas /api/remote/sessions/{sessionId}/...: atende local ou encaminha para a dona.</summary>
    public static async ValueTask<object?> Filter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var ctx = context.HttpContext;
        var sessionId = ctx.Request.RouteValues["sessionId"] as string ?? string.Empty;
        var manager = ctx.RequestServices.GetRequiredService<RemoteSessionManager>();
        if (manager.TryGet(sessionId, out _))
        {
            return await next(context);
        }
        var forwarder = ctx.RequestServices.GetRequiredService<RemoteForwarder>();
        if (await forwarder.TryForwardHttpAsync(ctx, sessionId))
        {
            return Results.Empty;
        }
        return await next(context);
    }
}
