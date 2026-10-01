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
builder.Services.AddSingleton<NatsAuthWriter>();
builder.Services.AddSingleton<NatsAuthSync>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<NatsAuthSync>());
builder.Services.AddHostedService<AgentStatusMonitor>();
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
