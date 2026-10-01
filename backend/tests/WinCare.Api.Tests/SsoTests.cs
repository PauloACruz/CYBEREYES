using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WinCare.Core.Persistence;

namespace WinCare.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class SsoTests(ApiFixture fixture)
{
    private sealed record RoleOption(Guid Id, string Name);

    private async Task<(HttpClient Admin, Guid TechnicianRole)> AdminAsync()
    {
        var admin = await fixture.AdminClientAsync();
        var roles = await admin.GetFromJsonAsync<List<RoleOption>>("/api/roles/options");
        return (admin, roles!.Single(r => r.Name == "Tecnico").Id);
    }

    private static async Task<int> CreateProviderAsync(HttpClient admin, FakeOidcProvider idp, string name, object? overrides = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["name"] = name, ["authority"] = idp.Authority, ["clientId"] = "wincare-console", ["clientSecret"] = "segredo-do-cliente",
            ["linkByEmail"] = false, ["autoProvision"] = false, ["defaultRoleId"] = null, ["allowedDomains"] = Array.Empty<string>(),
            ["trustProviderMfa"] = false, ["enabled"] = true,
        };
        foreach (var p in overrides?.GetType().GetProperties() ?? [])
        {
            body[p.Name] = p.GetValue(overrides);
        }
        var created = await admin.PostAsJsonAsync("/api/sso/providers", body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var dto = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(dto.GetProperty("hasClientSecret").GetBoolean());
        Assert.False(dto.TryGetProperty("clientSecret", out _));
        Assert.Equal("https://rmm.exemplo.com/api/auth/sso/callback", dto.GetProperty("redirectUri").GetString());
        return dto.GetProperty("id").GetInt32();
    }

