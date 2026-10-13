using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using DotNet.Testcontainers.Builders;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Apps;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Theory]
    [InlineData("200-399", 200, true)]
    [InlineData("200-399", 302, true)]
    [InlineData("200-399", 404, false)]
    [InlineData("200, 204 ,301-302", 301, true)]
    [InlineData("200,204", 500, false)]
    public void StatusMatcher_AcceptsRangesAndLists(string spec, int status, bool expected) =>
        Assert.Equal(expected, StatusMatcher.Matches(spec, status));

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("399-200")]
    [InlineData("99")]
    [InlineData("200-700")]
    public void StatusMatcher_RejectsInvalidSpecs(string spec) => Assert.False(StatusMatcher.IsValid(spec));

    [Fact]
    public void RemoteScript_KeepsQuotesAndChangesToTheAppFolder()
    {
        var command = RemoteScript.Build("echo \"$HOME\" 'x'\r\ngit pull", new RemoteScript.AppContext("Loja d'Ana", "https://loja.exemplo.com", "~/apps/loja", null, "main"),
            deploy: true);
        Assert.StartsWith("bash -lc \"$(printf '%s' '", command, StringComparison.Ordinal);
        Assert.EndsWith("' | base64 -d)\" cybereyes </dev/null 2>&1", command, StringComparison.Ordinal);
        var encoded = command.Split('\'')[3];
        var script = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
        Assert.Equal(
            "export CYBEREYES_APP='Loja d'\\''Ana'\nexport CYBEREYES_APP_URL='https://loja.exemplo.com'\nexport DEPLOY_PATH='~/apps/loja'\n" +
            "export DEPLOY_BRANCH='main'\ncd -- \"$HOME\"/'apps/loja' || exit 97\nset -e\necho \"$HOME\" 'x'\ngit pull\n", script);
        Assert.Equal("cd -- '/srv/a b'\n", RemoteScript.ChangeDirectory("/srv/a b"));
    }

    private async Task<(HttpClient Admin, int ClientId)> AppsClientAsync(string name)
    {
        var (admin, clientId, _) = await NewSiteAsync(name);
        return (admin, clientId);
    }

    private static object AppBody(int clientId, int? serverId, string name, string target, string? deployScript = null, string checkType = "http",
        string? keyword = null, string? deployPath = null) => new
    {
        clientId, serverId, name, environment = "producao", stack = "Node.js", url = checkType == "http" ? target : null, notes = (string?)null,
        monitorEnabled = true, checkType, checkTarget = target, method = "GET", expectedStatus = "200-399", keyword, intervalSeconds = 60,
        timeoutSeconds = 5, failuresBeforeAlert = 2, alertSeverity = "error", ignoreTlsErrors = false, sslWarnDays = 14, deployPath,
        repoUrl = (string?)null, branch = "main", deployScript, deployTimeoutMinutes = 5,
    };

    [Fact]
    public async Task WebApps_ServersGroupApps_AndNeverReturnSecrets()
    {
        var (admin, clientId) = await AppsClientAsync("Cliente aplicacoes");
        var (_, otherClient) = await AppsClientAsync("Cliente aplicacoes 2");

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/webapps/servers", new
        {
            clientId, name = "VPS", host = "http://1.2.3.4", port = 22, username = "root", authMethod = "password", password = "x",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/webapps/servers", new
        {
            clientId, name = "VPS", host = "1.2.3.4", port = 22, username = "root", authMethod = "key", privateKey = "nao e uma chave",
        })).StatusCode);

        var created = await admin.PostAsJsonAsync("/api/webapps/servers", new
        {
            clientId, name = "VPS principal", host = "203.0.113.10", port = 2222, username = "deploy", authMethod = "password", password = "senha-secreta",
            provider = "Hostinger",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var server = await created.Content.ReadFromJsonAsync<JsonElement>();
        var serverId = server.GetProperty("id").GetInt32();
        Assert.True(server.GetProperty("hasPassword").GetBoolean());
        Assert.DoesNotContain("senha-secreta", server.GetRawText(), StringComparison.Ordinal);

        var site = await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, serverId, "Site institucional", "https://site.exemplo.com/health"));
        Assert.Equal(HttpStatusCode.Created, site.StatusCode);
        Assert.Equal(HttpStatusCode.Created,
            (await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, serverId, "API", "https://api.exemplo.com", "git pull"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, null, "Blog na hospedagem", "https://blog.exemplo.com"))).StatusCode);

        var invalid = await admin.PostAsJsonAsync("/api/webapps", AppBody(otherClient, serverId, "Outro cliente", "ftp://x", "git pull"));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var errors = (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("serverId", out _));
        Assert.True(errors.TryGetProperty("checkTarget", out _));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, null, "Deploy sem servidor", "https://x.exemplo.com", "git pull"))).StatusCode);

        var overview = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/overview?clientId={clientId}");
        Assert.Equal(serverId, Assert.Single(overview.GetProperty("servers").EnumerateArray()).GetProperty("id").GetInt32());
        var apps = overview.GetProperty("apps").EnumerateArray().ToList();
        Assert.Equal(3, apps.Count);
        Assert.Equal(2, apps.Count(a => a.GetProperty("serverId").ValueKind == JsonValueKind.Number));
        Assert.True(apps.Single(a => a.GetProperty("name").GetString() == "API").GetProperty("hasDeploy").GetBoolean());
        Assert.All(apps, a => Assert.Equal("pending", a.GetProperty("status").GetString()));
        var search = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/overview?clientId={clientId}&search=blog");
        Assert.Equal("Blog na hospedagem", Assert.Single(search.GetProperty("apps").EnumerateArray()).GetProperty("name").GetString());

        // Senha vazia na edicao mantem a salva, mas nao vai para outro endereco: trocar o host exige a senha e libera a chave fixada.
        await InDbAsync(db => db.AppServers.Where(s => s.Id == serverId).ExecuteUpdateAsync(s => s.SetProperty(x => x.HostKeyFingerprint, "abc")));
        var keep = await admin.PutAsJsonAsync($"/api/webapps/servers/{serverId}", new
        {
            clientId, name = "VPS renomeada", host = "203.0.113.10", port = 2222, username = "deploy", authMethod = "password", password = "",
        });
        Assert.Equal("abc", (await keep.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hostKeyFingerprint").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/webapps/servers/{serverId}", new
        {
            clientId, name = "VPS principal", host = "198.51.100.66", port = 2222, username = "deploy", authMethod = "password", password = "",
        })).StatusCode);
        var elsewhere = await (await admin.PostAsJsonAsync("/api/webapps/servers/test", new
        {
            id = serverId, clientId, name = "VPS principal", host = "127.0.0.1", port = 1, username = "deploy", authMethod = "password", password = "",
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("SSH_NO_SECRET", elsewhere.GetProperty("code").GetString());
        var updated = await admin.PutAsJsonAsync($"/api/webapps/servers/{serverId}", new
        {
            clientId, name = "VPS principal", host = "203.0.113.11", port = 2222, username = "deploy", authMethod = "password", password = "senha-secreta",
        });
        var updatedBody = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(updatedBody.GetProperty("hasPassword").GetBoolean());
        Assert.Equal(JsonValueKind.Null, updatedBody.GetProperty("hostKeyFingerprint").ValueKind);

        var revealed = await (await admin.PostAsync($"/api/webapps/servers/{serverId}/reveal", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("senha-secreta", revealed.GetProperty("password").GetString());

        // Credencial da aplicacao fica no cofre, ligada a ela.
        var siteId = (await site.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/credentials", new
        {
            clientId = otherClient, name = "Painel", secret = "x", webAppId = siteId,
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/credentials", new
        {
            clientId, name = "Painel WordPress", username = "admin", secret = "senha-do-painel", webAppId = siteId,
        })).StatusCode);
        var credentials = await admin.GetFromJsonAsync<JsonElement>($"/api/credentials?webAppId={siteId}");
        var credential = Assert.Single(credentials.EnumerateArray());
        Assert.Equal("Site institucional", credential.GetProperty("webAppName").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/webapps/servers/{serverId}")).StatusCode);
        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/{siteId}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("serverId").ValueKind);
    }

    [Fact]
    public async Task WebAppMonitor_RaisesAlertAfterConsecutiveFailures_AndResolvesOnRecovery()
    {
        var (admin, clientId) = await AppsClientAsync("Cliente monitor web");
        await using var site = FakeSite.Start();
        var created = await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, null, "Loja", site.Url + "health", keyword: "tudo certo"));
        var appId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var monitor = fixture.Services.GetRequiredService<WebAppMonitor>();

        site.Respond(HttpStatusCode.OK, "status: tudo certo");
        var first = await monitor.CheckNowAsync(appId, default);
        Assert.True(first!.Up);
        Assert.NotNull(first.LatencyMs);

        site.Respond(HttpStatusCode.OK, "manutencao");
        var keyword = await monitor.CheckNowAsync(appId, default);
        Assert.False(keyword!.Up);
        Assert.Contains("tudo certo", keyword.Error, StringComparison.Ordinal);
        var stillUp = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/{appId}");
        Assert.Equal("up", stillUp.GetProperty("status").GetString());
        Assert.Equal(0, await InDbAsync(db => db.Alerts.CountAsync(a => a.WebAppId == appId)));

        site.Respond(HttpStatusCode.BadGateway, "erro");
        var second = await monitor.CheckNowAsync(appId, default);
        Assert.Contains("502", second!.Error, StringComparison.Ordinal);
        var down = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/{appId}");
        Assert.Equal("down", down.GetProperty("status").GetString());
        var alerts = await admin.GetFromJsonAsync<JsonElement>("/api/alerts?status=active&pageSize=200");
        var alert = Assert.Single(alerts.GetProperty("items").EnumerateArray(), a => a.GetProperty("webAppId").ValueKind == JsonValueKind.Number &&
            a.GetProperty("webAppId").GetInt32() == appId);
        Assert.Equal("webapp_down", alert.GetProperty("alertType").GetString());
        Assert.Equal("Loja", alert.GetProperty("webAppName").GetString());
        Assert.Equal("Cliente monitor web", alert.GetProperty("clientName").GetString());

        // Mais uma falha nao abre outro alerta.
        await monitor.CheckNowAsync(appId, default);
        Assert.Equal(1, await InDbAsync(db => db.Alerts.CountAsync(a => a.WebAppId == appId && !a.Resolved)));

        site.Respond(HttpStatusCode.OK, "tudo certo");
        Assert.True((await monitor.CheckNowAsync(appId, default))!.Up);
        Assert.Equal(0, await InDbAsync(db => db.Alerts.CountAsync(a => a.WebAppId == appId && !a.Resolved)));
        var checks = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/{appId}/checks?hours=1");
        Assert.Equal(40, checks.GetProperty("uptime").GetProperty("h24").GetDouble());
        Assert.Single(checks.GetProperty("outages").EnumerateArray());
        Assert.NotEmpty(checks.GetProperty("points").EnumerateArray());

        // Desligar o monitoramento pausa e fecha os alertas.
        var paused = await admin.PutAsJsonAsync($"/api/webapps/{appId}", new Dictionary<string, object?>
        {
            ["clientId"] = clientId, ["name"] = "Loja", ["url"] = site.Url, ["monitorEnabled"] = false, ["checkType"] = "http", ["checkTarget"] = site.Url,
        });
        Assert.Equal("paused", (await paused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task WebAppMonitor_TcpCheck_ReportsRefusedPorts()
    {
        var (admin, clientId) = await AppsClientAsync("Cliente monitor tcp");
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var created = await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, null, "Postgres", $"127.0.0.1:{port}", checkType: "tcp"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var appId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var monitor = fixture.Services.GetRequiredService<WebAppMonitor>();
        Assert.True((await monitor.CheckNowAsync(appId, default))!.Up);
        listener.Stop();
        var refused = await monitor.CheckNowAsync(appId, default);
        Assert.False(refused!.Up);
        Assert.Contains("recusada", refused.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WebApps_SshServer_TestRunDeployCancelTerminalAndHostKey()
    {
        const string password = "senha-ssh-teste";
        await using var sshd = new ContainerBuilder("lscr.io/linuxserver/openssh-server:latest")
            .WithEnvironment("PUID", "1000").WithEnvironment("PGID", "1000").WithEnvironment("PASSWORD_ACCESS", "true")
            .WithEnvironment("USER_NAME", "deploy").WithEnvironment("USER_PASSWORD", password)
            .WithPortBinding(2222, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilMessageIsLogged("ls.io-init\\] done"))
            .Build();
        await sshd.StartAsync();
        var port = sshd.GetMappedPublicPort(2222);
        var (admin, clientId) = await AppsClientAsync("Cliente ssh");

        var draft = new { clientId, name = "VPS de teste", host = "127.0.0.1", port, username = "deploy", authMethod = "password", password };
        var wrong = await (await admin.PostAsJsonAsync("/api/webapps/servers/test", draft with { password = "errada" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(wrong.GetProperty("ok").GetBoolean());
        Assert.Equal("SSH_AUTH_FAILED", wrong.GetProperty("code").GetString());
        var probe = await (await admin.PostAsJsonAsync("/api/webapps/servers/test", draft)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(probe.GetProperty("ok").GetBoolean(), probe.GetRawText());
        Assert.Contains("Linux", probe.GetProperty("system").GetString(), StringComparison.Ordinal);
        var fingerprint = probe.GetProperty("fingerprint").GetString()!;

        var created = await admin.PostAsJsonAsync("/api/webapps/servers", new
        {
            clientId, name = "VPS de teste", host = "127.0.0.1", port, username = "deploy", authMethod = "password", password, hostKeyFingerprint = fingerprint,
        });
        var serverId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var app = await admin.PostAsJsonAsync("/api/webapps", AppBody(clientId, serverId, "App", "https://app.exemplo.com",
            "echo \"deploy de $CYBEREYES_APP na $DEPLOY_BRANCH em $(pwd)\"\nfalse\necho nao-chega", deployPath: "/tmp"));
        var appId = (await app.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var runner = fixture.Services.GetRequiredService<AppRunner>();

        // Comando avulso na pasta da aplicacao: saida, codigo de saida e acentos.
        var started = await admin.PostAsJsonAsync($"/api/webapps/servers/{serverId}/run", new { script = "echo 'ação' && pwd && exit 3", webAppId = appId });
        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        var runId = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        await runner.WhenIdleAsync();
        var run = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/runs/{runId}");
        Assert.Equal("failed", run.GetProperty("status").GetString());
        Assert.Equal(3, run.GetProperty("exitCode").GetInt32());
        Assert.Equal("ação\n/tmp\n", run.GetProperty("output").GetString());

        // Deploy com set -e: para na primeira falha.
        var deploy = await (await admin.PostAsync($"/api/webapps/{appId}/deploy", null)).Content.ReadFromJsonAsync<JsonElement>();
        await runner.WhenIdleAsync();
        var deployRun = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/runs/{deploy.GetProperty("id").GetInt64()}");
        Assert.Equal("failed", deployRun.GetProperty("status").GetString());
        Assert.Equal("deploy de App na main em /tmp\n", deployRun.GetProperty("output").GetString());
        var history = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/runs?webAppId={appId}");
        Assert.Equal(2, history.GetProperty("total").GetInt32());

        // Comando salvo e cancelamento.
        var saved = await admin.PostAsJsonAsync("/api/webapps/commands", new { serverId, name = "Espera", script = "echo inicio; sleep 60; echo fim", confirm = true });
        var commandId = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var commands = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/commands?webAppId={appId}");
        Assert.Contains(commands.EnumerateArray(), c => c.GetProperty("id").GetInt32() == commandId);
        var longRun = (await (await admin.PostAsJsonAsync($"/api/webapps/servers/{serverId}/run", new { commandId })).Content
            .ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        await WaitForAsync(async () => (await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/runs/{longRun}")).GetProperty("output").GetString()!
            .Contains("inicio", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync($"/api/webapps/runs/{longRun}/cancel", null)).StatusCode);
        await runner.WhenIdleAsync();
        var cancelled = await admin.GetFromJsonAsync<JsonElement>($"/api/webapps/runs/{longRun}");
        Assert.Equal("cancelled", cancelled.GetProperty("status").GetString());
        Assert.DoesNotContain("fim", cancelled.GetProperty("output").GetString(), StringComparison.Ordinal);

        // Terminal interativo pelo hub, aberto na pasta da aplicacao.
        var key = await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "ssh-terminal" })).Content.ReadFromJsonAsync<JsonElement>();
        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(fixture.Server.BaseAddress, "/hubs/console"), o =>
            {
                o.HttpMessageHandlerFactory = _ => fixture.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.Headers["X-API-KEY"] = key.GetProperty("key").GetString()!;
            })
            .Build();
        var screen = new StringBuilder();
        hub.On<string, string>("terminalOutput", (_, data) =>
        {
            lock (screen)
            {
                screen.Append(Encoding.UTF8.GetString(Convert.FromBase64String(data)));
            }
        });
        await hub.StartAsync();
        var sessionId = await hub.InvokeAsync<string>("StartSshTerminal", serverId, appId, 100, 30);
        await hub.InvokeAsync("TerminalInput", sessionId, "echo soma=$((40+2)) em $(pwd)\n");
        await WaitForAsync(() =>
        {
            lock (screen)
            {
                return Task.FromResult(screen.ToString().Contains("soma=42 em /tmp", StringComparison.Ordinal));
            }
        });
        await hub.InvokeAsync("ResizeTerminal", sessionId, 120, 40);
        await hub.InvokeAsync("StopTerminal", sessionId);

        // Chave diferente da fixada: recusa e so volta depois de liberar no cadastro.
        await InDbAsync(db => db.AppServers.Where(s => s.Id == serverId).ExecuteUpdateAsync(s => s.SetProperty(x => x.HostKeyFingerprint, "outra-chave")));
        var mismatch = await (await admin.PostAsync($"/api/webapps/servers/{serverId}/test", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("HOST_KEY_MISMATCH", mismatch.GetProperty("code").GetString());
        Assert.Equal(fingerprint, mismatch.GetProperty("fingerprint").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/webapps/servers/{serverId}/reset-host-key", null)).StatusCode);
        var again = await (await admin.PostAsync($"/api/webapps/servers/{serverId}/test", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(again.GetProperty("ok").GetBoolean());
        Assert.Equal(fingerprint, await InDbAsync(db => db.AppServers.Where(s => s.Id == serverId).Select(s => s.HostKeyFingerprint).SingleAsync()));
    }

    private static async Task WaitForAsync(Func<Task<bool>> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!await condition())
        {
            Assert.True(DateTime.UtcNow < deadline, "Tempo esgotado esperando a condicao");
            await Task.Delay(200);
        }
    }

    /// <summary>Site local com resposta configuravel para o monitor.</summary>
    private sealed class FakeSite : IAsyncDisposable
    {
        private readonly HttpListener listener = new();
        private readonly Task loop;
        private (HttpStatusCode Status, string Body) response = (HttpStatusCode.OK, "ok");

        private FakeSite(int port)
        {
            Url = $"http://127.0.0.1:{port}/";
            listener.Prefixes.Add(Url);
            listener.Start();
            loop = Task.Run(ServeAsync);
        }

        public string Url { get; }

        public static FakeSite Start()
        {
            using var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            var port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            return new FakeSite(port);
        }

        public void Respond(HttpStatusCode status, string body) => response = (status, body);

        private async Task ServeAsync()
        {
            while (listener.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = await listener.GetContextAsync();
                }
                catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException or InvalidOperationException)
                {
                    return;
                }
                var (status, body) = response;
                context.Response.StatusCode = (int)status;
                var bytes = Encoding.UTF8.GetBytes(body);
                await context.Response.OutputStream.WriteAsync(bytes);
                context.Response.Close();
            }
        }

        public async ValueTask DisposeAsync()
        {
            listener.Stop();
            listener.Close();
            await loop;
        }
    }
}
