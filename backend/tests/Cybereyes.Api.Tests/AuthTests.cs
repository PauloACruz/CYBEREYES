using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class AuthTests(ApiFixture fixture)
{
    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        var response = await fixture.NewClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Healthy", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithoutSession_Returns401()
    {
        var response = await fixture.NewClient().GetAsync("/api/users");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("UNAUTHENTICATED", await CodeOf(response));
    }

    [Fact]
    public async Task Login_WithWrongPassword_Returns401InvalidCredentials()
    {
        var response = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username = ApiFixture.AdminUsername, password = "errada-errada" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("INVALID_CREDENTIALS", await CodeOf(response));
    }

    [Fact]
    public async Task NewUser_MustSetUpTwoFactor_BeforeUsingTheApi()
    {
        var admin = await fixture.AdminClientAsync();
        var roles = await admin.GetFromJsonAsync<List<RoleBody>>("/api/roles");
        var technician = roles!.Single(r => r.Name == "Tecnico");
        await fixture.CreateUserAsync(admin, "tecnico1", "senha-do-tecnico-1", technician.Id);

        var client = fixture.NewClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username = "tecnico1", password = "senha-do-tecnico-1" });
        Assert.Equal("requires2faSetup", (await login.Content.ReadFromJsonAsync<ApiFixture.StatusBody>())!.Status);

        var blocked = await client.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("MFA_REQUIRED", await CodeOf(blocked));

        var setup = await client.GetFromJsonAsync<ApiFixture.SetupBody>("/api/auth/2fa/setup");
        Assert.StartsWith("otpauth://totp/", setup!.OtpauthUri, StringComparison.Ordinal);

        var wrong = await client.PostAsJsonAsync("/api/auth/2fa/enable", new { code = "000000" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);

        var code = new OtpNet.Totp(OtpNet.Base32Encoding.ToBytes(setup.SharedKey)).ComputeTotp();
        var enable = await client.PostAsJsonAsync("/api/auth/2fa/enable", new { code });
        var enabled = await enable.Content.ReadFromJsonAsync<EnableBody>();
        Assert.Equal(10, enabled!.RecoveryCodes.Count);

        var me = await client.GetFromJsonAsync<MeBody>("/api/auth/me");
        Assert.True(me!.MfaSatisfied);
        Assert.Contains("users.view", me.Permissions);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/users")).StatusCode);

        var second = fixture.NewClient();
        var secondLogin = await second.PostAsJsonAsync("/api/auth/login", new { username = "tecnico1", password = "senha-do-tecnico-1" });
        Assert.Equal("requires2fa", (await secondLogin.Content.ReadFromJsonAsync<ApiFixture.StatusBody>())!.Status);
        var recovery = await second.PostAsJsonAsync("/api/auth/login/recovery", new { recoveryCode = enabled.RecoveryCodes[0] });
        Assert.Equal(HttpStatusCode.OK, recovery.StatusCode);
        Assert.True((await second.GetFromJsonAsync<MeBody>("/api/auth/me"))!.MfaSatisfied);
    }

    [Fact]
    public async Task UserWithoutPermission_GetsForbidden()
    {
        var admin = await fixture.AdminClientAsync();
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Somente leitura", isSuperuser = false, permissions = Array.Empty<string>() });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        await fixture.CreateUserAsync(admin, "leitor", "senha-do-leitor-1", roleId);

        var client = await fixture.SignedInClientAsync("leitor", "senha-do-leitor-1");
        var response = await client.GetAsync("/api/audit");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("FORBIDDEN", await CodeOf(response));
    }

    [Fact]
    public async Task CreateUser_WithInvalidData_ReturnsValidationError()
    {
        var admin = await fixture.AdminClientAsync();

        var badEmail = await admin.PostAsJsonAsync("/api/users", new { username = "x1", email = "nao-e-email", fullName = "X", password = "curta" });
        Assert.Equal(HttpStatusCode.BadRequest, badEmail.StatusCode);
        Assert.Equal("VALIDATION_ERROR", await CodeOf(badEmail));

        var shortPassword = await admin.PostAsJsonAsync("/api/users", new { username = "curto", email = "curto@exemplo.com", fullName = "Curto", password = "curta" });
        Assert.Equal(HttpStatusCode.BadRequest, shortPassword.StatusCode);
        Assert.Contains("password", await shortPassword.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ApiKey_AuthenticatesAndCanBeRevoked()
    {
        var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/apikeys", new { name = "Integracao teste" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var key = await created.Content.ReadFromJsonAsync<KeyBody>();

        using var keyClient = fixture.NewClient();
        keyClient.DefaultRequestHeaders.Add("X-API-KEY", key!.Key);
        Assert.Equal(HttpStatusCode.OK, (await keyClient.GetAsync("/api/users")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/apikeys/{key.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await keyClient.GetAsync("/api/users")).StatusCode);
    }

    [Fact]
    public async Task LastAdministrator_CannotBeRemoved()
    {
        var admin = await fixture.AdminClientAsync();
        var me = await admin.GetFromJsonAsync<MeBody>("/api/auth/me");

        var self = await admin.DeleteAsync($"/api/users/{me!.Id}");
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);

        var roles = await admin.GetFromJsonAsync<List<RoleBody>>("/api/roles");
        var adminRole = roles!.Single(r => r.Name == "Administrador");
        var demote = await admin.PutAsJsonAsync($"/api/roles/{adminRole.Id}", new { name = "Administrador", isSuperuser = false, permissions = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.Conflict, demote.StatusCode);
    }

    [Fact]
    public async Task RoleOptions_AreAvailableToUserManagers()
    {
        var admin = await fixture.AdminClientAsync();

        var options = await admin.GetFromJsonAsync<List<RoleBody>>("/api/roles/options");

        Assert.Contains(options!, r => r.Name == "Tecnico");
    }

    [Fact]
    public async Task Audit_RecordsSuccessfulLogins()
    {
        var admin = await fixture.AdminClientAsync();

        var page = await admin.GetFromJsonAsync<AuditPage>($"/api/audit?username={ApiFixture.AdminUsername}&action=login");

        Assert.Contains(page!.Items, a => a.Action is "login.success" or "login.partial");
    }

    private sealed record RoleBody(Guid Id, string Name, bool IsSuperuser);
    private sealed record EnableBody(string Status, List<string> RecoveryCodes);
    private sealed record MeBody(Guid Id, string Username, bool MfaSatisfied, List<string> Permissions);
    private sealed record KeyBody(Guid Id, string Key);
    private sealed record AuditItem(string Action, string Username);
    private sealed record AuditPage(List<AuditItem> Items, int Total);
}
