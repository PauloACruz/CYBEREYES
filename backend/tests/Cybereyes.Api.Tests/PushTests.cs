using System.Buffers.Text;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    /// <summary>Inscreve um aparelho com chaves de navegador validas e devolve o endereco dele.</summary>
    private static async Task<string> SubscribeAsync(HttpClient client, string name, bool newTickets = true, bool updates = true, bool messages = true)
    {
        var endpoint = $"https://fcm.googleapis.com/fcm/send/{name}-{Guid.NewGuid():N}";
        var response = await SubscribeRequestAsync(client, endpoint, $"Chrome ({name})", newTickets, updates, messages);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return endpoint;
    }

    private static Task<HttpResponseMessage> SubscribeRequestAsync(HttpClient client, string endpoint, string? device = null, bool newTickets = true,
        bool updates = true, bool messages = true)
    {
        using var browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var q = browser.ExportParameters(false).Q;
        return client.PutAsJsonAsync("/api/push/subscription", new
        {
            endpoint,
            p256dh = Base64Url.EncodeToString([4, .. q.X!, .. q.Y!]),
            auth = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
            device,
            newTickets, updates, messages,
        });
    }

    [Fact]
    public async Task Push_SubscriptionBelongsToTheUser_AndOnlyBrowserPushServicesAreAccepted()
    {
        var admin = await fixture.AdminClientAsync();
        var config = await admin.GetFromJsonAsync<JsonElement>("/api/push/config");
        var publicKey = config.GetProperty("publicKey").GetString()!;
        Assert.Equal(65, Base64Url.DecodeFromChars(publicKey).Length);
        Assert.Equal(publicKey, (await admin.GetFromJsonAsync<JsonElement>("/api/push/config")).GetProperty("publicKey").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.NewClient().GetAsync("/api/push/config")).StatusCode);

        var badKey = new { endpoint = "https://fcm.googleapis.com/fcm/send/x", p256dh = "BAAA", auth = "AAAAAAAAAAAAAAAAAAAAAA", newTickets = true, updates = true, messages = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/push/subscription", badKey)).StatusCode);
        var internalHost = await SubscribeRequestAsync(admin, "https://169.254.169.254/latest/meta-data");
        Assert.Equal(HttpStatusCode.BadRequest, internalHost.StatusCode);

        var endpoint = await SubscribeAsync(admin, "proprio", newTickets: false);
        var found = await (await admin.PostAsJsonAsync("/api/push/subscription/find", new { endpoint })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(found.GetProperty("newTickets").GetBoolean());
        Assert.True(found.GetProperty("messages").GetBoolean());
        Assert.Equal("Chrome (proprio)", found.GetProperty("device").GetString());

        var roles = await admin.GetFromJsonAsync<List<RoleRow>>("/api/roles");
        await fixture.CreateUserAsync(admin, "outro.push", "senha-outro-push-1", roles!.Single(r => r.Name == "Tecnico").Id);
        var other = await fixture.SignedInClientAsync("outro.push", "senha-outro-push-1");
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync("/api/push/subscription/find", new { endpoint })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync("/api/push/test", new { endpoint })).StatusCode);
        await other.PostAsJsonAsync("/api/push/subscription/delete", new { endpoint });

        var test = await (await admin.PostAsJsonAsync("/api/push/test", new { endpoint })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(test.GetProperty("delivered").GetBoolean());
        Assert.Equal("Notificações ativas", Assert.Single(fixture.Pushes.For(endpoint)).Title);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync("/api/push/subscription/delete", new { endpoint })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/push/subscription/find", new { endpoint })).StatusCode);
    }

    [Fact]
    public async Task Push_TicketEvents_ReachTheResponsibleAndTheTeam_ButNotTheActor()
    {
        var (admin, _, _, agent, _, _) = await RegisteredAgentAsync("Cliente push", monitoringType: "workstation");
        var (_, _, _, _, hiddenClientId, _) = await RegisteredAgentAsync("Cliente push oculto");
        var tecnicoRole = (await admin.GetFromJsonAsync<List<RoleRow>>("/api/roles"))!.Single(r => r.Name == "Tecnico").Id;
        await fixture.CreateUserAsync(admin, "tec.push", "senha-tec-push-1", tecnicoRole);
        var tec = await fixture.SignedInClientAsync("tec.push", "senha-tec-push-1");
        var restricted = await admin.PostAsJsonAsync("/api/users", new
        {
            username = "tec.push.fora", email = "tec.push.fora@exemplo.com", fullName = "Tecnico de outro cliente", password = "senha-tec-fora-1",
            roleIds = new[] { tecnicoRole }, allClients = false, clientIds = new[] { hiddenClientId }, isActive = true,
        });
        Assert.Equal(HttpStatusCode.Created, restricted.StatusCode);
        var outsider = await fixture.SignedInClientAsync("tec.push.fora", "senha-tec-fora-1");

        var adminDevice = await SubscribeAsync(admin, "admin");
        var tecDevice = await SubscribeAsync(tec, "tec");
        var quietDevice = await SubscribeAsync(tec, "tec-so-mudancas", newTickets: false, messages: false);
        var staleDevice = await SubscribeAsync(tec, "tec-velho");
        var outsiderDevice = await SubscribeAsync(outsider, "fora");
        fixture.Pushes.MarkGone(staleDevice);

        using var tray = await TrayClientAsync(agent, @"EMPRESA\Joana");
        var created = await tray.PostAsync("/api/tray/tickets", TrayForm("Sem internet na recepcao", null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var tag = $"chamado-{id}";

        var opened = await fixture.Pushes.WaitAsync(adminDevice, m => m.Tag == tag);
        Assert.Equal($"Novo chamado #{id}", opened.Title);
        Assert.StartsWith("Sem internet na recepcao · ", opened.Body);
        Assert.Contains("Cliente push", opened.Body);
        Assert.Equal($"/chamados/{id}", opened.Url);
        await fixture.Pushes.WaitAsync(tecDevice, m => m.Title == $"Novo chamado #{id}");

        var tecId = (await tec.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/tickets/{id}/assign", new { userId = tecId })).StatusCode);
        await fixture.Pushes.WaitAsync(tecDevice, m => m.Title == $"#{id} atribuído a você");
        await fixture.Pushes.WaitAsync(quietDevice, m => m.Title == $"#{id} atribuído a você");

        Assert.Equal(HttpStatusCode.Created,
            (await tray.PostAsJsonAsync($"/api/tray/tickets/{id}/messages", new { body = "Ainda   sem internet\naqui" })).StatusCode);
        var message = await fixture.Pushes.WaitAsync(tecDevice, m => m.Title.StartsWith($"#{id} · Mensagem de", StringComparison.Ordinal));
        Assert.Equal("Ainda sem internet aqui", message.Body);

        // O proprio responsavel responde: ninguem e avisado (ele fez a acao e o admin nao e o responsavel).
        await tec.PostAsJsonAsync($"/api/tickets/{id}/messages", new { body = "Reiniciando o roteador", @internal = false });
        await admin.PostAsJsonAsync($"/api/tickets/{id}/messages", new { body = "Conferir o cabo do switch", @internal = true });
        var note = await fixture.Pushes.WaitAsync(tecDevice, m => m.Title.Contains("Nota interna", StringComparison.Ordinal));
        Assert.Equal("Conferir o cabo do switch", note.Body);

        await admin.PutAsJsonAsync($"/api/tickets/{id}/status", new { status = "waiting_user" });
        await fixture.Pushes.WaitAsync(quietDevice, m => m.Title == $"#{id} agora está aguardando o usuário");
        await fixture.Pushes.WaitAsync(tecDevice, m => m.Title == $"#{id} agora está aguardando o usuário");

        // O despachante trata os eventos em ordem: depois do ultimo, os anteriores ja foram decididos.
        Assert.Single(fixture.Pushes.For(adminDevice), m => m.Tag == tag);
        Assert.DoesNotContain(fixture.Pushes.For(outsiderDevice), m => m.Tag == tag);
        Assert.DoesNotContain(fixture.Pushes.For(tecDevice), m => m.Body == "Reiniciando o roteador");
        Assert.All(fixture.Pushes.For(quietDevice).Where(m => m.Tag == tag), m => Assert.DoesNotContain("Mensagem", m.Title, StringComparison.Ordinal));
        Assert.DoesNotContain(fixture.Pushes.For(quietDevice), m => m.Title.StartsWith("Novo chamado", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.NotFound, (await tec.PostAsJsonAsync("/api/push/subscription/find", new { endpoint = staleDevice })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tec.PostAsJsonAsync("/api/push/subscription/find", new { endpoint = tecDevice })).StatusCode);
    }

    private sealed record RoleRow(Guid Id, string Name);
}