    /// <summary>Faz o caminho do navegador: inicio na API, autorizacao no provedor e retorno na API. Devolve o cliente com cookies e o destino final.</summary>
    private async Task<(HttpClient Client, string Location)> SsoLoginAsync(int providerId, string returnUrl = "/", Func<string, string>? tamperCallback = null)
    {
        var client = fixture.NewClient();
        var start = await client.GetAsync($"/api/auth/sso/{providerId}/start?returnUrl={Uri.EscapeDataString(returnUrl)}");
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        using var browser = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false });
        var authorize = await browser.GetAsync(start.Headers.Location);
        Assert.Equal(HttpStatusCode.Redirect, authorize.StatusCode);
        var callback = authorize.Headers.Location!;
        Assert.Equal("/api/auth/sso/callback", callback.AbsolutePath);
        var query = tamperCallback?.Invoke(callback.Query) ?? callback.Query;
        var done = await client.GetAsync("/api/auth/sso/callback" + query);
        Assert.Equal(HttpStatusCode.Redirect, done.StatusCode);
        return (client, done.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Sso_AutoProvisionsUser_AndStillRequiresLocal2faSetup()
    {
        await using var idp = await FakeOidcProvider.StartAsync();
        var (admin, technician) = await AdminAsync();
        var providerId = await CreateProviderAsync(admin, idp, "IdP provisiona", new { autoProvision = true, defaultRoleId = technician, allowedDomains = new[] { "empresa.com.br" } });

        Assert.Contains("IdP provisiona", await fixture.NewClient().GetStringAsync("/api/auth/sso/providers"), StringComparison.Ordinal);
        idp.NextUser = new() { ["sub"] = "sub-ana", ["email"] = "ana@empresa.com.br", ["email_verified"] = true, ["preferred_username"] = "ana.lima", ["name"] = "Ana Lima" };
        var (client, location) = await SsoLoginAsync(providerId);
        Assert.Equal("/login?sso=setup", location);
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal("ana.lima", me.GetProperty("username").GetString());
        Assert.False(me.GetProperty("mfaSatisfied").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/clients")).StatusCode);

        var userId = me.GetProperty("id").GetGuid();
        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/users/{userId}");
        Assert.Equal("IdP provisiona", detail.GetProperty("ssoLogins")[0].GetProperty("providerName").GetString());
        Assert.False(detail.GetProperty("hasPassword").GetBoolean());
        Assert.Equal("Tecnico", detail.GetProperty("roles")[0].GetProperty("name").GetString());

        idp.NextUser = new() { ["sub"] = "sub-fora", ["email"] = "fulano@outra.com", ["email_verified"] = true, ["preferred_username"] = "fulano" };
        Assert.Equal("/login?ssoError=SSO_DOMAIN_NOT_ALLOWED", (await SsoLoginAsync(providerId)).Location);
    }

    [Fact]
    public async Task Sso_TrustsProviderMfa_OnlyWhenConfigured_AndHonorsReturnUrl()
    {
        await using var idp = await FakeOidcProvider.StartAsync();
        var (admin, technician) = await AdminAsync();
        var providerId = await CreateProviderAsync(admin, idp, "IdP com MFA", new { autoProvision = true, defaultRoleId = technician, trustProviderMfa = true });

        idp.NextUser = new() { ["sub"] = "sub-bruno", ["email"] = "bruno@exemplo.com", ["email_verified"] = true, ["preferred_username"] = "bruno.sso", ["amr"] = new[] { "pwd", "mfa" } };
        var (client, location) = await SsoLoginAsync(providerId, "/agentes");
        Assert.Equal("/agentes", location);
        Assert.True((await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("mfaSatisfied").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/clients")).StatusCode);

        // Sem amr de MFA o login fica parcial, e um returnUrl externo vira "/".
        idp.NextUser = new() { ["sub"] = "sub-bruno", ["amr"] = new[] { "pwd" } };
        Assert.Equal("/login?sso=setup", (await SsoLoginAsync(providerId, "//evil.example.com")).Location);
        idp.NextUser = new() { ["sub"] = "sub-bruno", ["amr"] = new[] { "mfa" } };
        Assert.Equal("/", (await SsoLoginAsync(providerId, "https://evil.example.com")).Location);
    }

    [Fact]
    public async Task Sso_LinksByVerifiedEmail_ToUserWith2fa_ThenAsksForLocalCode()
    {
        await using var idp = await FakeOidcProvider.StartAsync();
        var (admin, technician) = await AdminAsync();
        var username = "carla" + Guid.NewGuid().ToString("N")[..6];
        await fixture.CreateUserAsync(admin, username, "senha-local-forte-123", technician);
        using (await fixture.SignedInClientAsync(username, "senha-local-forte-123"))
        {
        }
        var providerId = await CreateProviderAsync(admin, idp, "IdP vincula", new { linkByEmail = true });

        idp.NextUser = new() { ["sub"] = "sub-carla-nao-verificado", ["email"] = $"{username}@exemplo.com", ["email_verified"] = false };
        Assert.Equal("/login?ssoError=SSO_USER_NOT_FOUND", (await SsoLoginAsync(providerId)).Location);

        idp.NextUser = new() { ["sub"] = "sub-carla", ["email"] = $"{username}@exemplo.com", ["email_verified"] = true };
        var (client, location) = await SsoLoginAsync(providerId);
        Assert.Equal("/login?sso=2fa", location);
        var verify = await client.PostAsJsonAsync("/api/auth/login/2fa", new { code = fixture.CurrentCode(username) });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        Assert.True((await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("mfaSatisfied").GetBoolean());
    }

    [Fact]
    public async Task Sso_RejectsWrongState_AndWrongNonce()
    {
        await using var idp = await FakeOidcProvider.StartAsync();
        var (admin, technician) = await AdminAsync();
        var providerId = await CreateProviderAsync(admin, idp, "IdP seguranca", new { autoProvision = true, defaultRoleId = technician });
        idp.NextUser = new() { ["sub"] = "sub-davi", ["preferred_username"] = "davi" };

        Assert.Equal("/login?ssoError=SSO_INVALID_STATE", (await SsoLoginAsync(providerId, tamperCallback: q => q.Replace("state=", "state=x", StringComparison.Ordinal))).Location);
        idp.TamperNonce = "outro-nonce";
        Assert.Equal("/login?ssoError=SSO_INVALID_TOKEN", (await SsoLoginAsync(providerId)).Location);
        idp.TamperNonce = null;

        using var scope = fixture.Services.CreateScope();
        var audit = await scope.ServiceProvider.GetRequiredService<WinCareDbContext>().AuditLogs.Where(a => a.Action == "auth.sso.failed").CountAsync();
        Assert.True(audit >= 2);
    }

    [Fact]
    public async Task DisablePasswordLogin_BlocksTechnicians_ButNotSuperusers()
    {
        var (admin, technician) = await AdminAsync();
        var username = "edu" + Guid.NewGuid().ToString("N")[..6];
        await fixture.CreateUserAsync(admin, username, "senha-local-forte-123", technician);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/sso/settings", new { disablePasswordLogin = true })).StatusCode);
        try
        {
            var providers = await fixture.NewClient().GetFromJsonAsync<JsonElement>("/api/auth/sso/providers");
            Assert.False(providers.GetProperty("passwordLoginEnabled").GetBoolean());
            var blocked = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username, password = "senha-local-forte-123" });
            Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
            Assert.Equal("PASSWORD_LOGIN_DISABLED", (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
            var superuser = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username = ApiFixture.AdminUsername, password = ApiFixture.AdminPassword });
            Assert.Equal(HttpStatusCode.OK, superuser.StatusCode);
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/sso/settings", new { disablePasswordLogin = false });
        }
    }
}
