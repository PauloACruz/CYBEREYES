using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Rmm;
using OtpNet;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Testcontainers.PostgreSql;

namespace Cybereyes.Api.Tests;

public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string AdminUsername = "admin";
    public const string AdminPassword = "senha-admin-de-teste";

    public RecordingSender Notifications { get; } = new();

    public const string NatsApiUser = "cybereyes-api";
    public const string NatsApiPassword = "senha-nats-teste";

    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();
    private readonly IContainer nats;
    public string NatsAuthDir { get; } = Directory.CreateTempSubdirectory("cybereyes-nats-").FullName;

    /// <summary>Binarios do EYES servidos pela API de teste (versao distribuida: UpdateVersion).</summary>
    public string AgentBinariesDir { get; } = Directory.CreateTempSubdirectory("cybereyes-agents-").FullName;
    public const string UpdateVersion = "3.0.1";
    public string NatsUrl => $"nats://127.0.0.1:{nats.GetMappedPublicPort(4222)}";

    public ApiFixture()
    {
        var infra = Path.Combine(FindRepoRoot(), "infra", "docker", "nats");
        nats = new ContainerBuilder("nats:2.11-alpine")
            .WithEntrypoint("/bin/sh", "/run.sh")
            .WithEnvironment("NATS_API_USER", NatsApiUser)
            .WithEnvironment("NATS_API_PASSWORD", NatsApiPassword)
            .WithEnvironment("API_UID", CurrentUid())
            .WithBindMount(Path.Combine(infra, "nats.conf"), "/etc/nats/nats.conf")
            .WithBindMount(Path.Combine(infra, "run.sh"), "/run.sh")
            .WithBindMount(NatsAuthDir, "/etc/nats/auth")
            .WithPortBinding(4222, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilMessageIsLogged("Server is ready"))
            .Build();
    }

    private static string CurrentUid() =>
        File.ReadLines("/proc/self/status").First(l => l.StartsWith("Uid:", StringComparison.Ordinal))
            .Split('\t', StringSplitOptions.RemoveEmptyEntries)[1];

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "infra")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? throw new InvalidOperationException("Raiz do repositorio nao encontrada");
    }
    public static readonly string VaultKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

    private readonly Dictionary<string, string> totpKeys = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim totpLock = new(1, 1);

    public async Task InitializeAsync() => await Task.WhenAll(postgres.StartAsync(), nats.StartAsync());

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await postgres.DisposeAsync();
        await nats.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", postgres.GetConnectionString());
        builder.UseSetting("Seed:AdminUsername", AdminUsername);
        builder.UseSetting("Seed:AdminPassword", AdminPassword);
        builder.UseSetting("RateLimiting:AuthPermitPerMinute", "10000");
        builder.UseSetting("Nats:Url", NatsUrl);
        builder.UseSetting("Nats:User", NatsApiUser);
        builder.UseSetting("Nats:Password", NatsApiPassword);
        builder.UseSetting("Nats:AuthFile", Path.Combine(NatsAuthDir, "users.conf"));
        builder.UseSetting("App:PublicUrl", "https://rmm.exemplo.com");
        builder.UseSetting("Vault:Key", VaultKey);
        builder.UseSetting("Agent:BinariesPath", AgentBinariesDir);
        builder.UseSetting("Agent:LatestVersion", UpdateVersion);
        builder.UseSetting("Agent:AutoUpdate", "false");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<INotificationSender>();
            services.AddSingleton<INotificationSender>(Notifications);
        });
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

public sealed class RecordingSender : INotificationSender
{
    public List<(string Url, string Payload)> Webhooks { get; } = [];
    public List<(IReadOnlyList<string> To, string Subject)> Emails { get; } = [];
    public List<(IReadOnlyList<string> To, string Subject, IReadOnlyList<EmailAttachment> Attachments)> EmailsWithAttachments { get; } = [];

    public Task SendEmailAsync(CoreSettings settings, IReadOnlyList<string> recipients, string subject, string body,
        IReadOnlyList<EmailAttachment> attachments, CancellationToken ct)
    {
        lock (Emails)
        {
            Emails.Add((recipients, subject));
            EmailsWithAttachments.Add((recipients, subject, attachments));
        }
        return Task.CompletedTask;
    }

    public Task SendEmailAsync(CoreSettings settings, IReadOnlyList<string> recipients, string subject, string body, CancellationToken ct)
    {
        lock (Emails)
        {
            Emails.Add((recipients, subject));
        }
        return Task.CompletedTask;
    }

    public Task SendWebhookAsync(string url, object payload, CancellationToken ct)
    {
        lock (Webhooks)
        {
            Webhooks.Add((url, System.Text.Json.JsonSerializer.Serialize(payload)));
        }
        return Task.CompletedTask;
    }
}
