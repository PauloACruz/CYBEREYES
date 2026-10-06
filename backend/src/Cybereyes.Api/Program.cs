using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;

if (args.Contains("--healthcheck-probe"))
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    try
    {
        using var response = await probe.GetAsync(new Uri("http://localhost:8080/health"));
        return response.IsSuccessStatusCode ? 0 : 1;
    }
    catch (HttpRequestException)
    {
        return 1;
    }
    catch (TaskCanceledException)
    {
        return 1;
    }
}

var builder = WebApplication.CreateBuilder(args);

if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o => o.UseUtcTimestamp = true);
}

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default nao configurada");

builder.Services.AddDbContext<CybereyesDbContext>(o => o.UseNpgsql(connectionString));
builder.Services.AddDataProtection().SetApplicationName(DataProtectionNames.ApplicationName).PersistKeysToDbContext<CybereyesDbContext>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddCybereyesAuth(builder.Configuration);
builder.Services.AddValidation();
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    var status = ctx.ProblemDetails.Status ?? ctx.HttpContext.Response.StatusCode;
    ctx.ProblemDetails.Extensions.TryAdd("code", ErrorCodes.ForStatus(status));
    if (status == StatusCodes.Status400BadRequest && ctx.ProblemDetails.Title is null or "One or more validation errors occurred.")
    {
        ctx.ProblemDetails.Title = "Dados invalidos";
    }
});
builder.Services.AddOpenApi();
builder.Services.Configure<AgentSettings>(builder.Configuration.GetSection(AgentSettings.Section));
builder.Services.Configure<NatsSettings>(builder.Configuration.GetSection(NatsSettings.Section));
var signalR = builder.Services.AddSignalR();
if (builder.Configuration.GetConnectionString("Redis") is { Length: > 0 } redis)
{
    signalR.AddStackExchangeRedis(redis, o => o.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("cybereyes"));
}
builder.Services.AddSingleton<IAgentNotifier, AgentNotifier>();
builder.Services.AddScoped<Cybereyes.Api.Rmm.Actions.SystemEndpoints.Deps>();
builder.Services.AddHttpClient("webhooks");
builder.Services.AddHttpClient("oidc");
builder.Services.Configure<Cybereyes.Api.Rmm.Software.SoftwareCatalogSettings>(builder.Configuration.GetSection(Cybereyes.Api.Rmm.Software.SoftwareCatalogSettings.Section));
builder.Services.AddHttpClient(Cybereyes.Api.Rmm.Software.PackageCatalog.HttpClientName, c =>
{
    c.Timeout = TimeSpan.FromSeconds(60);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Cybereyes/1.0");
});
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Software.PackageCatalog>();
builder.Services.AddScoped<Cybereyes.Api.Sso.SsoService>();
builder.Services.Configure<Cybereyes.Api.Rmm.Remote.RemoteSettings>(builder.Configuration.GetSection(Cybereyes.Api.Rmm.Remote.RemoteSettings.Section));
if (builder.Configuration.GetConnectionString("Redis") is { Length: > 0 } remoteRedis)
{
    builder.Services.AddSingleton<StackExchange.Redis.IConnectionMultiplexer>(_ =>
    {
        var redisOptions = StackExchange.Redis.ConfigurationOptions.Parse(remoteRedis);
        redisOptions.AbortOnConnectFail = false;
        return StackExchange.Redis.ConnectionMultiplexer.Connect(redisOptions);
    });
    builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.IRemoteDirectory, Cybereyes.Api.Rmm.Remote.RedisRemoteDirectory>();
}
else
{
    builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.IRemoteDirectory, Cybereyes.Api.Rmm.Remote.LocalRemoteDirectory>();
}
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.RemoteNode>();
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.RemoteSessionManager>();
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.RemoteForwarder>();
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Remote.RemoteRelay>();
builder.Services.AddHostedService<Cybereyes.Api.Rmm.Remote.RemoteSessionReaper>();
builder.Services.AddHttpClient(Cybereyes.Api.Rmm.Remote.RemoteForwarder.HttpClientName, c => c.Timeout = Timeout.InfiniteTimeSpan);
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Monitoring.INotificationSender, Cybereyes.Api.Rmm.Monitoring.NotificationSender>();
builder.Services.AddScoped<Cybereyes.Api.Rmm.Monitoring.AlertService>();
builder.Services.AddScoped<Cybereyes.Api.Tickets.TicketService>();
builder.Services.AddScoped<Cybereyes.Api.Tickets.IncidentService>();
builder.Services.Configure<Cybereyes.Api.Inventory.VaultSettings>(builder.Configuration.GetSection(Cybereyes.Api.Inventory.VaultSettings.Section));
builder.Services.AddSingleton<Cybereyes.Api.Inventory.Vault>();
builder.Services.AddHostedService<Cybereyes.Api.Inventory.AssetSyncService>();
builder.Services.AddScoped<Cybereyes.Api.Rmm.Maintenance.CareService>();
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Maintenance.HealthScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Rmm.Maintenance.HealthScheduler>());
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Monitoring.AgentTaskScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Rmm.Monitoring.AgentTaskScheduler>());
builder.Services.AddSingleton<Cybereyes.Api.Rmm.Monitoring.PatchScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Rmm.Monitoring.PatchScheduler>());
builder.Services.AddHostedService<Cybereyes.Api.Rmm.Monitoring.MaintenanceService>();
builder.Services.AddScoped<Cybereyes.Api.Snmp.SnmpService>();
builder.Services.AddScoped<Cybereyes.Api.Reports.ReportBuilder>();
builder.Services.AddScoped<Cybereyes.Api.Reports.ReportService>();
builder.Services.AddSingleton<Cybereyes.Api.Reports.ReportScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Reports.ReportScheduler>());
builder.Services.AddSingleton<Cybereyes.Api.Logs.LogPartitionService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Logs.LogPartitionService>());
builder.Services.AddSingleton<Cybereyes.Api.Logs.LogAlertEvaluator>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Logs.LogAlertEvaluator>());
builder.Services.AddSingleton(sp => new Cybereyes.Api.Rmm.Actions.TerminalSessions(
    sp.GetService<NATS.Client.Core.INatsConnection>(), sp.GetRequiredService<IAgentRpc>(),
    sp.GetRequiredService<Microsoft.AspNetCore.SignalR.IHubContext<ConsoleHub>>(),
    sp.GetRequiredService<ILogger<Cybereyes.Api.Rmm.Actions.TerminalSessions>>()));
