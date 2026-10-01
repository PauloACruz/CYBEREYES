using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using OtpNet;
using Testcontainers.PostgreSql;

namespace WinCare.Api.Tests;

public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string AdminUsername = "admin";
    public const string AdminPassword = "senha-admin-de-teste";

    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();
    private readonly Dictionary<string, string> totpKeys = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim totpLock = new(1, 1);

    public async Task InitializeAsync() => await postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await postgres.DisposeAsync();
        await base.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", postgres.GetConnectionString());
        builder.UseSetting("Seed:AdminUsername", AdminUsername);
        builder.UseSetting("Seed:AdminPassword", AdminPassword);
        builder.UseSetting("RateLimiting:AuthPermitPerMinute", "10000");
    }

    public HttpClient NewClient() => CreateClient(new WebApplicationFactoryClientOptions
    {
        BaseAddress = new Uri("https://localhost"),
        HandleCookies = true,
        AllowAutoRedirect = false,
    });

    public string CurrentCode(string username) => new Totp(Base32Encoding.ToBytes(totpKeys[username])).ComputeTotp();

    public async Task<HttpClient> SignedInClientAsync(string username, string password)
    {
        await totpLock.WaitAsync();
        try
        {
            var client = NewClient();
            var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
            login.EnsureSuccessStatusCode();
            var status = (await login.Content.ReadFromJsonAsync<StatusBody>())!.Status;

            if (status == "requires2faSetup")
            {
                var setup = await client.GetFromJsonAsync<SetupBody>("/api/auth/2fa/setup");
                totpKeys[username] = setup!.SharedKey;
                var enable = await client.PostAsJsonAsync("/api/auth/2fa/enable", new { code = CurrentCode(username) });
                enable.EnsureSuccessStatusCode();
            }
            else
            {
                var verify = await client.PostAsJsonAsync("/api/auth/login/2fa", new { code = CurrentCode(username) });
                verify.EnsureSuccessStatusCode();
            }
            return client;
        }
        finally
        {
            totpLock.Release();
        }
    }

    public Task<HttpClient> AdminClientAsync() => SignedInClientAsync(AdminUsername, AdminPassword);

    public async Task<Guid> CreateUserAsync(HttpClient admin, string username, string password, params Guid[] roleIds)
    {
        var response = await admin.PostAsJsonAsync("/api/users", new
        {
            username,
            email = $"{username}@exemplo.com",
            fullName = $"Usuario {username}",
            password,
            roleIds,
            isActive = true,
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<IdBody>())!.Id;
    }

    public sealed record StatusBody(string Status);
    public sealed record SetupBody(string SharedKey, string OtpauthUri);
    public sealed record IdBody(Guid Id);
}

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "api";
}
