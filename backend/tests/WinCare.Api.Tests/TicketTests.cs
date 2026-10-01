using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52];

    private async Task<HttpClient> TrayClientAsync(HttpClient agent, string username)
    {
        var issued = await agent.PostAsJsonAsync("/api/v3/traytoken/", new { username });
        Assert.Equal(HttpStatusCode.OK, issued.StatusCode);
        var token = (await issued.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var tray = fixture.NewClient();
        tray.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Tray", token);
        return tray;
    }

    private static MultipartFormDataContent TrayForm(string title, byte[]? screenshot)
    {
        var form = new MultipartFormDataContent { { new StringContent(title), "title" }, { new StringContent("Nao imprime desde ontem"), "description" } };
        if (screenshot is not null)
        {
            form.Add(new ByteArrayContent(screenshot), "screenshot", "tela.png");
        }
        return form;
    }

    [Fact]
    public async Task TrayTicket_ChatUnlocksOnAssignment_AndHidesInternalNotes()
    {
        var (admin, pk, _, agent, _, _) = await RegisteredAgentAsync("Cliente chamados", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, @"EMPRESA\Maria");

        Assert.Equal(HttpStatusCode.BadRequest, (await tray.PostAsync("/api/tray/tickets", TrayForm("Impressora", "nao e imagem"u8.ToArray()))).StatusCode);
        var created = await tray.PostAsync("/api/tray/tickets", TrayForm("Impressora parada", Png));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var ticketId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal("tray", detail.GetProperty("source").GetString());
        Assert.Equal(pk, detail.GetProperty("agentId").GetInt32());
        Assert.Equal(@"empresa\maria", detail.GetProperty("requesterUsername").GetString());
        Assert.Equal("image/png", (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}/attachments"))[0].GetProperty("contentType").GetString());

        var locked = await tray.PostAsJsonAsync($"/api/tray/tickets/{ticketId}/messages", new { body = "Alguem?" });
        Assert.Equal(HttpStatusCode.Conflict, locked.StatusCode);
        Assert.Equal("CHAT_LOCKED", (await locked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        var adminId = (await admin.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetString();
        var assigned = await (await admin.PutAsJsonAsync($"/api/tickets/{ticketId}/assign", new { userId = adminId })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("in_progress", assigned.GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/messages", new { body = "Ja estou verificando", @internal = false })).StatusCode);
        await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/messages", new { body = "Toner vazio, trocar", @internal = true });
        Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync($"/api/tray/tickets/{ticketId}/messages", new { body = "Obrigada!" })).StatusCode);

        var seen = await tray.GetFromJsonAsync<JsonElement>($"/api/tray/tickets/{ticketId}");
        Assert.True(seen.GetProperty("chatEnabled").GetBoolean());
        var bodies = seen.GetProperty("messages").EnumerateArray().Select(m => m.GetProperty("body").GetString()).ToList();
        Assert.Contains("Ja estou verificando", bodies);
        Assert.Contains("Obrigada!", bodies);
        Assert.DoesNotContain("Toner vazio, trocar", bodies);

        var list = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets?agentId={pk}");
        var item = list.GetProperty("items")[0];
        Assert.True(item.GetProperty("unreadForTechnician").GetBoolean());
        Assert.False(item.GetProperty("slaBreached").GetBoolean());

        using var other = await TrayClientAsync(agent, "joao");
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/tray/tickets/{ticketId}")).StatusCode);
        Assert.Empty(await other.GetFromJsonAsync<List<JsonElement>>("/api/tray/tickets") ?? []);
        Assert.Equal(HttpStatusCode.Forbidden, (await tray.GetAsync("/api/tickets")).StatusCode);
    }

    [Fact]
    public async Task TrayHub_ReceivesTechnicianReply_InRealTime()
    {
        var (admin, _, _, agent, _, _) = await RegisteredAgentAsync("Cliente tempo real", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, "ana");
        var ticketId = (await (await tray.PostAsync("/api/tray/tickets", TrayForm("Sem internet", null))).Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(fixture.Server.BaseAddress, "/hubs/tray"), o =>
            {
                o.HttpMessageHandlerFactory = _ => fixture.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.Headers["Authorization"] = tray.DefaultRequestHeaders.Authorization!.ToString();
            })
            .Build();
        var received = new TaskCompletionSource<string>();
        hub.On<int, JsonElement>("ticketMessage", (id, message) =>
        {
            if (id == ticketId && message.GetProperty("authorType").GetString() == "technician")
            {
                received.TrySetResult(message.GetProperty("body").GetString()!);
            }
        });
        await hub.StartAsync();

        await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/messages", new { body = "Nota so do time", @internal = true });
        await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/messages", new { body = "Reinicie o roteador", @internal = false });

        Assert.Equal("Reinicie o roteador", await received.Task.WaitAsync(TimeSpan.FromSeconds(15)));
        await hub.DisposeAsync();
    }

    [Fact]
    public async Task ErrorAlert_OpensIncident_AndResolvingAlertResolvesIt()
    {
        var (admin, pk, agentId, agent, _, _) = await RegisteredAgentAsync("Cliente incidente");
        var checkId = (await (await admin.PostAsJsonAsync("/api/checks", new
        {
            agentId = pk, checkType = "diskspace", name = "Disco", disk = "/", warningThreshold = 30, errorThreshold = 10, failsBeforeAlert = 1,
            alertSeverity = "warning", runInterval = 0, searchLastDays = 1, numberOfEventsBeforeAlert = 1, dashboardAlert = true,
        })).Content.ReadFromJsonAsync<IdOnly>())!.Id;

        await agent.PatchAsJsonAsync("/api/v3/checkrunner/", new { id = checkId, agent_id = agentId, exists = true, percent_used = 97.0, more_info = "Livre: 3 GB" });
        var incident = (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets?agentId={pk}&type=incident")).GetProperty("items")[0];
        Assert.Equal("alert", incident.GetProperty("source").GetString());
        Assert.Equal("high", incident.GetProperty("priority").GetString());
        Assert.Equal("new", incident.GetProperty("status").GetString());
        Assert.StartsWith("[mon-linux]", incident.GetProperty("title").GetString(), StringComparison.Ordinal);

        await agent.PatchAsJsonAsync("/api/v3/checkrunner/", new { id = checkId, agent_id = agentId, exists = true, percent_used = 40.0, more_info = "ok" });
        var id = incident.GetProperty("id").GetInt32();
        Assert.Equal("resolved", (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{id}")).GetProperty("status").GetString());
        var messages = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/tickets/{id}/messages");
        Assert.Contains(messages!, m => m.GetProperty("authorType").GetString() == "system" && m.GetProperty("body").GetString()!.Contains("resolvido", StringComparison.Ordinal));
    }
}