builder.Services.AddSingleton<NatsAuthWriter>();
builder.Services.AddSingleton<NatsAuthSync>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<NatsAuthSync>());
builder.Services.AddSingleton<Cybereyes.Api.Rmm.AgentAutoUpdater>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Cybereyes.Api.Rmm.AgentAutoUpdater>());
builder.Services.AddSingleton<AgentStatusMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<AgentStatusMonitor>());
var nats = builder.Configuration.GetSection(NatsSettings.Section).Get<NatsSettings>() ?? new NatsSettings();
if (nats.Enabled)
{
    builder.Services.AddSingleton<NATS.Client.Core.INatsConnection>(_ => new NATS.Client.Core.NatsConnection(new NATS.Client.Core.NatsOpts
    {
        Url = nats.Url!,
        Name = "cybereyes-api",
        AuthOpts = new NATS.Client.Core.NatsAuthOpts { Username = nats.User, Password = nats.Password },
    }));
    builder.Services.AddSingleton<IAgentRpc, AgentRpc>();
    builder.Services.AddSingleton<CheckinConsumer>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<CheckinConsumer>());
    builder.Services.AddHostedService<Cybereyes.Api.Rmm.Maintenance.CareEventConsumer>();
}
else
{
    builder.Services.AddSingleton<IAgentRpc, DisabledAgentRpc>();
}
builder.Services.AddHealthChecks().AddDbContextCheck<CybereyesDbContext>("database");
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    if (builder.Configuration.GetValue("Proxy:TrustAll", false))
    {
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
    }
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    headers["Referrer-Policy"] = "no-referrer";
    await next();
});

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

var openApi = app.MapOpenApi();
if (app.Environment.IsDevelopment())
{
    openApi.AllowAnonymous();
}

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = (context, report) =>
    {
        context.Response.ContentType = "application/json";
        return context.Response.WriteAsync(JsonSerializer.Serialize(new { status = report.Status.ToString() }));
    },
}).AllowAnonymous();

app.MapAuthEndpoints();
app.MapUserEndpoints();
app.MapRoleEndpoints();
app.MapApiKeyEndpoints();
app.MapAuditEndpoints();
app.MapClientEndpoints();
app.MapAgentEndpoints();
app.MapInstallerEndpoints();
app.MapAgentUpdateEndpoints();
Cybereyes.Api.Rmm.Software.SoftwareCatalogEndpoints.MapSoftwareCatalogEndpoints(app);
app.MapAgentProtocolEndpoints();
Cybereyes.Api.Rmm.Actions.CommandEndpoints.MapCommandEndpoints(app);
Cybereyes.Api.Rmm.Actions.SystemEndpoints.MapSystemEndpoints(app);
Cybereyes.Api.Rmm.Actions.LibraryEndpoints.MapLibraryEndpoints(app);
Cybereyes.Api.Rmm.Monitoring.ChecksTasksEndpoints.MapChecksTasksEndpoints(app);
Cybereyes.Api.Rmm.Monitoring.AlertsPatchesEndpoints.MapAlertsPatchesEndpoints(app);
Cybereyes.Api.Rmm.Remote.RemoteEndpoints.MapRemoteEndpoints(app);
Cybereyes.Api.Tickets.TicketEndpoints.MapTicketEndpoints(app);
Cybereyes.Api.Tickets.Tray.MapTrayEndpoints(app);
Cybereyes.Api.Inventory.AssetEndpoints.MapAssetEndpoints(app);
Cybereyes.Api.Inventory.DocsEndpoints.MapDocsEndpoints(app);
Cybereyes.Api.Rmm.Maintenance.CareEndpoints.MapCareEndpoints(app);
Cybereyes.Api.Logs.LogEndpoints.MapLogEndpoints(app);
Cybereyes.Api.Snmp.SnmpEndpoints.MapSnmpEndpoints(app);
Cybereyes.Api.Reports.ReportEndpoints.MapReportEndpoints(app);
Cybereyes.Api.Sso.SsoEndpoints.MapSsoEndpoints(app);

if (args.Contains("--migrate-only"))
{
    await DatabaseSeeder.SeedAsync(app.Services, app.Configuration, migrate: true);
    return 0;
}

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await DatabaseSeeder.SeedAsync(app.Services, app.Configuration, migrate: true);
}

await app.RunAsync();
return 0;

public partial class Program;
