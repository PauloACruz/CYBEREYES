using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Cybereyes.Api.Tests;

/// <summary>EYES real (agent/) contra a API: registro, check-ins, comandos, scripts, checks, tarefas, Care e app de bandeja.</summary>
[Collection(ApiCollection.Name)]
public sealed class EyesE2ETests(ApiFixture fixture)
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(60);

    private async Task<(HttpClient Admin, int SiteId, string Token)> SiteWithInstallerAsync(string name)
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/clients", new { name, siteName = "Matriz" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var client = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var siteId = client.RootElement.GetProperty("sites")[0].GetProperty("id").GetInt32();
        var installer = await admin.PostAsJsonAsync("/api/agents/installer", new { siteId, agentType = "workstation", plat = "linux", expiresHours = 1 });
        Assert.Equal(HttpStatusCode.OK, installer.StatusCode);
        using var body = JsonDocument.Parse(await installer.Content.ReadAsStringAsync());
        var parts = body.RootElement.GetProperty("command").GetString()!.Split(' ');
        return (admin, siteId, parts[Array.IndexOf(parts, "--auth") + 1]);
    }

    private static async Task<T> EventuallyAsync<T>(Func<Task<T?>> probe, string what, EyesProcess eyes)
    {
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < Wait)
        {
            if (await probe() is { } value)
            {
                return value;
            }
            await Task.Delay(500);
        }
        throw new TimeoutException($"{what} nao aconteceu em {Wait.TotalSeconds} s. Log do EYES:\n{eyes.Log}");
    }

    [EyesFact]
    public async Task Eyes_RegistersChecksInAndAnswersCommands()
    {
        var (admin, siteId, token) = await SiteWithInstallerAsync("Cliente EYES");
        await using var proxy = await ApiProxy.StartAsync(fixture);
        await using var eyes = await EyesProcess.StartAsync(proxy.Url, fixture.NatsUrl, siteId, token);

        // Registro e check-ins: agente aparece online com versao, sistema e discos.
        var pk = await EventuallyAsync<int?>(async () =>
        {
            using var list = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents?siteId={siteId}"));
            var items = list.RootElement.GetProperty("items");
            return items.GetArrayLength() == 1 ? items[0].GetProperty("id").GetInt32() : null;
        }, "registro", eyes);
        var detail = await EventuallyAsync<JsonDocument>(async () =>
        {
            var doc = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}"));
            var r = doc.RootElement;
            if (r.GetProperty("version").GetString() == "3.0.2" && r.GetProperty("operatingSystem").ValueKind == JsonValueKind.String
                && r.GetProperty("disks").ValueKind == JsonValueKind.Array && r.GetProperty("status").GetString() == "online")
            {
                return doc;
            }
            doc.Dispose();
            return null;
        }, "check-in completo", eyes);
        using (detail)
        {
            Assert.Equal("linux", detail.RootElement.GetProperty("plat").GetString());
        }

        // ping pelo NATS
        var ping = await EventuallyAsync<string>(async () =>
        {
            using var doc = JsonDocument.Parse(await (await admin.PostAsync($"/api/agents/{pk}/ping", null)).Content.ReadAsStringAsync());
            var status = doc.RootElement.GetProperty("status").GetString();
            return status == "online" ? status : null;
        }, "ping", eyes);
        Assert.Equal("online", ping);

        // comando avulso
        var command = await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "echo eyes-$((40+2))", timeout = 30, runAsUser = false });
        Assert.True(command.IsSuccessStatusCode, await command.Content.ReadAsStringAsync() + eyes.Log);
        Assert.Contains("eyes-42", await command.Content.ReadAsStringAsync());

        // script da biblioteca com argumento
        var created = await admin.PostAsJsonAsync("/api/scripts", new
        {
            name = "EYES e2e", shell = "shell", body = "#!/bin/sh\necho \"arg=$1\"\necho erro >&2\nexit 3", defaultArgs = new[] { "valor" },
            defaultTimeout = 60, platforms = new[] { "linux" },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using (var script = JsonDocument.Parse(await created.Content.ReadAsStringAsync()))
        {
            var run = await admin.PostAsJsonAsync($"/api/agents/{pk}/runscript", new { scriptId = script.RootElement.GetProperty("id").GetInt32() });
            Assert.True(run.IsSuccessStatusCode, await run.Content.ReadAsStringAsync());
            using var result = JsonDocument.Parse(await run.Content.ReadAsStringAsync());
            Assert.Contains("arg=valor", result.RootElement.GetProperty("stdout").GetString());
            Assert.Contains("erro", result.RootElement.GetProperty("stderr").GetString());
            Assert.Equal(3, result.RootElement.GetProperty("retcode").GetInt32());
        }

        // processos
        using (var procs = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}/processes")))
        {
            Assert.True(procs.RootElement.GetArrayLength() > 0);
        }

        // check de disco executado sob demanda
        var check = await admin.PostAsJsonAsync("/api/checks", new
        {
            agentId = pk, checkType = "diskspace", name = "Disco raiz", disk = "/", warningThreshold = 1, errorThreshold = 0, failsBeforeAlert = 1,
            alertSeverity = "warning", runInterval = 0, searchLastDays = 1, numberOfEventsBeforeAlert = 1, dashboardAlert = true,
        });
        Assert.Equal(HttpStatusCode.Created, check.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync($"/api/agents/{pk}/checks/run", null)).StatusCode);
        var checkStatus = await EventuallyAsync<string>(async () =>
        {
            using var checks = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}/checks"));
            foreach (var c in checks.RootElement.EnumerateArray())
            {
                if (c.GetProperty("result") is { ValueKind: JsonValueKind.Object } r && r.GetProperty("status").GetString() is "passing" or "failing" && r.GetProperty("lastRun").ValueKind != JsonValueKind.Null)
                {
                    return r.GetProperty("status").GetString();
                }
            }
            return null;
        }, "resultado do check", eyes);
        Assert.Equal("passing", checkStatus);

        // tarefa manual executada pelo console
        var task = await admin.PostAsJsonAsync("/api/tasks", new
        {
            agentId = pk, name = "Tarefa EYES", enabled = true, continueOnError = true, alertSeverity = "error", scheduleType = "manual",
            actions = new[] { new { type = "cmd", command = "echo tarefa-ok", shell = "/bin/bash", timeout = 30, runAsUser = false } },
        });
        Assert.Equal(HttpStatusCode.Created, task.StatusCode);
        using (var taskBody = JsonDocument.Parse(await task.Content.ReadAsStringAsync()))
        {
            var taskId = taskBody.RootElement.GetProperty("id").GetInt32();
            Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync($"/api/agents/{pk}/tasks/{taskId}/run", null)).StatusCode);
            var stdout = await EventuallyAsync<string>(async () =>
            {
                using var tasks = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}/tasks"));
                foreach (var t in tasks.RootElement.EnumerateArray())
                {
                    if (t.GetProperty("result") is { ValueKind: JsonValueKind.Object } r && r.GetProperty("stdout").GetString() is { Length: > 0 } s)
                    {
                        return s;
                    }
                }
                return null;
            }, "resultado da tarefa", eyes);
            Assert.Contains("tarefa-ok", stdout);
        }

        // Cybereyes Care: catalogo filtrado para Linux e Health Check
        using (var catalog = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}/care/catalog")))
        {
            var modules = catalog.RootElement.GetProperty("modules").EnumerateArray().Select(m => m.GetProperty("key").GetString()).ToList();
            Assert.Contains("maintenance", modules);
            Assert.DoesNotContain("office", modules);
        }
        var health = await admin.PostAsync($"/api/agents/{pk}/health", null);
        Assert.True(health.IsSuccessStatusCode, await health.Content.ReadAsStringAsync() + eyes.Log);
        using (var report = JsonDocument.Parse(await health.Content.ReadAsStringAsync()))
        {
            var score = report.RootElement.GetProperty("score").GetInt32();
            Assert.InRange(score, 0, 100);
        }

        // app de bandeja: token curto pelo socket local, com o usuario identificado pelo processo
        using (var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified))
        {
            await socket.ConnectAsync(new UnixDomainSocketEndPoint(eyes.TraySocket));
            await socket.SendAsync(Encoding.UTF8.GetBytes("{\"cmd\":\"token\"}\n"));
            var buffer = new byte[8192];
            var n = await socket.ReceiveAsync(buffer);
            using var reply = JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, n));
            Assert.True(reply.RootElement.TryGetProperty("token", out var tok) && tok.GetString()!.Length == 64, Encoding.UTF8.GetString(buffer, 0, n));
            Assert.Equal(Environment.UserName, reply.RootElement.GetProperty("username").GetString());
        }

        // terminal remoto pelo hub do console (PTY real no agente)
        var key = await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "eyes-e2e" })).Content.ReadFromJsonAsync<JsonElement>();
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(fixture.Server.BaseAddress, "/hubs/console"), o =>
            {
                o.HttpMessageHandlerFactory = _ => fixture.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.Headers["X-API-KEY"] = key.GetProperty("key").GetString()!;
            })
            .Build();
        var screen = new StringBuilder();
        var closed = new TaskCompletionSource<int>();
        hub.On<string, string>("terminalOutput", (_, data) =>
        {
            lock (screen)
            {
                screen.Append(Encoding.UTF8.GetString(Convert.FromBase64String(data)));
            }
        });
        hub.On<string, int, string?>("terminalClosed", (_, code, _) => closed.TrySetResult(code));
        await hub.StartAsync();
        var session = await hub.InvokeAsync<string>("StartTerminal", pk, 100, 30, (string?)null);
        await hub.InvokeAsync("TerminalInput", session, "echo term-$((6*7))\n");
        await EventuallyAsync<string>(() =>
        {
            lock (screen)
            {
                return Task.FromResult(screen.ToString().Contains("term-42", StringComparison.Ordinal) ? "ok" : null);
            }
        }, "saida do terminal", eyes);
        await hub.InvokeAsync("TerminalInput", session, "exit 5\n");
        Assert.Equal(5, await closed.Task.WaitAsync(Wait));
        await hub.DisposeAsync();

        // execucao real de um modulo do Cybereyes Care (script bash embutido no agente)
        var careRun = await admin.PostAsJsonAsync($"/api/agents/{pk}/care/runs", new { module = "maintenance", tasks = new[] { "disk_space" } });
        Assert.Equal(HttpStatusCode.Accepted, careRun.StatusCode);
        var runId = (await careRun.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("runId").GetString();
        var careStatus = await EventuallyAsync<string>(async () =>
        {
            var run = await admin.GetFromJsonAsync<JsonElement>($"/api/care/runs/{runId}");
            var status = run.GetProperty("status").GetString();
            return status == "running" ? null : status;
        }, "fim da execucao do Care", eyes);
        Assert.Contains(careStatus, new[] { "ok", "warning" });

        // atualizacao remota: o servidor distribui a UpdateVersion e o agente troca o binario e volta com a versao nova
        if (EyesBinary.BuildVersion(ApiFixture.UpdateVersion, Path.Combine(fixture.AgentBinariesDir, $"eyes-v{ApiFixture.UpdateVersion}-linux-amd64")) is not null
            && System.Runtime.InteropServices.RuntimeInformation.OSArchitecture == System.Runtime.InteropServices.Architecture.X64)
        {
            var update = await admin.PostAsync($"/api/agents/{pk}/update", null);
            Assert.True(update.StatusCode == HttpStatusCode.Accepted, await update.Content.ReadAsStringAsync() + eyes.Log);
            await EventuallyAsync<string>(async () =>
            {
                using var doc = JsonDocument.Parse(await admin.GetStringAsync($"/api/agents/{pk}"));
                return doc.RootElement.GetProperty("version").GetString() == ApiFixture.UpdateVersion ? "ok" : null;
            }, "agente atualizado para " + ApiFixture.UpdateVersion, eyes);
            using var ping2 = JsonDocument.Parse(await (await admin.PostAsync($"/api/agents/{pk}/ping", null)).Content.ReadAsStringAsync());
            Assert.Equal("online", ping2.RootElement.GetProperty("status").GetString());
        }
    }
}
