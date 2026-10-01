using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Endpoints;
using WinCare.Api.Infrastructure;
using WinCare.Api.Rmm;
using WinCare.Api.Rmm.Nats;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;

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

builder.Services.AddDbContext<WinCareDbContext>(o => o.UseNpgsql(connectionString));
builder.Services.AddDataProtection().SetApplicationName("WinCare").PersistKeysToDbContext<WinCareDbContext>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddWinCareAuth(builder.Configuration);
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
    signalR.AddStackExchangeRedis(redis, o => o.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("wincare"));
}
builder.Services.AddSingleton<IAgentNotifier, AgentNotifier>();
builder.Services.AddScoped<WinCare.Api.Rmm.Actions.SystemEndpoints.Deps>();
builder.Services.AddHttpClient("webhooks");
builder.Services.AddHttpClient("mesh", c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.Configure<WinCare.Api.Rmm.Mesh.MeshSettings>(builder.Configuration.GetSection(WinCare.Api.Rmm.Mesh.MeshSettings.Section));
builder.Services.AddSingleton<WinCare.Api.Rmm.Mesh.MeshClient>();
builder.Services.AddSingleton<WinCare.Api.Rmm.Mesh.MeshState>();
builder.Services.AddSingleton<WinCare.Api.Rmm.Mesh.MeshSync>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WinCare.Api.Rmm.Mesh.MeshSync>());
builder.Services.AddSingleton<WinCare.Api.Rmm.Monitoring.INotificationSender, WinCare.Api.Rmm.Monitoring.NotificationSender>();
builder.Services.AddScoped<WinCare.Api.Rmm.Monitoring.AlertService>();
builder.Services.AddScoped<WinCare.Api.Tickets.TicketService>();
builder.Services.AddScoped<WinCare.Api.Tickets.IncidentService>();
builder.Services.Configure<WinCare.Api.Inventory.VaultSettings>(builder.Configuration.GetSection(WinCare.Api.Inventory.VaultSettings.Section));
builder.Services.AddSingleton<WinCare.Api.Inventory.Vault>();
builder.Services.AddHostedService<WinCare.Api.Inventory.AssetSyncService>();
builder.Services.AddScoped<WinCare.Api.Rmm.Maintenance.WinCareService>();
builder.Services.AddSingleton<WinCare.Api.Rmm.Maintenance.HealthScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WinCare.Api.Rmm.Maintenance.HealthScheduler>());
builder.Services.AddSingleton<WinCare.Api.Rmm.Monitoring.AgentTaskScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WinCare.Api.Rmm.Monitoring.AgentTaskScheduler>());
builder.Services.AddSingleton<WinCare.Api.Rmm.Monitoring.PatchScheduler>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<WinCare.Api.Rmm.Monitoring.PatchScheduler>());
builder.Services.AddHostedService<WinCare.Api.Rmm.Monitoring.MaintenanceService>();
builder.Services.AddSingleton(sp => new WinCare.Api.Rmm.Actions.TerminalSessions(
    sp.GetService<NATS.Client.Core.INatsConnection>(), sp.GetRequiredService<IAgentRpc>(),
    sp.GetRequiredService<Microsoft.AspNetCore.SignalR.IHubContext<ConsoleHub>>(),
    sp.GetRequiredService<ILogger<WinCare.Api.Rmm.Actions.TerminalSessions>>()));
builder.Services.AddSingleton<NatsAuthWriter>();
builder.Services.AddSingleton<NatsAuthSync>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<NatsAuthSync>());
builder.Services.AddSingleton<AgentStatusMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<AgentStatusMonitor>());
var nats = builder.Configuration.GetSection(NatsSettings.Section).Get<NatsSettings>() ?? new NatsSettings();
if (nats.Enabled)
{
    builder.Services.AddSingleton<NATS.Client.Core.INatsConnection>(_ => new NATS.Client.Core.NatsConnection(new NATS.Client.Core.NatsOpts
    {
        Url = nats.Url!,
        Name = "wincare-api",
        AuthOpts = new NATS.Client.Core.NatsAuthOpts { Username = nats.User, Password = nats.Password },
    }));
    builder.Services.AddSingleton<IAgentRpc, AgentRpc>();
    builder.Services.AddSingleton<CheckinConsumer>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<CheckinConsumer>());
    builder.Services.AddHostedService<WinCare.Api.Rmm.Maintenance.WinCareEventConsumer>();
}
else
{
    builder.Services.AddSingleton<IAgentRpc, DisabledAgentRpc>();
}
builder.Services.AddHealthChecks().AddDbContextCheck<WinCareDbContext>("database");
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
app.MapAgentProtocolEndpoints();
WinCare.Api.Rmm.Actions.CommandEndpoints.MapCommandEndpoints(app);
WinCare.Api.Rmm.Actions.SystemEndpoints.MapSystemEndpoints(app);
WinCare.Api.Rmm.Actions.LibraryEndpoints.MapLibraryEndpoints(app);
WinCare.Api.Rmm.Monitoring.ChecksTasksEndpoints.MapChecksTasksEndpoints(app);
WinCare.Api.Rmm.Monitoring.AlertsPatchesEndpoints.MapAlertsPatchesEndpoints(app);
WinCare.Api.Rmm.Mesh.MeshEndpoints.MapMeshEndpoints(app);
WinCare.Api.Tickets.TicketEndpoints.MapTicketEndpoints(app);
WinCare.Api.Tickets.Tray.MapTrayEndpoints(app);
WinCare.Api.Inventory.AssetEndpoints.MapAssetEndpoints(app);
WinCare.Api.Inventory.DocsEndpoints.MapDocsEndpoints(app);
WinCare.Api.Rmm.Maintenance.WinCareEndpoints.MapWinCareEndpoints(app);

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
