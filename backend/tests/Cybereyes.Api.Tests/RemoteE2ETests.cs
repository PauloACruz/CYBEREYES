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

/// <summary>EYES real ligado a API de teste, com uma chave de API de administrador.</summary>
public sealed class RealAgent : IAsyncDisposable
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(60);

    public required ApiProxy Proxy { get; init; }
    public required EyesProcess Eyes { get; init; }
    public required int Pk { get; init; }
    public required string Key { get; init; }
    public required HttpClient Http { get; init; }

    public static async Task<RealAgent> StartAsync(ApiFixture fixture, string clientName)
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/clients", new { name = clientName, siteName = "Matriz" });
        using var client = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var siteId = client.RootElement.GetProperty("sites")[0].GetProperty("id").GetInt32();
        var installer = await admin.PostAsJsonAsync("/api/agents/installer", new { siteId, agentType = "workstation", plat = "linux", expiresHours = 1 });
        using var body = JsonDocument.Parse(await installer.Content.ReadAsStringAsync());
        var parts = body.RootElement.GetProperty("command").GetString()!.Split(' ');
        var token = parts[Array.IndexOf(parts, "--auth") + 1];

        var proxy = await ApiProxy.StartAsync(fixture);
        var eyes = await EyesProcess.StartAsync(proxy.Url, fixture.NatsUrl, siteId, token);
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
        if (pk is null)
        {
            var log = eyes.Log;
            await eyes.DisposeAsync();
            await proxy.DisposeAsync();
            throw new InvalidOperationException("agente nao ficou online. Log do EYES:\n" + log);
        }
        var key = (await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "remoto-" + clientName })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("key").GetString()!;
        var http = fixture.NewClient();
        http.DefaultRequestHeaders.Add("X-API-KEY", key);
        return new RealAgent { Proxy = proxy, Eyes = eyes, Pk = pk.Value, Key = key, Http = http };
    }

    public async ValueTask DisposeAsync()
    {
        Http.Dispose();
        await Eyes.DisposeAsync();
        await Proxy.DisposeAsync();
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

    private static string MouseLocation() => Run("xdotool", "getmouselocation", null);

    private static string Run(string file, string args, string? input)
    {
        // Com entrada (xclip -i), a saida nao e lida: o xclip fica em segundo plano segurando a selecao.
        using var p = Process.Start(new ProcessStartInfo(file, args) { RedirectStandardOutput = input is null, RedirectStandardInput = input is not null })!;
        if (input is not null)
        {
            p.StandardInput.Write(input);
            p.StandardInput.Close();
            p.WaitForExit();
            return string.Empty;
        }
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return output;
    }

    [RemoteDisplayFact]
    public async Task Remote_RealEyesStreamsScreenAndAppliesInput()
    {
        await using var agent = await RealAgent.StartAsync(fixture, "Cliente remoto real");
        var (eyes, pk, http) = (agent.Eyes, agent.Pk, agent.Http);
        var response = await http.PostAsJsonAsync($"/api/agents/{pk}/remote/sessions", new { channels = new[] { "desktop" } });
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync() + "\n" + eyes.Log);
        using var session = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var sessionId = session.RootElement.GetProperty("sessionId").GetString()!;
        var viewerToken = session.RootElement.GetProperty("viewerToken").GetString()!;

        var wsClient = fixture.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = r => r.Headers["X-API-KEY"] = agent.Key;
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
            Assert.Contains("clipboard-text", doc.RootElement.GetProperty("features").EnumerateArray().Select(f => f.GetString()));
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

        // Area de transferencia, do tecnico para a estacao: outro programa (xclip) cola o texto.
        await viewer.SendAsync(Frame(0x14, new { kind = "text", text = "do tecnico ✓", hash = "" }), WebSocketMessageType.Binary, true, cts.Token);
        var pasted = string.Empty;
        for (var i = 0; i < 40 && pasted != "do tecnico ✓"; i++)
        {
            await Task.Delay(100);
            pasted = Run("xclip", "-selection clipboard -o", null);
        }
        Assert.Equal("do tecnico ✓", pasted);

        // Da estacao para o tecnico: o texto copiado chega sem pedido.
        Run("xclip", "-selection clipboard -i", "copiado na estacao");
        string? received = null;
        while (received is null)
        {
            var frame = await ReceiveAsync(viewer, cts.Token);
            if (frame[0] == 0x14)
            {
                using var clip = JsonDocument.Parse(frame.AsMemory(1));
                received = clip.RootElement.GetProperty("text").GetString();
            }
        }
        Assert.Equal("copiado na estacao", received);

        await viewer.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        var ended = false;
        for (var i = 0; i < 50 && !ended; i++)
        {
            await Task.Delay(200);
            using var state = JsonDocument.Parse(await http.GetStringAsync($"/api/remote/sessions/{sessionId}"));
            ended = state.RootElement.GetProperty("state").GetString() == "ended";
        }
        Assert.True(ended, "sessao nao terminou. Log do EYES:\n" + eyes.Log);

        // Auditoria por contagem: um texto em cada sentido, sem o conteudo.
        using var final = JsonDocument.Parse(await http.GetStringAsync($"/api/remote/sessions/{sessionId}"));
        Assert.Equal(1, final.RootElement.GetProperty("clipboardToRemote").GetInt32());
        Assert.Equal(1, final.RootElement.GetProperty("clipboardToLocal").GetInt32());
    }
}
