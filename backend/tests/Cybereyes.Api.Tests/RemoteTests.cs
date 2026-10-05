using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Remote;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Tests;

/// <summary>Acesso remoto proprio (docs/remoto/contrato-remoto.md): sessoes, relay e politicas com agente simulado no NATS.</summary>
public sealed partial class AgentTests
{
    private sealed record RemoteAgent(HttpClient Admin, string ApiKey, int Pk, string AgentId, string Token, FakeAgent Fake);

    private sealed record SessionBody(string SessionId, string RelayUrl, string ViewerToken, string State, string Consent);

    /// <summary>Agente online, versao com acesso remoto, respondendo remote_start com a resposta pedida.</summary>
    private async Task<RemoteAgent> RemoteAgentAsync(string client, string startReply = "ok", string version = "3.1.0")
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var (agentId, pk, token) = await RegisterAgentAsync(installer, siteId, $"host-{client}");
        var nats = await ConnectAsAgentAsync(agentId, token);
        var fake = new FakeAgent(nats, agentId, r => r.GetString("func") == "remote_start" ? startReply : null);
        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.Agents.Where(a => a.Id == pk).ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Status, AgentStatus.Online).SetProperty(a => a.Version, version).SetProperty(a => a.LastSeen, DateTimeOffset.UtcNow));
        }
        var key = await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "remoto-" + client })).Content.ReadFromJsonAsync<KeyOnly>();
        return new RemoteAgent(admin, key!.Key, pk, agentId, token, fake);
    }

    private HttpClient ApiKeyClient(string key)
    {
        var http = fixture.NewClient();
        http.DefaultRequestHeaders.Add("X-API-KEY", key);
        return http;
    }

    private async Task<WebSocket> ConnectRelayAsync(string sessionId, string channel, string header, string value)
    {
        var ws = fixture.Server.CreateWebSocketClient();
        ws.ConfigureRequest = r => r.Headers[header] = value;
        return await ws.ConnectAsync(new Uri($"ws://localhost/api/remote/relay/{sessionId}/{channel}"), CancellationToken.None);
    }

    private static Task SendFrameAsync(WebSocket ws, byte type, object body) =>
        ws.SendAsync(Frame(type, JsonSerializer.SerializeToUtf8Bytes(body)), WebSocketMessageType.Binary, true, CancellationToken.None);

    private static byte[] Frame(byte type, byte[] body)
    {
        var frame = new byte[body.Length + 1];
        frame[0] = type;
        body.CopyTo(frame, 1);
        return frame;
    }

    private static async Task<(byte Type, byte[] Body)?> ReceiveFrameAsync(WebSocket ws, int seconds = 10)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        var buffer = new byte[1 << 20];
        using var stream = new MemoryStream();
        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, cts.Token);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }
            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
            {
                var all = stream.ToArray();
                return (all[0], all[1..]);
            }
        }
    }

    private async Task<SessionBody> CreateSessionAsync(RemoteAgent agent, object? body = null)
    {
        using var http = ApiKeyClient(agent.ApiKey);
        var response = await http.PostAsJsonAsync($"/api/agents/{agent.Pk}/remote/sessions", body ?? new { channels = new[] { "desktop" } });
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<SessionBody>())!;
    }

    private async Task<RemoteSession> SessionRowAsync(string sessionId)
    {
        await using var scope = fixture.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        return await db.RemoteSessions.AsNoTracking().SingleAsync(s => s.SessionId == sessionId);
    }

    [Fact]
    public async Task Remote_PairsViewerAndAgent_RelaysFrames_AndEndsWhenViewerLeaves()
    {
        var agent = await RemoteAgentAsync("Remoto par");
        await using var _ = agent.Fake;
        var session = await CreateSessionAsync(agent);
        Assert.Equal("none", session.Consent);
        Assert.StartsWith("wss://rmm.exemplo.com/api/remote/relay/", session.RelayUrl, StringComparison.Ordinal);

        var start = agent.Fake.Received.Single(r => r.GetString("func") == "remote_start");
        var payload = (IReadOnlyDictionary<string, object?>)start["payload"]!;
        Assert.Equal(session.SessionId, payload.GetString("session_id"));
        Assert.Equal("desktop", payload.GetString("channels"));
        using (var policy = JsonDocument.Parse(payload.GetString("policy")!))
        {
            Assert.Equal("none", policy.RootElement.GetProperty("consent").GetString());
            Assert.True(policy.RootElement.GetProperty("clipboardToRemote").GetBoolean());
        }
        var agentToken = payload.GetString("token")!;
        Assert.NotEqual(session.ViewerToken, agentToken);

        var viewer = await ConnectRelayAsync(session.SessionId, "desktop", "X-API-KEY", agent.ApiKey);
        await SendFrameAsync(viewer, RemoteFrames.Auth, new { token = session.ViewerToken, role = "viewer", proto = 1 });
        Assert.Equal(RemoteFrames.AuthOk, (await ReceiveFrameAsync(viewer))!.Value.Type);

        var helper = await ConnectRelayAsync(session.SessionId, "desktop", "Authorization", "Token " + agent.Token);
        await SendFrameAsync(helper, RemoteFrames.Auth, new { token = agentToken, role = "agent", proto = 1 });
        Assert.Equal(RemoteFrames.AuthOk, (await ReceiveFrameAsync(helper))!.Value.Type);
        Assert.Equal(RemoteFrames.Paired, (await ReceiveFrameAsync(helper))!.Value.Type);
        Assert.Equal(RemoteFrames.Paired, (await ReceiveFrameAsync(viewer))!.Value.Type);

        var key = Frame(0x21, Encoding.UTF8.GetBytes("{\"code\":\"KeyA\",\"down\":true}"));
        await viewer.SendAsync(key, WebSocketMessageType.Binary, true, CancellationToken.None);
        var got = await ReceiveFrameAsync(helper);
        Assert.Equal(0x21, got!.Value.Type);
        Assert.Equal(key[1..], got.Value.Body);

        await SendFrameAsync(helper, RemoteFrames.Clipboard, new { kind = "text", text = "segredo", hash = "x" });
        Assert.Equal(RemoteFrames.Clipboard, (await ReceiveFrameAsync(viewer))!.Value.Type);
        var frameEnd = new byte[] { RemoteFrames.FrameEnd, 0, 0, 0, 1, 0, 0, 7, 128, 4, 56 };
        await helper.SendAsync(frameEnd, WebSocketMessageType.Binary, true, CancellationToken.None);
        Assert.Equal(RemoteFrames.FrameEnd, (await ReceiveFrameAsync(viewer))!.Value.Type);

        await viewer.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        Assert.Equal(RemoteFrames.PeerGone, (await ReceiveFrameAsync(helper))!.Value.Type);
        Assert.Null(await ReceiveFrameAsync(helper));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseEnded, helper.CloseStatus);

        RemoteSession row;
        var deadline = DateTime.UtcNow.AddSeconds(10);
        do
        {
            await Task.Delay(100);
            row = await SessionRowAsync(session.SessionId);
        } while (row.State != RemoteSessionState.Ended && DateTime.UtcNow < deadline);
        Assert.Equal("technician", row.EndReason);
        Assert.NotNull(row.FirstFrameAt);
        Assert.Equal(1, row.ClipboardToLocal);
        Assert.True(row.BytesToAgent > 0 && row.BytesToViewer > 0);
        await Task.Delay(300);
        Assert.Contains(agent.Fake.Received, r => r.GetString("func") == "remote_stop");

        await using var scope = fixture.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var audits = await db.AuditLogs.AsNoTracking().Where(a => a.ObjectId == agent.Pk.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Select(a => a.Action).ToListAsync();
        Assert.Contains("remote.session-start", audits);
        Assert.Contains("remote.session-end", audits);
        Assert.DoesNotContain(db.AuditLogs.AsNoTracking().Select(a => a.Message), m => m != null && m.Contains("segredo", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Remote_RejectsWrongTokenRoleAndReuse()
    {
        var agent = await RemoteAgentAsync("Remoto tokens");
        await using var _ = agent.Fake;
        var session = await CreateSessionAsync(agent);

        var wrong = await ConnectRelayAsync(session.SessionId, "desktop", "X-API-KEY", agent.ApiKey);
        await SendFrameAsync(wrong, RemoteFrames.Auth, new { token = "x" + session.ViewerToken[1..], role = "viewer", proto = 1 });
        Assert.Null(await ReceiveFrameAsync(wrong));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseAuth, wrong.CloseStatus);

        // O token do visualizador nao serve para o papel de agente, nem com o cabecalho do tecnico.
        var asAgent = await ConnectRelayAsync(session.SessionId, "desktop", "X-API-KEY", agent.ApiKey);
        await SendFrameAsync(asAgent, RemoteFrames.Auth, new { token = session.ViewerToken, role = "agent", proto = 1 });
        Assert.Null(await ReceiveFrameAsync(asAgent));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseAuth, asAgent.CloseStatus);

        var first = await ConnectRelayAsync(session.SessionId, "desktop", "X-API-KEY", agent.ApiKey);
        await SendFrameAsync(first, RemoteFrames.Auth, new { token = session.ViewerToken, role = "viewer", proto = 1 });
        Assert.Equal(RemoteFrames.AuthOk, (await ReceiveFrameAsync(first))!.Value.Type);
        var second = await ConnectRelayAsync(session.SessionId, "desktop", "X-API-KEY", agent.ApiKey);
        await SendFrameAsync(second, RemoteFrames.Auth, new { token = session.ViewerToken, role = "viewer", proto = 1 });
        Assert.Null(await ReceiveFrameAsync(second));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseDuplicate, second.CloseStatus);

        // O token do visualizador so serve para quem criou a sessao: outra identidade e recusada.
        var other = await ConnectRelayAsync(session.SessionId, "desktop", "Authorization", "Token " + agent.Token);
        await SendFrameAsync(other, RemoteFrames.Auth, new { token = session.ViewerToken, role = "viewer", proto = 1 });
        Assert.Null(await ReceiveFrameAsync(other));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseAuth, other.CloseStatus);

        using var http = ApiKeyClient(agent.ApiKey);
        Assert.Equal(HttpStatusCode.NoContent, (await http.DeleteAsync($"/api/remote/sessions/{session.SessionId}")).StatusCode);
        Assert.Null(await ReceiveFrameAsync(first));
    }

    [Fact]
    public async Task Remote_CreateErrors_FollowContract()
    {
        var old = await RemoteAgentAsync("Remoto antigo", version: "3.0.1");
        await using (old.Fake)
        {
            using var http = ApiKeyClient(old.ApiKey);
            var response = await http.PostAsJsonAsync($"/api/agents/{old.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains(RemoteErrors.Unsupported, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        var wayland = await RemoteAgentAsync("Remoto wayland", startReply: "error: unsupported");
        await using (wayland.Fake)
        {
            using var http = ApiKeyClient(wayland.ApiKey);
            var response = await http.PostAsJsonAsync($"/api/agents/{wayland.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains(RemoteErrors.Unsupported, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            var bad = await http.PostAsJsonAsync($"/api/agents/{wayland.Pk}/remote/sessions", new { channels = new[] { "audio" } });
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }

        var busy = await RemoteAgentAsync("Remoto limite");
        await using (busy.Fake)
        {
            await CreateSessionAsync(busy);
            using var http = ApiKeyClient(busy.ApiKey);
            var second = await http.PostAsJsonAsync($"/api/agents/{busy.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
            Assert.Contains(RemoteErrors.SessionLimit, await second.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            await using (var scope = fixture.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
                await db.Agents.Where(a => a.Id == busy.Pk).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AgentStatus.Offline));
            }
            var files = await http.PostAsJsonAsync($"/api/agents/{busy.Pk}/remote/sessions", new { channels = new[] { "files" } });
            Assert.Equal(HttpStatusCode.Conflict, files.StatusCode);
            Assert.Contains(RemoteErrors.AgentOffline, await files.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Remote_PoliciesInheritAndReachTheAgent()
    {
        var agent = await RemoteAgentAsync("Remoto politica");
        await using var _ = agent.Fake;
        var siteId = (await agent.Admin.GetFromJsonAsync<JsonElement>($"/api/agents/{agent.Pk}")).GetProperty("siteId").GetInt32();

        var global = await agent.Admin.GetFromJsonAsync<JsonElement>("/api/remote/policies");
        Assert.Equal("none", global[0].GetProperty("consent").GetString());

        var put = await agent.Admin.PutAsJsonAsync($"/api/remote/policies/site/{siteId}", new { scope = "site", scopeId = siteId, consent = "notify", clipboardToLocal = false });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var invalid = await agent.Admin.PutAsJsonAsync($"/api/remote/policies/site/{siteId}", new { scope = "site", scopeId = siteId, consent = "talvez" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var session = await CreateSessionAsync(agent);
        Assert.Equal("notify", session.Consent);
        var start = agent.Fake.Received.Last(r => r.GetString("func") == "remote_start");
        using var policy = JsonDocument.Parse(((IReadOnlyDictionary<string, object?>)start["payload"]!).GetString("policy")!);
        Assert.Equal("notify", policy.RootElement.GetProperty("consent").GetString());
        Assert.False(policy.RootElement.GetProperty("clipboardToLocal").GetBoolean());
        Assert.True(policy.RootElement.GetProperty("clipboardToRemote").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await agent.Admin.DeleteAsync($"/api/remote/policies/site/{siteId}")).StatusCode);
    }

    [Fact]
    public async Task Remote_ForwardHeaderWithoutValidKey_IsRejected()
    {
        using var http = fixture.NewClient();
        http.DefaultRequestHeaders.Add(RemoteForwardAuthenticationHandler.KeyHeader, "chave-falsa");
        http.DefaultRequestHeaders.Add(RemoteForwardAuthenticationHandler.PrincipalHeader, new ForwardedPrincipal("user", Guid.NewGuid(), "x", true, null, null).Encode());
        var response = await http.GetAsync($"/api/remote/sessions/{Guid.NewGuid():N}");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
