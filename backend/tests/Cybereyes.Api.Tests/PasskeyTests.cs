using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Cybereyes.Core.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Cybereyes.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class PasskeyTests(ApiFixture fixture)
{
    private const string Origin = "https://rmm.exemplo.com";
    private const string IphoneAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

    private async Task<HttpClient> TechnicianAsync(string username, string password)
    {
        var admin = await fixture.AdminClientAsync();
        var roles = await admin.GetFromJsonAsync<List<RoleBody>>("/api/roles");
        await fixture.CreateUserAsync(admin, username, password, roles!.Single(r => r.Name == "Tecnico").Id);
        return await fixture.SignedInClientAsync(username, password);
    }

    private static async Task<HttpResponseMessage> RegisterAsync(HttpClient client, SoftwareAuthenticator authenticator)
    {
        var options = await client.PostAsync("/api/auth/passkeys/register/options", null);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        var credential = authenticator.Create(await options.Content.ReadFromJsonAsync<JsonElement>());
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/passkeys/register") { Content = JsonContent.Create(new { credential }) };
        request.Headers.UserAgent.ParseAdd(IphoneAgent);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> PasskeyLoginAsync(HttpClient client, SoftwareAuthenticator authenticator)
    {
        var options = await client.PostAsync("/api/auth/passkeys/login/options", null);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        var credential = authenticator.Get(await options.Content.ReadFromJsonAsync<JsonElement>());
        return await client.PostAsJsonAsync("/api/auth/passkeys/login", new { credential });
    }

    private static async Task<string> StatusOf(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ApiFixture.StatusBody>())!.Status;
    }

    [Fact]
    public async Task RegisterOptions_AskForTheDeviceBiometricsAndADiscoverableCredential()
    {
        var phone = await TechnicianAsync("bio-opcoes", "senha-bio-opcoes-1");

        var options = await (await phone.PostAsync("/api/auth/passkeys/register/options", null)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("rmm.exemplo.com", options.GetProperty("rp").GetProperty("id").GetString());
        Assert.Equal("bio-opcoes", options.GetProperty("user").GetProperty("name").GetString());
        var selection = options.GetProperty("authenticatorSelection");
        Assert.Equal("platform", selection.GetProperty("authenticatorAttachment").GetString());
        Assert.Equal("required", selection.GetProperty("residentKey").GetString());
        Assert.Equal("required", selection.GetProperty("userVerification").GetString());
    }

    [Fact]
    public async Task Biometrics_ReplacesThePassword_AndTheCodeIsAskedOncePerDeviceEveryThirtyDays()
    {
        var phone = await TechnicianAsync("bio-tecnico", "senha-bio-tecnico-1");
        using var authenticator = new SoftwareAuthenticator(Origin);

        var registered = await RegisterAsync(phone, authenticator);
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        var passkey = await registered.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("iPhone", passkey.GetProperty("name").GetString());
        Assert.Equal(authenticator.CredentialId, passkey.GetProperty("id").GetString());
        var list = await phone.GetFromJsonAsync<List<JsonElement>>("/api/auth/passkeys");
        Assert.Single(list!);

        // Aparelho ainda nao lembrado: a biometria substitui a senha, mas o codigo do autenticador continua sendo pedido.
        await phone.PostAsync("/api/auth/logout", null);
        Assert.Equal("requires2fa", await StatusOf(await PasskeyLoginAsync(phone, authenticator)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/auth/me")).StatusCode);
        var verify = await phone.PostAsJsonAsync("/api/auth/login/2fa", new { code = fixture.CurrentCode("bio-tecnico"), rememberDevice = true });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);

        // Dentro dos 30 dias: so a biometria.
        await phone.PostAsync("/api/auth/logout", null);
        Assert.Equal("ok", await StatusOf(await PasskeyLoginAsync(phone, authenticator)));
        var me = await phone.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal("bio-tecnico", me.GetProperty("username").GetString());
        Assert.True(me.GetProperty("mfaSatisfied").GetBoolean());

        // Outro navegador (sem o cookie do aparelho lembrado) volta a pedir o codigo.
        Assert.Equal("requires2fa", await StatusOf(await PasskeyLoginAsync(fixture.NewClient(), authenticator)));
    }

    [Fact]
    public async Task Login_RejectsReplayedAssertions_MissingChallengeAndRemovedPasskeys()
    {
        var phone = await TechnicianAsync("bio-replay", "senha-bio-replay-1");
        using var authenticator = new SoftwareAuthenticator(Origin);
        Assert.Equal(HttpStatusCode.Created, (await RegisterAsync(phone, authenticator)).StatusCode);

        var client = fixture.NewClient();
        var options = await (await client.PostAsync("/api/auth/passkeys/login/options", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(options.GetProperty("allowCredentials").EnumerateArray());
        var credential = authenticator.Get(options);
        Assert.Equal("requires2fa", await StatusOf(await client.PostAsJsonAsync("/api/auth/passkeys/login", new { credential })));

        // A mesma resposta de novo: o desafio ja foi consumido.
        var replay = await client.PostAsJsonAsync("/api/auth/passkeys/login", new { credential });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        // Resposta antiga contra um desafio novo: desafio e contador nao batem.
        await client.PostAsync("/api/auth/passkeys/login/options", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/passkeys/login", new { credential })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await phone.DeleteAsync($"/api/auth/passkeys/{authenticator.CredentialId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PasskeyLoginAsync(fixture.NewClient(), authenticator)).StatusCode);
        Assert.Empty((await phone.GetFromJsonAsync<List<JsonElement>>("/api/auth/passkeys"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await phone.DeleteAsync($"/api/auth/passkeys/{authenticator.CredentialId}")).StatusCode);
    }

    [Fact]
    public async Task ResettingTwoFactor_RemovesTheBiometrics()
    {
        var phone = await TechnicianAsync("bio-perdido", "senha-bio-perdido-1");
        using var authenticator = new SoftwareAuthenticator(Origin);
        Assert.Equal(HttpStatusCode.Created, (await RegisterAsync(phone, authenticator)).StatusCode);
        var me = await phone.GetFromJsonAsync<JsonElement>("/api/auth/me");

        var admin = await fixture.AdminClientAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/users/{me.GetProperty("id").GetGuid()}/reset-2fa", null)).StatusCode);

        await using (var scope = fixture.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = await users.FindByNameAsync("bio-perdido");
            Assert.Empty(await users.GetPasskeysAsync(user!));
        }

        // O celular perdido nao entra nem chega a configurar um autenticador novo.
        Assert.Equal(HttpStatusCode.Unauthorized, (await PasskeyLoginAsync(fixture.NewClient(), authenticator)).StatusCode);
    }

    [Fact]
    public async Task Register_RequiresAFullSession_AndTheConsoleOrigin()
    {
        var anonymous = await fixture.NewClient().PostAsync("/api/auth/passkeys/register/options", null);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        var phone = await TechnicianAsync("bio-origem", "senha-bio-origem-1");
        using var elsewhere = new SoftwareAuthenticator("https://outro-site.exemplo.com");
        Assert.Equal(HttpStatusCode.BadRequest, (await RegisterAsync(phone, elsewhere)).StatusCode);

        // Sem pedir as opcoes antes nao ha desafio para conferir.
        using var authenticator = new SoftwareAuthenticator(Origin);
        var options = JsonDocument.Parse("""{"rp":{"id":"rmm.exemplo.com"},"user":{"id":"eA"},"challenge":"AAAA"}""").RootElement;
        var stray = await phone.PostAsJsonAsync("/api/auth/passkeys/register", new { credential = authenticator.Create(options) });
        Assert.Equal(HttpStatusCode.BadRequest, stray.StatusCode);
        Assert.Empty((await phone.GetFromJsonAsync<List<JsonElement>>("/api/auth/passkeys"))!);
    }

    private sealed record RoleBody(Guid Id, string Name);
}
