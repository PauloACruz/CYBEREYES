using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using NATS.Client.Core;
using WinCare.Api.Rmm.Actions;
using WinCare.Api.Rmm.Nats;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    /// <summary>Agente simulado: responde aos comandos NATS com a funcao informada e guarda as mensagens recebidas.</summary>
    private sealed class FakeAgent : IAsyncDisposable
    {
        private readonly CancellationTokenSource cts = new();
        private readonly Task loop;
        public List<IReadOnlyDictionary<string, object?>> Received { get; } = [];
        public NatsConnection Nats { get; }

        public FakeAgent(NatsConnection nats, string agentId, Func<IReadOnlyDictionary<string, object?>, object?> reply)
        {
            Nats = nats;
            var ready = new TaskCompletionSource();
            loop = Task.Run(async () =>
            {
                await using var sub = await nats.SubscribeCoreAsync(agentId, serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: cts.Token);
                ready.SetResult();
                try
                {
                    await foreach (var msg in sub.Msgs.ReadAllAsync(cts.Token))
                    {
                        var request = MsgPack.DeserializeMap(msg.Data!);
                        if (request is null || request.GetString("func") is null)
                        {
                            continue;
                        }
                        lock (Received)
                        {
                            Received.Add(request);
                        }
                        if (reply(request) is { } response && msg.ReplyTo is not null)
                        {
                            await msg.ReplyAsync(MsgPack.Serialize(response), serializer: NatsRawSerializer<byte[]>.Default);
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                }
            });
            ready.Task.Wait(TimeSpan.FromSeconds(5));
        }

        public async ValueTask DisposeAsync()
        {
            await cts.CancelAsync();
            await loop;
            cts.Dispose();
            await Nats.DisposeAsync();
        }
    }

    private async Task<(HttpClient Admin, int Pk, FakeAgent Agent)> FakeAgentAsync(string client, string plat,
        Func<IReadOnlyDictionary<string, object?>, object?> reply)
    {
        var (admin, _, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = AgentClient(installer);
        var response = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = $"host-{plat}", site = siteId, monitoring_type = "server", plat });
        var body = await response.Content.ReadFromJsonAsync<NewAgentBody>();
        var nats = await ConnectAsAgentAsync(agentId, body!.Token);
        return (admin, body.Pk, new FakeAgent(nats, agentId, reply));
    }

    [Fact]
    public async Task Command_SendsRawCmd_AndRecordsHistory()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente comando", "linux", r => r.GetString("func") == "rawcmd" ? "saida do comando" : null);
        await using var _ = agent;

        var invalid = await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "cmd", command = "dir", timeout = 30, runAsUser = false });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var response = await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "uptime", timeout = 30, runAsUser = false });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("saida do comando", (await response.Content.ReadFromJsonAsync<CommandBody>())!.Output);

        var sent = agent.Received.Single(r => r.GetString("func") == "rawcmd");
        var payload = (IReadOnlyDictionary<string, object?>)sent["payload"]!;
        Assert.Equal("uptime", payload.GetString("command"));
        Assert.Equal("/bin/bash", payload.GetString("shell"));

        var history = await admin.GetFromJsonAsync<HistoryPage>($"/api/agents/{pk}/history");
        var entry = Assert.Single(history!.Items);
        Assert.Equal("cmd_run", entry.Type);
        Assert.Equal("saida do comando", entry.Results);
    }

    [Fact]
    public async Task RunScript_ResolvesVariablesAndSnippets()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente script", "linux", r => r.GetString("func") == "runscriptfull"
            ? new Dictionary<string, object?> { ["stdout"] = "ok", ["stderr"] = "", ["retcode"] = 0, ["execution_time"] = 1.5, ["id"] = 0 }
            : null);
        await using var _ = agent;

        await admin.PostAsJsonAsync("/api/keystore", new { name = "EMPRESA", value = "WinCare Ltda" });
        await admin.PostAsJsonAsync("/api/scripts/snippets", new { name = "saudacao", shell = "shell", code = "echo ola" });
        var created = await admin.PostAsJsonAsync("/api/scripts", new
        {
            name = "Teste variaveis", shell = "shell", body = "#!/bin/bash\n{{saudacao}}\necho $1 $2",
            defaultArgs = new[] { "{{agent.hostname}}", "{{global.EMPRESA}}" }, defaultTimeout = 60, platforms = new[] { "linux" },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var script = await created.Content.ReadFromJsonAsync<IdOnly>();

        var run = await admin.PostAsJsonAsync($"/api/agents/{pk}/runscript", new { scriptId = script!.Id });
        Assert.Equal(HttpStatusCode.OK, run.StatusCode);
        var result = await run.Content.ReadFromJsonAsync<ScriptRunBody>();
        Assert.Equal(0, result!.Retcode);
        Assert.Equal(1.5, result.ExecutionTime);

        var sent = agent.Received.Single(r => r.GetString("func") == "runscriptfull");
        var args = ((IEnumerable<object?>)sent["script_args"]!).Cast<string>().ToList();
        Assert.Equal(["host-linux", "WinCare Ltda"], args);
        Assert.Contains("echo ola", ((IReadOnlyDictionary<string, object?>)sent["payload"]!).GetString("code"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnansweredCommand_Returns504_AndWindowsOnlyRoutesRejectLinux()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente timeout", "linux", _ => null);
        await using var _ = agent;

        var processes = await admin.GetAsync($"/api/agents/{pk}/processes");
        Assert.Equal(HttpStatusCode.GatewayTimeout, processes.StatusCode);
        Assert.Contains("AGENT_TIMEOUT", await processes.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/agents/{pk}/services")).StatusCode);
    }

    [Fact]
    public async Task Processes_AndRegistry_MapAgentReplies()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente windows", "windows", r => r.GetString("func") switch
        {
            "procs" => new object[] { new Dictionary<string, object?> { ["name"] = "explorer.exe", ["pid"] = 42, ["membytes"] = 1024, ["username"] = "maria", ["cpu_percent"] = "1.5" } },
            "registry_browse" => new Dictionary<string, object?> { ["error"] = "acesso negado" },
            _ => null,
        });
        await using var _ = agent;

        using var procs = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}/processes"));
        Assert.Equal("explorer.exe", procs.RootElement[0].GetProperty("name").GetString());
        Assert.Equal(1024, procs.RootElement[0].GetProperty("memBytes").GetInt64());

        var registry = await admin.GetAsync($"/api/agents/{pk}/registry?path=HKLM\\SOFTWARE");
        Assert.Equal(HttpStatusCode.BadRequest, registry.StatusCode);
        Assert.Contains("acesso negado", await registry.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Terminal_RelaysOutputBytesAndClose()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente terminal", "linux", _ => null);
        await using var _ = agent;

        var key = await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "terminal" })).Content.ReadFromJsonAsync<KeyOnly>();
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(fixture.Server.BaseAddress, "/hubs/console"), o =>
            {
                o.HttpMessageHandlerFactory = _ => fixture.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.Headers["X-API-KEY"] = key!.Key;
            })
            .Build();
        var output = new TaskCompletionSource<string>();
        var closed = new TaskCompletionSource<int>();
        hub.On<string, string>("terminalOutput", (_, data) => output.TrySetResult(Encoding.UTF8.GetString(Convert.FromBase64String(data))));
        hub.On<string, int, string?>("terminalClosed", (_, code, _) => closed.TrySetResult(code));
        await hub.StartAsync();

        var sessionId = await hub.InvokeAsync<string>("StartTerminal", pk, 80, 24, (string?)null);
        await Task.Delay(300);
        var start = agent.Received.Single(r => r.GetString("func") == "terminal_start");
        Assert.Equal("/bin/bash", ((IReadOnlyDictionary<string, object?>)start["payload"]!).GetString("shell"));

        Assert.Equal(sessionId, ((IReadOnlyDictionary<string, object?>)start["payload"]!).GetString("session_id"));

        var topic = $"{AgentIdOf(agent)}.terminal.{sessionId}";
        await agent.Nats.PublishAsync(topic, MsgPack.Serialize(Encoding.UTF8.GetBytes("ação ok")), serializer: NatsRawSerializer<byte[]>.Default);
        Assert.Equal("ação ok", await output.Task.WaitAsync(TimeSpan.FromSeconds(10)));

        await agent.Nats.PublishAsync(topic, MsgPack.Serialize(new Dictionary<string, object?> { ["done"] = true, ["exit_code"] = 0 }),
            serializer: NatsRawSerializer<byte[]>.Default);
        Assert.Equal(0, await closed.Task.WaitAsync(TimeSpan.FromSeconds(10)));
        await hub.DisposeAsync();
    }

    private static string AgentIdOf(FakeAgent agent) => agent.Nats.Opts.AuthOpts.Username!;

    private sealed record CommandBody(long HistoryId, string Output);
    private sealed record HistoryItem(long Id, string Type, string? Results);
    private sealed record HistoryPage(List<HistoryItem> Items, int Total);
    private sealed record IdOnly(int Id);
    private sealed record KeyOnly(string Key);
    private sealed record ScriptRunBody(string Stdout, string Stderr, int Retcode, double ExecutionTime);
}

public sealed class TerminalFrameTests
{
    [Fact]
    public void Decode_KeepsRawBytes_AndReadsDoneMap()
    {
        var raw = new byte[] { 0xC3, 0xA7 };
        var frame = TerminalSessions.Decode(MsgPack.Serialize(raw));
        Assert.Equal(raw, frame!.Output);
        Assert.False(frame.Done);

        var done = TerminalSessions.Decode(MsgPack.Serialize(new Dictionary<string, object?> { ["done"] = true, ["exit_code"] = 3 }));
        Assert.True(done!.Done);
        Assert.Equal(3, done.ExitCode);
    }
}
