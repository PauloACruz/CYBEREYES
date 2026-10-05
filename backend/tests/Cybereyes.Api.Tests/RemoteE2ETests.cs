using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;
using Cybereyes.Api.Rmm.Remote;

namespace Cybereyes.Api.Tests;

/// <summary>Teste com EYES real e tela X11 (Xvfb em DISPLAY): pula sem DISPLAY ou sem o Go para compilar o EYES.</summary>
public sealed class RemoteDisplayFactAttribute : FactAttribute
{
    public RemoteDisplayFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DISPLAY")))
        {
            Skip = "sem DISPLAY (rode com Xvfb)";
        }
        else if (EyesBinary.Path is null)
        {
            Skip = "EYES indisponivel";
        }
    }
}

[Collection(ApiCollection.Name)]
public sealed class RemoteE2ETests(ApiFixture fixture)
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(60);

    private static byte[] Frame(byte type, object body)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(body);
        var frame = new byte[json.Length + 1];
        frame[0] = type;
        json.CopyTo(frame, 1);
        return frame;
    }

    private static async Task<byte[]> ReceiveAsync(WebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[1 << 16];
        using var stream = new MemoryStream();
        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new InvalidOperationException($"relay fechado: {ws.CloseStatus} {ws.CloseStatusDescription}");
            }
            stream.Write(buffer, 0, result.Count);
            if (result.EndOfMessage)
            {
                return stream.ToArray();
            }
        }
    }

    private static string MouseLocation()
    {
        using var p = Process.Start(new ProcessStartInfo("xdotool", "getmouselocation") { RedirectStandardOutput = true })!;
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return output;
    }

    [RemoteDisplayFact]
    public async Task Remote_RealEyesStreamsScreenAndAppliesInput()
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/clients", new { name = "Cliente remoto real", siteName = "Matriz" });
        using var client = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var siteId = client.RootElement.GetProperty("sites")[0].GetProperty("id").GetInt32();
        var installer = await admin.PostAsJsonAsync("/api/agents/installer", new { siteId, agentType = "workstation", plat = "linux", expiresHours = 1 });
        using var body = JsonDocument.Parse(await installer.Content.ReadAsStringAsync());
        var parts = body.RootElement.GetProperty("command").GetString()!.Split(' ');
        var token = parts[Array.IndexOf(parts, "--auth") + 1];

        await using var proxy = await ApiProxy.StartAsync(fixture);
        await using var eyes = await EyesProcess.StartAsync(proxy.Url, fixture.NatsUrl, siteId, token);

        var watch = Stopwatch.StartNew();
        int? pk = null;
        while (watch.Elapsed < Wait && pk is null)
        {
            using var list = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents?siteId={siteId}"));
            var items = list.RootElement.GetProperty("items");
            if (items.GetArrayLength() == 1 && items[0].GetProperty("status").GetString() == "online" && items[0].GetProperty("version").GetString() == "3.1.0")
            {
                pk = items[0].GetProperty("id").GetInt32();
            }
            else
            {
                await Task.Delay(500);
            }
        }
        Assert.True(pk is not null, "agente nao ficou online. Log do EYES:\n" + eyes.Log);

        var key = (await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "remoto-real" })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("key").GetString()!;
        using var http = fixture.NewClient();
        http.DefaultRequestHeaders.Add("X-API-KEY", key);
        var response = await http.PostAsJsonAsync($"/api/agents/{pk}/remote/sessions", new { channels = new[] { "desktop" } });
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync() + "\n" + eyes.Log);
        using var session = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var sessionId = session.RootElement.GetProperty("sessionId").GetString()!;
        var viewerToken = session.RootElement.GetProperty("viewerToken").GetString()!;

        var wsClient = fixture.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = r => r.Headers["X-API-KEY"] = key;
        using var viewer = await wsClient.ConnectAsync(new Uri($"ws://localhost/api/remote/relay/{sessionId}/desktop"), CancellationToken.None);
        using var cts = new CancellationTokenSource(Wait);
        await viewer.SendAsync(Frame(RemoteFrames.Auth, new { token = viewerToken, role = "viewer", proto = 1 }), WebSocketMessageType.Binary, true, cts.Token);
        Assert.Equal(RemoteFrames.AuthOk, (await ReceiveAsync(viewer, cts.Token))[0]);
        try
        {
            Assert.Equal(RemoteFrames.Paired, (await ReceiveAsync(viewer, cts.Token))[0]);
        }
        catch (Exception ex) when (ex is OperationCanceledException or InvalidOperationException)
        {
            throw new InvalidOperationException("o remote-helper nao conectou. Log do EYES:\n" + eyes.Log, ex);
        }

        var hello = await ReceiveAsync(viewer, cts.Token);
        Assert.Equal(RemoteFrames.Hello, hello[0]);
        using (var doc = JsonDocument.Parse(hello.AsMemory(1)))
        {
            Assert.Equal("linux", doc.RootElement.GetProperty("os").GetString());
            Assert.True(doc.RootElement.GetProperty("displays")[0].GetProperty("w").GetInt32() > 0);
        }

        // Primeiro quadro: blocos JPEG ate o FRAME_END, depois o ACK.
        var tiles = 0;
        while (true)
        {
            var frame = await ReceiveAsync(viewer, cts.Token);
            if (frame[0] == 0x11)
            {
                Assert.Equal(0xFF, frame[13]);
                Assert.Equal(0xD8, frame[14]);
                tiles++;
            }
            else if (frame[0] == RemoteFrames.FrameEnd)
            {
                Assert.True(tiles > 0);
                var ack = new byte[9];
                ack[0] = 0x27;
                frame.AsSpan(1, 4).CopyTo(ack.AsSpan(1));
                await viewer.SendAsync(ack, WebSocketMessageType.Binary, true, cts.Token);
                break;
            }
        }

        // Entrada: o ponteiro do X11 vai para onde o visualizador mandou.
        await viewer.SendAsync(Frame(0x23, new { x = 321, y = 234, buttons = 0 }), WebSocketMessageType.Binary, true, cts.Token);
        var location = string.Empty;
        for (var i = 0; i < 40 && !location.Contains("x:321 y:234", StringComparison.Ordinal); i++)
        {
            await Task.Delay(100);
            location = MouseLocation();
        }
        Assert.Contains("x:321 y:234", location, StringComparison.Ordinal);

        await viewer.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        var ended = false;
        for (var i = 0; i < 50 && !ended; i++)
        {
            await Task.Delay(200);
            using var state = JsonDocument.Parse(await http.GetStringAsync($"/api/remote/sessions/{sessionId}"));
            ended = state.RootElement.GetProperty("state").GetString() == "ended";
        }
        Assert.True(ended, "sessao nao terminou. Log do EYES:\n" + eyes.Log);
    }
}
