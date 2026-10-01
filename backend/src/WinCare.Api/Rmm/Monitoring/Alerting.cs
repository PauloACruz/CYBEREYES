using System.Net.Http.Json;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;

namespace WinCare.Api.Rmm.Monitoring;

public sealed record AlertRequest(int AgentId, string AlertType, int? CheckId, int? TaskId, string Severity, string Message,
    bool Email, bool Webhook, bool Dashboard);

public interface INotificationSender
{
    Task SendEmailAsync(CoreSettings settings, IReadOnlyList<string> recipients, string subject, string body, CancellationToken ct);

    Task SendWebhookAsync(string url, object payload, CancellationToken ct);
}

public sealed class NotificationSender(IHttpClientFactory http, IDataProtectionProvider protection) : INotificationSender
{
    public async Task SendEmailAsync(CoreSettings settings, IReadOnlyList<string> recipients, string subject, string body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(settings.SmtpHost) || string.IsNullOrWhiteSpace(settings.SmtpFrom) || recipients.Count == 0)
        {
            throw new InvalidOperationException("SMTP nao configurado ou sem destinatarios");
        }

        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(settings.SmtpFrom));
        foreach (var address in recipients)
        {
            message.To.Add(MailboxAddress.Parse(address));
        }
        message.Subject = subject;
        message.Body = new TextPart("plain") { Text = body };

        using var client = new SmtpClient();
        client.Timeout = 15000;
        await client.ConnectAsync(settings.SmtpHost, settings.SmtpPort,
            settings.SmtpUseTls ? SecureSocketOptions.StartTlsWhenAvailable : SecureSocketOptions.None, ct);
        if (!string.IsNullOrEmpty(settings.SmtpUsername) && settings.SmtpPasswordProtected is { } protectedPassword)
        {
            var password = protection.CreateProtector(SettingsStore.SmtpPurpose).Unprotect(protectedPassword);
            await client.AuthenticateAsync(settings.SmtpUsername, password, ct);
        }
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
    }

    public async Task SendWebhookAsync(string url, object payload, CancellationToken ct)
    {
        using var client = http.CreateClient("webhooks");
        client.Timeout = TimeSpan.FromSeconds(15);
        using var response = await client.PostAsJsonAsync(new Uri(url), payload, ct);
        response.EnsureSuccessStatusCode();
    }
}

