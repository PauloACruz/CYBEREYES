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
    private async Task<RemoteAgent> RemoteAgentAsync(string client, string startReply = "ok", string version = "3.1.0", string plat = "windows",
        Func<IReadOnlyDictionary<string, object?>, object?>? reply = null)
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var (agentId, pk, token) = await RegisterAgentAsync(installer, siteId, $"host-{client}");
        var nats = await ConnectAsAgentAsync(agentId, token);
        var fake = new FakeAgent(nats, agentId, reply ?? (r => r.GetString("func") == "remote_start" ? startReply : null));
        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.Agents.Where(a => a.Id == pk).ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Status, AgentStatus.Online).SetProperty(a => a.Version, version).SetProperty(a => a.LastSeen, DateTimeOffset.UtcNow)
                .SetProperty(a => a.Plat, plat));
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

    /// <summary>Pedido RDCleanPath do navegador (vetor do IronRDP com o token do visualizador no proxy_auth).</summary>
    private static byte[] RdCleanPathRequest(string token)
    {
        var w = new System.Formats.Asn1.AsnWriter(System.Formats.Asn1.AsnEncodingRules.DER);
        System.Formats.Asn1.Asn1Tag Tag(int n) => new(System.Formats.Asn1.TagClass.ContextSpecific, n, isConstructed: true);
        using (w.PushSequence())
        {
            using (w.PushSequence(Tag(0)))
            {
                w.WriteInteger(RdCleanPath.Version1);
            }
            using (w.PushSequence(Tag(2)))
            {
                w.WriteCharacterString(System.Formats.Asn1.UniversalTagNumber.UTF8String, "maquina");
            }
            using (w.PushSequence(Tag(3)))
            {
                w.WriteCharacterString(System.Formats.Asn1.UniversalTagNumber.UTF8String, token);
            }
            using (w.PushSequence(Tag(6)))
            {
                w.WriteOctetString([0x03, 0x00, 0x00, 0x0B, 0x06, 0xE0, 0, 0, 0, 0, 0]);
            }
        }
        return w.Encode();
    }

    private static byte[] Whole((byte Type, byte[] Body)? frame) => [frame!.Value.Type, .. frame.Value.Body];

    [Fact]
    public void RdCleanPath_ReadsIronRdpRequestAndWritesHttpError()
    {
        // Vetores de crates/ironrdp-testsuite-core/tests/rdcleanpath.rs (IronRDP).
        byte[] request =
        [
            0x30, 0x32, 0xA0, 0x4, 0x2, 0x2, 0xD, 0x3E, 0xA2, 0xD, 0xC, 0xB, 0x64, 0x65, 0x73, 0x74, 0x69, 0x6E, 0x61, 0x74,
            0x69, 0x6F, 0x6E, 0xA3, 0xC, 0xC, 0xA, 0x70, 0x72, 0x6F, 0x78, 0x79, 0x20, 0x61, 0x75, 0x74, 0x68, 0xA5, 0x5, 0xC,
            0x3, 0x50, 0x43, 0x42, 0xA6, 0x6, 0x4, 0x4, 0xDE, 0xAD, 0xBE, 0xFF,
        ];
        Assert.Equal("proxy auth", RdCleanPath.ReadProxyAuth(request));
        byte[] httpError = [0x30, 0x15, 0xA0, 0x4, 0x2, 0x2, 0xD, 0x3E, 0xA1, 0xD, 0x30, 0xB, 0xA0, 0x3, 0x2, 0x1, 0x1, 0xA1, 0x4, 0x2, 0x2, 0x1, 0xF4];
        Assert.Equal(httpError, RdCleanPath.HttpError(500));
        Assert.Null(RdCleanPath.ReadProxyAuth(httpError));
        Assert.Null(RdCleanPath.ReadProxyAuth(Encoding.UTF8.GetBytes("{\"token\":\"x\"}")));
        Assert.Null(RdCleanPath.ReadProxyAuth(request.AsMemory(0, 20)));
    }

    [Fact]
    public async Task Remote_RdpChannel_EnablesGnomeRdp_AndRelaysRdCleanPath()
    {
        var agent = await RemoteAgentAsync("Remoto rdp", plat: "linux", reply: r => r.GetString("func") switch
        {
            "rdp_enable" => new Dictionary<string, object?> { ["port"] = 3390, ["username"] = "eyes", ["password"] = "SenhaTemporaria1", ["user"] = "maria" },
            "remote_start" => "ok",
            _ => null,
        });
        await using var _ = agent.Fake;
        using var http = ApiKeyClient(agent.ApiKey);
        var created = await http.PostAsJsonAsync($"/api/agents/{agent.Pk}/remote/sessions", new { channels = new[] { "rdp", "files" }, viewOnly = true });
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = body.GetProperty("sessionId").GetString()!;
        var viewerToken = body.GetProperty("viewerToken").GetString()!;
        Assert.Equal("eyes", body.GetProperty("rdp").GetProperty("username").GetString());
        Assert.Equal("SenhaTemporaria1", body.GetProperty("rdp").GetProperty("password").GetString());
        Assert.Equal("host-Remoto rdp", body.GetProperty("rdp").GetProperty("destination").GetString());
        Assert.False(body.GetProperty("rdp").GetProperty("clipboard").GetBoolean()); // somente visualizar

        var enable = agent.Fake.Received.Single(r => r.GetString("func") == "rdp_enable");
        Assert.Equal("true", ((IReadOnlyDictionary<string, object?>)enable["payload"]!).GetString("view_only"));
        var start = (IReadOnlyDictionary<string, object?>)agent.Fake.Received.Single(r => r.GetString("func") == "remote_start")["payload"]!;
        Assert.Equal("rdp,files", start.GetString("channels"));
        Assert.Equal("3390", start.GetString("rdp_port"));

        // Token errado no RDCleanPath: erro 401 no formato do IronRDP e fechamento.
        var intruder = await ConnectRelayAsync(sessionId, "rdp", "X-API-KEY", agent.ApiKey);
        await intruder.SendAsync(RdCleanPathRequest("token-errado"), WebSocketMessageType.Binary, true, CancellationToken.None);
        var refused = await ReceiveFrameAsync(intruder);
        Assert.Equal(RdCleanPath.HttpError(401), Whole(refused));
        Assert.Null(await ReceiveFrameAsync(intruder));

        // O visualizador e o cliente RDP do navegador: sem AUTH_OK nem PAIRED, o pedido vai ao agente depois do par.
        var request = RdCleanPathRequest(viewerToken);
        var viewer = await ConnectRelayAsync(sessionId, "rdp", "X-API-KEY", agent.ApiKey);
        await viewer.SendAsync(request, WebSocketMessageType.Binary, true, CancellationToken.None);
        var eyes = await ConnectRelayAsync(sessionId, "rdp", "Authorization", "Token " + agent.Token);
        await SendFrameAsync(eyes, RemoteFrames.Auth, new { token = start.GetString("token"), role = "agent", proto = 1 });
        Assert.Equal(RemoteFrames.AuthOk, (await ReceiveFrameAsync(eyes))!.Value.Type);
        Assert.Equal(RemoteFrames.Paired, (await ReceiveFrameAsync(eyes))!.Value.Type);
        var forwarded = await ReceiveFrameAsync(eyes);
        Assert.Equal(request, Whole(forwarded));

        // Do agente: RdpData perde o byte de tipo; CONSENT fica no relay.
        await SendFrameAsync(eyes, RemoteFrames.Consent, new { state = "waiting" });
        await SendFrameAsync(eyes, RemoteFrames.Consent, new { state = "accepted" });
        await eyes.SendAsync(Frame(RemoteFrames.RdpData, [0x30, 0x01, 0x02]), WebSocketMessageType.Binary, true, CancellationToken.None);
        var toViewer = await ReceiveFrameAsync(viewer);
        Assert.Equal(new byte[] { 0x30, 0x01, 0x02 }, Whole(toViewer));
        await viewer.SendAsync(new byte[] { 0x03, 0x00, 0x00, 0x04 }, WebSocketMessageType.Binary, true, CancellationToken.None);
        var toAgent = await ReceiveFrameAsync(eyes);
        Assert.Equal(new byte[] { 0x03, 0x00, 0x00, 0x04 }, Whole(toAgent));

        await viewer.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        Assert.Null(await ReceiveFrameAsync(eyes));
        Assert.Equal((WebSocketCloseStatus)RemoteFrames.CloseEnded, eyes.CloseStatus);
        RemoteSession row;
        var deadline = DateTime.UtcNow.AddSeconds(10);
        do
        {
            await Task.Delay(100);
            row = await SessionRowAsync(sessionId);
        } while (row.State != RemoteSessionState.Ended && DateTime.UtcNow < deadline);
        Assert.Equal("technician", row.EndReason);
        Assert.NotNull(row.FirstFrameAt);
        Assert.Equal(3, row.BytesToViewer);
    }

    [Fact]
    public async Task Remote_RdpChannel_Errors()
    {
        var windows = await RemoteAgentAsync("Remoto rdp windows");
        await using (windows.Fake)
        {
            using var http = ApiKeyClient(windows.ApiKey);
            var refused = await http.PostAsJsonAsync($"/api/agents/{windows.Pk}/remote/sessions", new { channels = new[] { "rdp" } });
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("REMOTE_UNSUPPORTED", await refused.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            var both = await http.PostAsJsonAsync($"/api/agents/{windows.Pk}/remote/sessions", new { channels = new[] { "rdp", "desktop" } });
            Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        }

        var wayland = await RemoteAgentAsync("Remoto rdp wayland", startReply: "error: wayland", plat: "linux");
        await using (wayland.Fake)
        {
            using var http = ApiKeyClient(wayland.ApiKey);
            var refused = await http.PostAsJsonAsync($"/api/agents/{wayland.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Contains("REMOTE_WAYLAND", await refused.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        var noGrd = await RemoteAgentAsync("Remoto sem grd", plat: "linux", reply: r => r.GetString("func") switch
        {
            "rdp_enable" => "error: gnome-remote-desktop nao instalado nesta maquina (pacote gnome-remote-desktop)",
            "remote_start" => "ok",
            _ => null,
        });
        await using (noGrd.Fake)
        {
            using var http = ApiKeyClient(noGrd.ApiKey);
            var refused = await http.PostAsJsonAsync($"/api/agents/{noGrd.Pk}/remote/sessions", new { channels = new[] { "rdp" } });
            Assert.Equal(HttpStatusCode.BadGateway, refused.StatusCode);
            Assert.Contains("gnome-remote-desktop nao instalado", await refused.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            Assert.DoesNotContain(noGrd.Fake.Received, r => r.GetString("func") == "remote_start");
        }

        var startFails = await RemoteAgentAsync("Remoto rdp recusado", plat: "linux", reply: r => r.GetString("func") switch
        {
            "rdp_enable" => new Dictionary<string, object?> { ["port"] = 3389, ["username"] = "eyes", ["password"] = "x", ["user"] = "maria" },
            "remote_start" => "error: busy",
            _ => null,
        });
        await using (startFails.Fake)
        {
            using var http = ApiKeyClient(startFails.ApiKey);
            var refused = await http.PostAsJsonAsync($"/api/agents/{startFails.Pk}/remote/sessions", new { channels = new[] { "rdp" } });
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (!startFails.Fake.Received.Any(r => r.GetString("func") == "rdp_disable") && DateTime.UtcNow < deadline)
            {
                await Task.Delay(50);
            }
            Assert.Contains(startFails.Fake.Received, r => r.GetString("func") == "rdp_disable");
        }
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
            // Varios tecnicos podem abrir a tela da mesma estacao, ate o limite por estacao (4).
            for (var i = 2; i <= 4; i++)
            {
                var more = await http.PostAsJsonAsync($"/api/agents/{busy.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
                Assert.Equal(HttpStatusCode.Created, more.StatusCode);
            }
            var fifth = await http.PostAsJsonAsync($"/api/agents/{busy.Pk}/remote/sessions", new { channels = new[] { "desktop" } });
            Assert.Equal(HttpStatusCode.Conflict, fifth.StatusCode);
            var body = await fifth.Content.ReadAsStringAsync();
            Assert.Contains(RemoteErrors.SessionLimit, body, StringComparison.Ordinal);
            Assert.Contains("limite de 4", body, StringComparison.Ordinal);

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
