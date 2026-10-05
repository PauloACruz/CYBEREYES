using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tickets;

/// <summary>Abre incidentes a partir de alertas e acompanha a resolucao do alerta.</summary>
public sealed partial class IncidentService(CybereyesDbContext db, TicketService tickets, ILogger<IncidentService> logger)
{
    public async Task OnAlertRaisedAsync(Alert alert, CancellationToken ct)
    {
        try
        {
            var settings = await SettingsStore.GetAsync(db, ct);
            if (!settings.IncidentsEnabled || !settings.IncidentSeverities.Contains(alert.Severity))
            {
                return;
            }

            var reusable = await (
                from t in db.Tickets
                join a in db.Alerts on t.AlertId equals a.Id
                where t.AgentId == alert.AgentId && t.Type == TicketType.Incident && TicketStatus.Open.Contains(t.Status) &&
                      a.AlertType == alert.AlertType && a.CheckId == alert.CheckId && a.TaskId == alert.TaskId &&
                      a.SnmpDeviceId == alert.SnmpDeviceId && a.SubjectKey == alert.SubjectKey
                select t).FirstOrDefaultAsync(ct);
            if (reusable is not null)
            {
                reusable.AlertId = alert.Id;
                await tickets.SystemMessageAsync(reusable, $"O alerta ocorreu novamente: {alert.Message}", ct);
                return;
            }

            var device = alert.SnmpDeviceId is { } deviceId
                ? await db.SnmpDevices.AsNoTracking().Where(d => d.Id == deviceId).Select(d => new { d.Name, d.ClientId, d.SiteId }).FirstOrDefaultAsync(ct)
                : null;
            var hostname = device?.Name ?? await db.Agents.AsNoTracking().Where(a => a.Id == alert.AgentId).Select(a => a.Hostname).FirstOrDefaultAsync(ct) ?? "?";
            var title = $"[{hostname}] {alert.Message}";
            var queueId = settings.IncidentQueueId is { } q && await db.TicketQueues.AnyAsync(x => x.Id == q, ct) ? q : (int?)null;
            var created = await tickets.CreateAsync(new NewTicket(title.Length > 200 ? title[..200] : title, alert.Message, TicketType.Incident,
                settings.IncidentPriority, queueId, alert.AgentId, "Monitoramento", null, null, null, alert.Id, TicketSource.Alert, null), ct);
            if (device is not null && alert.AgentId is null)
            {
                created.ClientId = device.ClientId;
                created.SiteId = device.SiteId;
                await db.SaveChangesAsync(ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogIncidentFailed(logger, alert.Id, ex);
        }
    }

    public async Task OnAlertsResolvedAsync(IReadOnlyCollection<long> alertIds, CancellationToken ct)
    {
        if (alertIds.Count == 0)
        {
            return;
        }
        try
        {
            var settings = await SettingsStore.GetAsync(db, ct);
            var open = await db.Tickets.Where(t => t.AlertId != null && alertIds.Contains(t.AlertId.Value) && TicketStatus.Open.Contains(t.Status))
                .ToListAsync(ct);
            foreach (var ticket in open)
            {
                await tickets.SystemMessageAsync(ticket, "O alerta de origem foi resolvido", ct);
                if (settings.IncidentResolveWithAlert && ticket.AssignedToId is null)
                {
                    await tickets.ChangeStatusAsync(ticket, TicketStatus.Resolved, "Monitoramento", ct);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogResolveFailed(logger, ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao abrir incidente para o alerta {AlertId}")]
    private static partial void LogIncidentFailed(ILogger logger, long alertId, Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao atualizar incidentes de alertas resolvidos")]
    private static partial void LogResolveFailed(ILogger logger, Exception ex);
}
