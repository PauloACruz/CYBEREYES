using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NATS.Client.Core;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;

namespace WinCare.Api.Rmm.Nats;

/// <summary>Mantem o arquivo de usuarios do NATS em dia: na partida, sob demanda e a cada 5 minutos.</summary>
public sealed partial class NatsAuthSync(NatsAuthWriter writer, ILogger<NatsAuthSync> logger) : BackgroundService
{
    private readonly Channel<bool> requests = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    public void Request() => requests.Writer.TryWrite(true);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Request();
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        var tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
        while (!stoppingToken.IsCancellationRequested)
        {
            var read = requests.Reader.WaitToReadAsync(stoppingToken).AsTask();
            var done = await Task.WhenAny(read, tick);
            if (done == tick)
            {
                tick = timer.WaitForNextTickAsync(stoppingToken).AsTask();
            }
            requests.Reader.TryRead(out _);
            try
            {
                await writer.WriteAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or DbUpdateException or InvalidOperationException)
            {
                LogFailed(logger, ex);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha ao atualizar o arquivo de usuarios do NATS")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

/// <summary>
/// Processa o check-in dos agentes: o agente publica no assunto igual ao seu agent_id, com o tipo no campo reply.
/// O grupo de fila garante que cada mensagem seja tratada por uma unica replica da API.
/// </summary>
public sealed partial class CheckinConsumer(
    INatsConnection nats,
    IServiceScopeFactory scopes,
    IAgentNotifier notifier,
    TimeProvider time,
    ILogger<CheckinConsumer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await foreach (var msg in nats.SubscribeAsync("*", queueGroup: "wincare-api",
                                   serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: stoppingToken))
                {
                    if (string.IsNullOrEmpty(msg.ReplyTo) || !msg.ReplyTo.StartsWith("agent-", StringComparison.Ordinal) || msg.Data is null)
                    {
                        continue;
                    }
                    try
                    {
                        await HandleAsync(msg.Subject, msg.ReplyTo, msg.Data, stoppingToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        LogHandleFailed(logger, ex, msg.ReplyTo, msg.Subject);
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogSubscriptionFailed(logger, ex);
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    public async Task HandleAsync(string agentId, string mode, byte[] data, CancellationToken ct)
    {
        var payload = MsgPack.DeserializeMap(data);
        if (payload is null || payload.GetString("agent_id") != agentId)
        {
            return;
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var agents = db.Agents.Where(a => a.AgentId == agentId);

        switch (mode)
        {
            case "agent-hello":
                var now = time.GetUtcNow();
                var version = payload.GetString("version") ?? "0.1.0";
                await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.LastSeen, now).SetProperty(a => a.Version, version), ct);
                var changed = await agents.Where(a => a.Status != AgentStatus.Online)
                    .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AgentStatus.Online), ct);
                if (changed > 0)
                {
                    await notifier.StatusChangedAsync(agentId, AgentStatus.Online, now, ct);
                    var pk = await db.Agents.Where(a => a.AgentId == agentId).Select(a => a.Id).FirstAsync(ct);
                    await AgentStatusMonitor.AvailabilityAlertAsync(scope.ServiceProvider, pk, AgentStatus.Online, ct);
                }
                break;

            case "agent-publicip":
                var ip = payload.GetString("public_ip");
                await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.PublicIp, ip), ct);
                break;

            case "agent-agentinfo":
                var hostname = payload.GetString("hostname") ?? agentId;
                var os = payload.GetString("operating_system");
                var plat = payload.GetString("plat") ?? "windows";
                var ram = payload.GetNumber("total_ram") is { } r ? (int?)Math.Ceiling(r) : null;
                var boot = payload.GetNumber("boot_time");
                var reboot = payload.GetBool("needs_reboot");
                var user = payload.GetString("logged_in_username");
                var arch = payload.GetString("goarch");
                await agents.ExecuteUpdateAsync(s => s
                    .SetProperty(a => a.Hostname, hostname)
                    .SetProperty(a => a.OperatingSystem, os)
                    .SetProperty(a => a.Plat, plat)
                    .SetProperty(a => a.TotalRam, ram)
                    .SetProperty(a => a.BootTime, boot)
                    .SetProperty(a => a.NeedsReboot, reboot)
                    .SetProperty(a => a.LoggedInUsername, user)
                    .SetProperty(a => a.GoArch, arch), ct);
                if (!string.IsNullOrEmpty(user) && user != "None")
                {
                    await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.LastLoggedInUser, user), ct);
                }
                break;

            case "agent-disks":
                var disks = MsgPack.ToJson(payload.GetValueOrDefault("disks"));
                await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.Disks, disks), ct);
                break;

            case "agent-winsvc":
                var services = MsgPack.ToJson(payload.GetValueOrDefault("services"));
                await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.Services, services), ct);
                break;

            case "agent-wmi":
                var wmi = MsgPack.ToJson(payload.GetValueOrDefault("wmi"));
                await agents.ExecuteUpdateAsync(s => s.SetProperty(a => a.WmiDetail, wmi), ct);
                break;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao processar {Mode} do agente {AgentId}")]
    private static partial void LogHandleFailed(ILogger logger, Exception ex, string mode, string agentId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Assinatura NATS de check-in interrompida, nova tentativa em 5 s")]
    private static partial void LogSubscriptionFailed(ILogger logger, Exception ex);
}

/// <summary>Detecta agentes que ficaram offline ou em atraso e avisa o console.</summary>
public sealed partial class AgentStatusMonitor(IServiceScopeFactory scopes, IAgentNotifier notifier, TimeProvider time,
    ILogger<AgentStatusMonitor> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var now = time.GetUtcNow();
        var agents = await db.Agents.AsNoTracking()
            .Select(a => new { a.Id, a.AgentId, a.LastSeen, a.OfflineTime, a.OverdueTime, a.Status })
            .ToListAsync(ct);

        foreach (var agent in agents)
        {
            var status = AgentStatus.Compute(agent.LastSeen, agent.OfflineTime, agent.OverdueTime, now);
            if (status == agent.Status)
            {
                continue;
            }

            var updated = await db.Agents.Where(a => a.Id == agent.Id && a.Status == agent.Status)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, status), ct);
            if (updated > 0)
            {
                await notifier.StatusChangedAsync(agent.AgentId, status, agent.LastSeen, ct);
                await AvailabilityAlertAsync(scope.ServiceProvider, agent.Id, status, ct);
            }
        }
    }

    public static async Task AvailabilityAlertAsync(IServiceProvider services, int agentId, string status, CancellationToken ct)
    {
        var alerts = services.GetRequiredService<Monitoring.AlertService>();
        if (status == AgentStatus.Overdue)
        {
            var template = await alerts.TemplateForAsync(agentId, ct);
            var db = services.GetRequiredService<WinCareDbContext>();
            var hostname = await db.Agents.Where(a => a.Id == agentId).Select(a => a.Hostname).FirstOrDefaultAsync(ct);
            await alerts.RaiseAsync(new Monitoring.AlertRequest(agentId, Core.Rmm.AlertTypes.Availability, null, null, Core.Rmm.Severity.Error,
                $"{hostname}: agente sem comunicacao (em atraso)", template?.AgentOverdueEmail == true, template?.AgentOverdueWebhook == true,
                template?.AgentOverdueDashboard ?? true), ct);
        }
        else if (status == AgentStatus.Online)
        {
            await alerts.ResolveAsync(agentId, Core.Rmm.AlertTypes.Availability, null, null, ct);
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha ao atualizar o status dos agentes")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