/// <summary>Cria, atualiza e resolve alertas e envia as notificacoes conforme o template do agente.</summary>
public sealed partial class AlertService(WinCareDbContext db, INotificationSender sender, IHubContext<ConsoleHub> hub, IConfiguration config,
    TimeProvider time, ILogger<AlertService> logger, Tickets.IncidentService incidents)
{
    public async Task<Alert> RaiseAsync(AlertRequest request, CancellationToken ct)
    {
        var existing = await db.Alerts.FirstOrDefaultAsync(a => a.AgentId == request.AgentId && a.AlertType == request.AlertType &&
            a.CheckId == request.CheckId && a.TaskId == request.TaskId && !a.Resolved, ct);
        if (existing is not null)
        {
            existing.Severity = request.Severity;
            existing.Message = Truncate(request.Message);
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var alert = new Alert
        {
            AgentId = request.AgentId,
            AlertType = request.AlertType,
            CheckId = request.CheckId,
            TaskId = request.TaskId,
            Severity = request.Severity,
            Message = Truncate(request.Message),
            CreatedAt = time.GetUtcNow(),
        };
        db.Alerts.Add(alert);
        await db.SaveChangesAsync(ct);

        var template = await TemplateForAsync(request.AgentId, ct);
        var settings = await SettingsStore.GetAsync(db, ct);
        if (template is not null)
        {
            if (request.Email && template.EmailSeverities.Contains(request.Severity) && template.EmailRecipients.Count > 0)
            {
                alert.EmailSent = await TryAsync(() => sender.SendEmailAsync(settings, template.EmailRecipients,
                    $"[WinCare] Alerta {SeverityName(alert.Severity)}: {alert.Message}", Body(alert, created: true), ct));
            }
            var webhook = template.WebhookUrl ?? settings.DefaultWebhookUrl;
            if (request.Webhook && template.WebhookSeverities.Contains(request.Severity) && !string.IsNullOrWhiteSpace(webhook))
            {
                alert.WebhookSent = await TryAsync(() => sender.SendWebhookAsync(webhook, Payload("alert.created", alert), ct));
            }
            await db.SaveChangesAsync(ct);
        }

        await BroadcastAsync(ct);
        await incidents.OnAlertRaisedAsync(alert, ct);
        return alert;
    }

    public async Task ResolveAsync(int agentId, string alertType, int? checkId, int? taskId, CancellationToken ct)
    {
        var open = await db.Alerts.Where(a => a.AgentId == agentId && a.AlertType == alertType && a.CheckId == checkId && a.TaskId == taskId && !a.Resolved)
            .ToListAsync(ct);
        if (open.Count == 0)
        {
            return;
        }

        var template = await TemplateForAsync(agentId, ct);
        var settings = await SettingsStore.GetAsync(db, ct);
        foreach (var alert in open)
        {
            alert.Resolved = true;
            alert.ResolvedAt = time.GetUtcNow();
            if (template?.NotifyOnResolved == true)
            {
                if (alert.EmailSent && template.EmailRecipients.Count > 0)
                {
                    await TryAsync(() => sender.SendEmailAsync(settings, template.EmailRecipients, $"[WinCare] Resolvido: {alert.Message}", Body(alert, created: false), ct));
                }
                var webhook = template.WebhookUrl ?? settings.DefaultWebhookUrl;
                if (alert.WebhookSent && !string.IsNullOrWhiteSpace(webhook))
                {
                    await TryAsync(() => sender.SendWebhookAsync(webhook, Payload("alert.resolved", alert), ct));
                }
            }
        }
        await db.SaveChangesAsync(ct);
        await BroadcastAsync(ct);
        await incidents.OnAlertsResolvedAsync(open.Select(a => a.Id).ToList(), ct);
    }

    public Task AlertsResolvedAsync(IReadOnlyCollection<long> alertIds, CancellationToken ct) => incidents.OnAlertsResolvedAsync(alertIds, ct);

    public async Task BroadcastAsync(CancellationToken ct)
    {
        var active = await db.Alerts.CountAsync(a => !a.Resolved, ct);
        await hub.Clients.All.SendAsync("alertsChanged", new { activeCount = active }, ct);
    }

    public async Task<AlertTemplate?> TemplateForAsync(int agentId, CancellationToken ct)
    {
        var ids = await db.Agents.AsNoTracking().Where(a => a.Id == agentId)
            .Select(a => new { Agent = a.AlertTemplateId, Site = a.Site!.AlertTemplateId, Client = a.Site.Client!.AlertTemplateId })
            .FirstOrDefaultAsync(ct);
        var templateId = ids?.Agent ?? ids?.Site ?? ids?.Client ?? (await SettingsStore.GetAsync(db, ct)).DefaultAlertTemplateId;
        return templateId is null ? null : await db.AlertTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Id == templateId, ct);
    }

    private object Payload(string evt, Alert alert) => new
    {
        @event = evt,
        alert = new { alert.Id, alert.AgentId, alert.AlertType, alert.CheckId, alert.TaskId, alert.Severity, alert.Message, alert.CreatedAt, alert.Resolved, alert.ResolvedAt },
        url = $"{(config["App:PublicUrl"] ?? string.Empty).TrimEnd('/')}/agentes/{alert.AgentId}",
    };

    private string Body(Alert alert, bool created) =>
        $"{(created ? "Novo alerta" : "Alerta resolvido")} ({SeverityName(alert.Severity)})\n\n{alert.Message}\n\n" +
        $"Criado em: {alert.CreatedAt:dd/MM/yyyy HH:mm} UTC\nAgente: {(config["App:PublicUrl"] ?? string.Empty).TrimEnd('/')}/agentes/{alert.AgentId}";

    private static string SeverityName(string severity) => severity switch
    {
        Severity.Error => "erro",
        Severity.Warning => "aviso",
        _ => "informativo",
    };

    private async Task<bool> TryAsync(Func<Task> send)
    {
        try
        {
            await send();
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogNotificationFailed(logger, ex);
            return false;
        }
    }

    private static string Truncate(string message) => message.Length <= 2000 ? message : message[..2000];

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao enviar notificacao de alerta")]
    private static partial void LogNotificationFailed(ILogger logger, Exception ex);
}
