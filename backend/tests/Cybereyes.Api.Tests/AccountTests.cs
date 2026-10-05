using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Tests;

/// <summary>Recuperacao de senha e convite por e-mail (o envio e capturado pelo RecordingSender).</summary>
[Collection(ApiCollection.Name)]
public sealed partial class AccountTests(ApiFixture fixture)
{
    private const string Password = "senha-de-teste-123";

    [Fact]
    public async Task Forgot_UnknownLogin_Returns202AndSendsNothing()
    {
        await SetSmtpAsync(configured: true);
        var before = EmailCount();

        var response = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/forgot", new { login = "ninguem-aqui@exemplo.com" });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await Task.Delay(300);
        Assert.Equal(before, EmailCount());
    }

    [Fact]
    public async Task Forgot_ThenReset_ChangesPasswordAndLinkWorksOnce()
    {
        await SetSmtpAsync(configured: true);
        var username = Unique("esq");
        var admin = await fixture.AdminClientAsync();
        await fixture.CreateUserAsync(admin, username, Password);

        var forgot = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/forgot", new { login = $"{username}@exemplo.com" });
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        var (uid, token, link) = await WaitForLinkAsync($"{username}@exemplo.com", "Redefinicao de senha");
        Assert.StartsWith("https://rmm.exemplo.com/redefinir-senha?uid=", link, StringComparison.Ordinal);

        var reset = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/reset",
            new { userId = uid, token, newPassword = "nova-senha-de-teste-456" });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var oldLogin = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        var newLogin = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username, password = "nova-senha-de-teste-456" });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);

        var reuse = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/reset",
            new { userId = uid, token, newPassword = "outra-senha-de-teste-789" });
        Assert.Equal(HttpStatusCode.BadRequest, reuse.StatusCode);
        Assert.Equal("INVALID_TOKEN", await CodeOf(reuse));
    }

    [Fact]
    public async Task Forgot_RepeatedWithinThrottle_SendsOneEmail()
    {
        await SetSmtpAsync(configured: true);
        var username = Unique("rep");
        var admin = await fixture.AdminClientAsync();
        await fixture.CreateUserAsync(admin, username, Password);

        await fixture.NewClient().PostAsJsonAsync("/api/auth/password/forgot", new { login = username });
        await WaitForLinkAsync($"{username}@exemplo.com", "Redefinicao de senha");
        var second = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/forgot", new { login = username });

        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        await Task.Delay(300);
        Assert.Single(EmailsTo($"{username}@exemplo.com", "Redefinicao de senha"));
    }

    [Fact]
    public async Task Reset_WithInvalidToken_Returns400InvalidToken()
    {
        var admin = await fixture.AdminClientAsync();
        var id = await fixture.CreateUserAsync(admin, Unique("tok"), Password);

        var response = await fixture.NewClient().PostAsJsonAsync("/api/auth/password/reset",
            new { userId = id, token = "token-falso", newPassword = "nova-senha-de-teste-456" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("INVALID_TOKEN", await CodeOf(response));
    }

    [Fact]
    public async Task Invite_CreateAcceptAndLogin()
    {
        await SetSmtpAsync(configured: true);
        var username = Unique("conv");
        var admin = await fixture.AdminClientAsync();

        var created = await CreateInvitedAsync(admin, username);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var user = (await created.Content.ReadFromJsonAsync<UserBody>())!;
        Assert.True(user.InvitePending);
        Assert.Null(user.InviteError);

        var (uid, token, link) = await WaitForLinkAsync($"{username}@exemplo.com", "Convite");
        Assert.Equal(user.Id, uid);
        Assert.StartsWith("https://rmm.exemplo.com/convite?uid=", link, StringComparison.Ordinal);
        Assert.Contains($"Seu usuario: {username}", LastBody($"{username}@exemplo.com", "Convite"), StringComparison.Ordinal);

        var info = await fixture.NewClient().GetFromJsonAsync<InviteInfoBody>($"/api/auth/invite?uid={uid}&token={Uri.EscapeDataString(token)}");
        Assert.Equal(username, info!.Username);

        var accept = await fixture.NewClient().PostAsJsonAsync("/api/auth/invite/accept", new { userId = uid, token, password = Password });
        Assert.Equal(HttpStatusCode.NoContent, accept.StatusCode);

        var login = await fixture.NewClient().PostAsJsonAsync("/api/auth/login", new { username, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var again = await fixture.NewClient().PostAsJsonAsync("/api/auth/invite/accept", new { userId = uid, token, password = "outra-senha-de-teste-789" });
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Equal("INVALID_TOKEN", await CodeOf(again));

        var after = await admin.GetFromJsonAsync<UserBody>($"/api/users/{uid}");
        Assert.False(after!.InvitePending);
    }

    [Fact]
    public async Task Invite_ResendInvalidatesPreviousLink()
    {
        await SetSmtpAsync(configured: true);
        var username = Unique("reenv");
        var admin = await fixture.AdminClientAsync();
        var user = (await (await CreateInvitedAsync(admin, username)).Content.ReadFromJsonAsync<UserBody>())!;
        var (_, firstToken, _) = await WaitForLinkAsync($"{username}@exemplo.com", "Convite");

        var resend = await admin.PostAsync($"/api/users/{user.Id}/invite", null);
        Assert.Equal(HttpStatusCode.NoContent, resend.StatusCode);
        var (_, secondToken, _) = await WaitForLinkAsync($"{username}@exemplo.com", "Convite", expected: 2);

        var old = await fixture.NewClient().PostAsJsonAsync("/api/auth/invite/accept", new { userId = user.Id, token = firstToken, password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, old.StatusCode);
        var current = await fixture.NewClient().PostAsJsonAsync("/api/auth/invite/accept", new { userId = user.Id, token = secondToken, password = Password });
        Assert.Equal(HttpStatusCode.NoContent, current.StatusCode);

        var afterAccept = await admin.PostAsync($"/api/users/{user.Id}/invite", null);
        Assert.Equal(HttpStatusCode.Conflict, afterAccept.StatusCode);
    }

    [Fact]
    public async Task CreateUser_WithoutPasswordOrInvite_Returns400()
    {
        var admin = await fixture.AdminClientAsync();

        var response = await admin.PostAsJsonAsync("/api/users", new
        {
            username = Unique("semsenha"), email = $"{Unique("x")}@exemplo.com", fullName = "Sem Senha", roleIds = Array.Empty<Guid>(), isActive = true,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("password", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Invite_WithoutSmtp_Returns400AndCreatesNothing()
    {
        var admin = await fixture.AdminClientAsync();
        var username = Unique("nosmtp");
        await SetSmtpAsync(configured: false);
        try
        {
            var response = await CreateInvitedAsync(admin, username);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("sendInvite", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            var list = await admin.GetStringAsync($"/api/users?search={username}");
            Assert.DoesNotContain(username, list, StringComparison.Ordinal);
        }
        finally
        {
            await SetSmtpAsync(configured: true);
        }
    }

    private Task<HttpResponseMessage> CreateInvitedAsync(HttpClient admin, string username) =>
        admin.PostAsJsonAsync("/api/users", new
        {
            username, email = $"{username}@exemplo.com", fullName = $"Usuario {username}", roleIds = Array.Empty<Guid>(), isActive = true, sendInvite = true,
        });

    private async Task SetSmtpAsync(bool configured)
    {
        using var scope = fixture.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var settings = await SettingsStore.GetAsync(db, CancellationToken.None);
        settings.SmtpHost = configured ? "smtp.exemplo.com" : null;
        settings.SmtpFrom = configured ? "Cybereyes <cybereyes@exemplo.com>" : null;
        await db.SaveChangesAsync();
    }

    private async Task<(Guid Uid, string Token, string Link)> WaitForLinkAsync(string to, string subject, int expected = 1)
    {
        for (var i = 0; i < 50; i++)
        {
            var bodies = EmailsTo(to, subject);
            if (bodies.Count >= expected)
            {
                var match = LinkRegex().Match(bodies[expected - 1]);
                Assert.True(match.Success, "link nao encontrado no e-mail");
                return (Guid.Parse(match.Groups["uid"].Value), Uri.UnescapeDataString(match.Groups["token"].Value), match.Value);
            }
            await Task.Delay(100);
        }
        throw new TimeoutException($"Nenhum e-mail \"{subject}\" para {to}");
    }

    private List<string> EmailsTo(string to, string subject)
    {
        lock (fixture.Notifications.Emails)
        {
            return fixture.Notifications.EmailBodies
                .Where(m => m.To.Contains(to) && m.Subject.Contains(subject, StringComparison.Ordinal))
                .Select(m => m.Body).ToList();
        }
    }

    private string LastBody(string to, string subject) => EmailsTo(to, subject)[^1];

    private int EmailCount()
    {
        lock (fixture.Notifications.Emails)
        {
            return fixture.Notifications.EmailBodies.Count;
        }
    }

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20];

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    [GeneratedRegex(@"https://\S+\?uid=(?<uid>[0-9a-f-]{36})&token=(?<token>\S+)")]
    private static partial Regex LinkRegex();

    private sealed record UserBody(Guid Id, bool InvitePending, string? InviteError);
    private sealed record InviteInfoBody(string Username, string FullName);
}
