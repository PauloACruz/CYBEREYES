using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Http.Connections.Client;
using Microsoft.AspNetCore.SignalR.Client;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private HubConnection Hub(string path, Action<HttpConnectionOptions> auth) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(fixture.Server.BaseAddress, path), o =>
            {
                o.HttpMessageHandlerFactory = _ => fixture.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                auth(o);
            })
            .Build();

    [Fact]
    public async Task PeripheralTest_OpensOnTheTray_AndStreamsWhatTheUserTypesToTheConsole()
    {
        var (admin, pk, _, agent, _, _) = await RegisteredAgentAsync("Cliente periféricos", plat: "windows", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, @"EMPRESA\Maria");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.GetAsync($"/api/agents/{pk}/peripheral-tests/current")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await tray.GetAsync("/api/tray/peripheral-test")).StatusCode);

        // O app de bandeja da maquina recebe o pedido pelo hub, qualquer que seja o usuario logado.
        var trayHub = Hub("/hubs/tray", o => o.Headers["Authorization"] = tray.DefaultRequestHeaders.Authorization!.ToString());
        var starts = new List<JsonElement>();
        var started = new TaskCompletionSource<JsonElement>();
        var switched = new TaskCompletionSource<JsonElement>();
        var stopped = new TaskCompletionSource<JsonElement>();
        trayHub.On<JsonElement>("peripheralTestStart", e =>
        {
            lock (starts)
            {
                starts.Add(e);
                (starts.Count == 1 ? started : switched).TrySetResult(e);
            }
        });
        trayHub.On<JsonElement>("peripheralTestStop", e => stopped.TrySetResult(e));
        await trayHub.StartAsync();

        // O console acompanha ao vivo pelo grupo do agente.
        var key = await (await admin.PostAsJsonAsync("/api/apikeys", new { name = "perifericos" })).Content.ReadFromJsonAsync<KeyOnly>();
        var consoleHub = Hub("/hubs/console", o => o.Headers["X-API-KEY"] = key!.Key);
        var typedSeen = new TaskCompletionSource<JsonElement>();
        var endedSeen = new TaskCompletionSource<JsonElement>();
        consoleHub.On<JsonElement>("peripheralTestChanged", dto =>
        {
            if (dto.GetProperty("status").GetString() == "ended")
            {
                endedSeen.TrySetResult(dto);
            }
            else if (dto.TryGetProperty("state", out var state) && state.ValueKind == JsonValueKind.Object)
            {
                typedSeen.TrySetResult(dto);
            }
        });
        await consoleHub.StartAsync();
        await consoleHub.InvokeAsync("JoinPeripheralTests", pk);

        // O app de bandeja com a tela de teste veio com o EYES 3.4.2.
        await SetAgentVersionAsync(pk, "3.4.1");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/peripheral-tests", new { section = "keyboard" })).StatusCode);
        await SetAgentVersionAsync(pk, "3.4.2");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/peripheral-tests", new { section = "impressora" })).StatusCode);
        var created = await admin.PostAsJsonAsync($"/api/agents/{pk}/peripheral-tests", new { section = "keyboard" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var test = await created.Content.ReadFromJsonAsync<JsonElement>();
        var testId = test.GetProperty("id").GetInt64();
        Assert.Equal("pending", test.GetProperty("status").GetString());

        var start = await started.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(testId, start.GetProperty("testId").GetInt64());
        Assert.Equal("keyboard", start.GetProperty("section").GetString());
        Assert.False(string.IsNullOrEmpty(start.GetProperty("technician").GetString()));

        // O app que reconecta acha o teste aberto.
        var open = await tray.GetFromJsonAsync<JsonElement>("/api/tray/peripheral-test");
        Assert.Equal(testId, open.GetProperty("testId").GetInt64());

        var state = new { section = "keyboard", keyboard = new { typed = "Maçã; pé", layout = new { id = "00000409", name = "Inglês (Estados Unidos)" }, verdict = "mismatch" } };
        Assert.Equal(HttpStatusCode.OK, (await tray.PutAsJsonAsync($"/api/tray/peripheral-test/{testId}", new { state })).StatusCode);
        var live = await typedSeen.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal("active", live.GetProperty("status").GetString());
        Assert.Equal(@"empresa\maria", live.GetProperty("username").GetString());
        Assert.Equal("Maçã; pé", live.GetProperty("state").GetProperty("keyboard").GetProperty("typed").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await tray.PutAsJsonAsync($"/api/tray/peripheral-test/{testId}", new { state = "texto" })).StatusCode);
        var huge = new { state = new { section = "keyboard", typed = new string('a', 70_000) } };
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await tray.PutAsJsonAsync($"/api/tray/peripheral-test/{testId}", huge)).StatusCode);

        // Com o teste aberto, o tecnico troca a secao: o mesmo teste, sem novo pedido ao usuario.
        var again = await admin.PostAsJsonAsync($"/api/agents/{pk}/peripheral-tests", new { section = "usb" });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(testId, (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64());
        Assert.Equal("usb", (await switched.Task.WaitAsync(TimeSpan.FromSeconds(15))).GetProperty("section").GetString());

        var current = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/peripheral-tests/current");
        Assert.Equal("usb", current.GetProperty("section").GetString());
        Assert.Equal("mismatch", current.GetProperty("state").GetProperty("keyboard").GetProperty("verdict").GetString());

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/agents/{pk}/peripheral-tests/{testId}/end", null)).StatusCode);
        Assert.Equal(testId, (await stopped.Task.WaitAsync(TimeSpan.FromSeconds(15))).GetProperty("testId").GetInt64());
        Assert.Equal("ended", (await endedSeen.Task.WaitAsync(TimeSpan.FromSeconds(15))).GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await tray.PutAsJsonAsync($"/api/tray/peripheral-test/{testId}", new { state })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await tray.GetAsync("/api/tray/peripheral-test")).StatusCode);

        // O ultimo teste continua no console depois de encerrado, com o que o usuario digitou.
        var last = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/peripheral-tests/current");
        Assert.Equal("ended", last.GetProperty("status").GetString());
        Assert.Equal("Maçã; pé", last.GetProperty("state").GetProperty("keyboard").GetProperty("typed").GetString());

        // O usuario tambem encerra pelo app.
        var second = (await (await admin.PostAsJsonAsync($"/api/agents/{pk}/peripheral-tests", new { section = "camera" })).Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt64();
        Assert.NotEqual(testId, second);
        Assert.Equal(HttpStatusCode.OK, (await tray.PostAsync($"/api/tray/peripheral-test/{second}/end", null)).StatusCode);
        var byUser = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/peripheral-tests/current");
        Assert.Equal(@"usuário empresa\maria", byUser.GetProperty("endedBy").GetString());

        // O app de outra maquina nao mexe no teste desta.
        var (_, _, _, otherAgent, _, _) = await RegisteredAgentAsync("Cliente periféricos 2", plat: "windows", monitoringType: "workstation");
        using var otherTray = await TrayClientAsync(otherAgent, "joao");
        Assert.Equal(HttpStatusCode.NotFound, (await otherTray.PutAsJsonAsync($"/api/tray/peripheral-test/{second}", new { state })).StatusCode);

        await trayHub.DisposeAsync();
        await consoleHub.DisposeAsync();
    }
}
