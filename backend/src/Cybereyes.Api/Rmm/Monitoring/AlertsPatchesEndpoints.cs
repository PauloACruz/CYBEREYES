using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Monitoring;

public sealed record SnoozeRequest(DateTimeOffset Until);
public sealed record BulkAlertRequest([property: Required] List<long> Ids, [property: Required] string Action, DateTimeOffset? Until);

public sealed record SaveTemplateRequest(
    [property: Required, StringLength(255, MinimumLength = 1)] string Name,
    List<string>? EmailRecipients, [property: StringLength(2000)] string? WebhookUrl,
    List<string>? EmailSeverities, List<string>? WebhookSeverities, List<string>? DashboardSeverities,
    bool NotifyOnResolved, bool AgentOverdueEmail, bool AgentOverdueWebhook, bool AgentOverdueDashboard);

public sealed record TemplateAssignmentRequest([property: Required] string Target, int? TargetId, int? TemplateId);
public sealed record BlockInheritanceRequest([property: Required] string Target, int TargetId, bool Block);

public sealed record SettingsRequest(
    [property: StringLength(255)] string? SmtpHost, [property: Range(1, 65535)] int SmtpPort, [property: StringLength(255)] string? SmtpUsername,
    [property: StringLength(1000)] string? SmtpPassword, [property: StringLength(255)] string? SmtpFrom, bool SmtpUseTls,
    [property: StringLength(2000)] string? DefaultWebhookUrl, [property: Required] string TimeZone,
    [property: Range(1, 3650)] int CheckHistoryDays, [property: Range(1, 3650)] int AgentHistoryDays);

public sealed record TestEmailRequest([property: Required, EmailAddress] string To);
public sealed record TestWebhookRequest([property: Required] string Url);
public sealed record UpdateActionRequest([property: Required] string Action);
public sealed record PatchPolicyRequest(string Critical, string Important, string Moderate, string Low, string Other,
    List<int>? RunTimeDays, [property: Range(0, 23)] int RunTimeHour, string RebootAfterInstall);
/// <summary>Pacote a instalar. Manager: "choco" (padrao) ou "winget".</summary>
public sealed record InstallSoftwareRequest([property: Required, StringLength(128, MinimumLength = 1)] string Package, string? Manager);

public static partial class AlertsPatchesEndpoints
{
    private static readonly HashSet<string> PatchRules = new(StringComparer.Ordinal) { "approve", "ignore", "manual" };

    public static void MapAlertsPatchesEndpoints(this IEndpointRouteBuilder app)
    {
        var alertsView = Policies.Permission(Permissions.AlertsView);
        var alertsManage = Policies.Permission(Permissions.AlertsManage);
        var settings = Policies.Permission(Permissions.SettingsManage);
        var view = Policies.Permission(Permissions.AgentsView);
        var patches = Policies.Permission(Permissions.PatchesManage);

        var alerts = app.MapGroup("/api/alerts").WithTags("Alertas");
        alerts.MapGet("/", ListAlertsAsync).RequireAuthorization(alertsView);
        alerts.MapPost("/{id:long}/resolve", (long id, CybereyesDbContext db, AlertService svc, CancellationToken ct) =>
            BulkAsync(new BulkAlertRequest([id], "resolve", null), db, svc, ct)).RequireAuthorization(alertsManage);
        alerts.MapPost("/{id:long}/snooze", (long id, SnoozeRequest r, CybereyesDbContext db, AlertService svc, CancellationToken ct) =>
            BulkAsync(new BulkAlertRequest([id], "snooze", r.Until), db, svc, ct)).RequireAuthorization(alertsManage);
        alerts.MapPost("/bulk", BulkAsync).RequireAuthorization(alertsManage);

        var templates = app.MapGroup("/api/alert-templates").WithTags("Alertas");
        templates.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await db.AlertTemplates.AsNoTracking().OrderBy(t => t.Name).ToListAsync(ct)))
            .RequireAuthorization(alertsView);
        templates.MapPost("/", (SaveTemplateRequest r, CybereyesDbContext db, IAuditService a, CancellationToken ct) => SaveTemplateAsync(null, r, db, a, ct)).RequireAuthorization(alertsManage);
        templates.MapPut("/{id:int}", (int id, SaveTemplateRequest r, CybereyesDbContext db, IAuditService a, CancellationToken ct) => SaveTemplateAsync(id, r, db, a, ct)).RequireAuthorization(alertsManage);
        templates.MapDelete("/{id:int}", async (int id, CybereyesDbContext db, CancellationToken ct) =>
        {
            var s = await SettingsStore.GetAsync(db, ct);
            if (s.DefaultAlertTemplateId == id)
            {
                s.DefaultAlertTemplateId = null;
                await db.SaveChangesAsync(ct);
            }
            return await db.AlertTemplates.Where(t => t.Id == id).ExecuteDeleteAsync(ct) == 0 ? Problems.NotFound("Template") : TypedResults.NoContent();
        }).RequireAuthorization(alertsManage);
        templates.MapGet("/assignments", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(new
        {
            global = (await SettingsStore.GetAsync(db, ct)).DefaultAlertTemplateId,
            clients = await db.Clients.AsNoTracking().Select(c => new { c.Id, c.Name, c.AlertTemplateId }).ToListAsync(ct),
            sites = await db.Sites.AsNoTracking().Select(s => new { s.Id, s.ClientId, s.Name, s.AlertTemplateId }).ToListAsync(ct),
            agents = await db.Agents.AsNoTracking().Where(a => a.AlertTemplateId != null).Select(a => new { a.Id, a.Hostname, a.AlertTemplateId }).ToListAsync(ct),
        })).RequireAuthorization(alertsView);
        templates.MapPut("/assignments", AssignTemplateAsync).RequireAuthorization(alertsManage);

        app.MapPut("/api/policies/block-inheritance", BlockInheritanceAsync).WithTags("Politicas").RequireAuthorization(Policies.Permission(Permissions.PoliciesManage));

        var st = app.MapGroup("/api/settings").WithTags("Configuracoes").RequireAuthorization(settings);
        st.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(SettingsDto(await SettingsStore.GetAsync(db, ct))));
        st.MapPut("/", SaveSettingsAsync);
        st.MapPost("/test-email", async (TestEmailRequest r, CybereyesDbContext db, INotificationSender sender, IConfiguration config, CancellationToken ct) =>
        {
            try
            {
                await sender.SendEmailAsync(await SettingsStore.GetAsync(db, ct), [r.To], EmailTemplates.SmtpTest(config["App:PublicUrl"]), ct);
                return TypedResults.Ok(new { success = true, message = "E-mail enviado" });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return TypedResults.Ok(new { success = false, message = ex.Message });
            }
        });
        st.MapPost("/test-webhook", async (TestWebhookRequest r, INotificationSender sender, CancellationToken ct) =>
        {
            if (!Uri.TryCreate(r.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            {
                return Problems.BadRequest("URL invalida");
            }
            try
            {
                await sender.SendWebhookAsync(r.Url, new { @event = "test", message = "Teste de webhook do Cybereyes" }, ct);
                return TypedResults.Ok(new { success = true, message = "Webhook enviado" });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return TypedResults.Ok(new { success = false, message = ex.Message });
            }
        });

        var ag = app.MapGroup("/api/agents/{id:int}").WithTags("Atualizacoes e software");
        ag.MapGet("/updates", async (int id, CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await db.WinUpdates.AsNoTracking()
            .Where(u => u.AgentId == id).OrderBy(u => u.Installed).ThenBy(u => u.Title)
            .Select(u => new { u.Id, guid = u.UpdateGuid, u.Kb, u.Title, u.Severity, u.Categories, u.Installed, u.Downloaded, u.Action, u.Result, u.DateInstalled, u.MoreInfoUrls })
            .ToListAsync(ct))).RequireAuthorization(view);
        ag.MapPut("/updates/{updateId:long}", async (int id, long updateId, UpdateActionRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) =>
        {
            if (r.Action is not ("approve" or "ignore" or "nothing"))
            {
                return Problems.BadRequest("Acao invalida");
            }
            var update = await db.WinUpdates.FirstOrDefaultAsync(u => u.Id == updateId && u.AgentId == id, ct);
            if (update is null)
            {
                return Problems.NotFound("Atualizacao");
            }
            update.Action = r.Action;
            await db.SaveChangesAsync(ct);
            await audit.LogAsync("update.action", "agent", Id(id), $"{update.Kb}: {r.Action}", cancellationToken: ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(patches);
        ag.MapPost("/updates/scan", (int id, CybereyesDbContext db, IAgentRpc rpc, CancellationToken ct) => PublishAsync(id, db, rpc, "getwinupdates", null, ct))
            .RequireAuthorization(view);
        ag.MapPost("/updates/install", async (int id, CybereyesDbContext db, IAgentRpc rpc, IAuditService audit, CancellationToken ct) =>
        {
            var guids = await db.WinUpdates.Where(u => u.AgentId == id && !u.Installed && u.Action == "approve").Select(u => u.UpdateGuid).ToListAsync(ct);
            if (guids.Count == 0)
            {
                return Problems.BadRequest("Nenhuma atualizacao aprovada pendente");
            }
            await audit.LogAsync("update.install", "agent", Id(id), $"Instalacao de {guids.Count} atualizacoes", cancellationToken: ct);
            return await PublishAsync(id, db, rpc, "installwinupdates", new() { ["guids"] = guids }, ct);
        }).RequireAuthorization(patches);
        ag.MapGet("/patch-policy", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(new { own = await db.PatchPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.AgentId == id, ct), effective = await PatchPolicies.EffectiveAsync(db, id, ct) }))
            .RequireAuthorization(view);
        ag.MapPut("/patch-policy", (int id, PatchPolicyRequest r, CybereyesDbContext db, IAuditService a, CancellationToken ct) => SavePatchPolicyAsync(null, id, r, db, a, ct))
            .RequireAuthorization(patches);
        ag.MapDelete("/patch-policy", async (int id, CybereyesDbContext db, CancellationToken ct) =>
        {
            await db.PatchPolicies.Where(p => p.AgentId == id).ExecuteDeleteAsync(ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(patches);
        app.MapGet("/api/policies/{id:int}/patch-policy", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            TypedResults.Ok(await db.PatchPolicies.AsNoTracking().FirstOrDefaultAsync(p => p.PolicyId == id, ct))).WithTags("Politicas").RequireAuthorization(view);
        app.MapPut("/api/policies/{id:int}/patch-policy", (int id, PatchPolicyRequest r, CybereyesDbContext db, IAuditService a, CancellationToken ct) => SavePatchPolicyAsync(id, null, r, db, a, ct))
            .WithTags("Politicas").RequireAuthorization(patches);

        ag.MapGet("/software", async (int id, CybereyesDbContext db, CancellationToken ct) =>
        {
            var row = await db.AgentSoftware.AsNoTracking().FirstOrDefaultAsync(s => s.AgentId == id, ct);
            return TypedResults.Ok(new { updatedAt = row?.UpdatedAt, items = SoftwareItems(row?.Software) });
        }).RequireAuthorization(view);
        ag.MapPost("/software/refresh", RefreshSoftwareAsync).RequireAuthorization(view);
        ag.MapPost("/software/install", InstallSoftwareAsync).RequireAuthorization(Policies.Permission(Permissions.SoftwareManage));
        ag.MapGet("/pending-actions", async (int id, CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await db.PendingActions.AsNoTracking()
            .Where(p => p.AgentId == id).OrderByDescending(p => p.CreatedAt).Take(100)
            .Select(p => new { p.Id, p.Type, p.Details, p.Status, p.Output, p.CreatedAt }).ToListAsync(ct))).RequireAuthorization(view);
    }

    private static async Task<IResult> ListAlertsAsync(CybereyesDbContext db, string? status, string? severity, int? clientId, int? agentId, int? page, int? pageSize, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize, 50);
        var query = db.Alerts.AsNoTracking();
        query = status switch
        {
            "resolved" => query.Where(a => a.Resolved),
            "all" => query,
            _ => query.Where(a => !a.Resolved),
        };
        if (!string.IsNullOrWhiteSpace(severity))
        {
            query = query.Where(a => a.Severity == severity);
        }
        if (clientId is { } c)
        {
            query = query.Where(a => a.Agent!.Site!.ClientId == c || a.SnmpDevice!.ClientId == c);
        }
        if (agentId is { } ag)
        {
            query = query.Where(a => a.AgentId == ag);
        }
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(a => a.CreatedAt).Skip((p - 1) * size).Take(size)
            .Select(a => new
            {
                a.Id, a.AgentId, a.Agent!.Hostname, a.SnmpDeviceId, DeviceName = a.SnmpDevice!.Name,
                // Subconsultas em vez de a.Agent.Site.Client: com o filtro de clientes, a navegacao obrigatoria depois do
                // agente opcional vira INNER JOIN e some com os alertas de SNMP.
                ClientName = db.Clients.Where(x => x.Id == (a.AgentId != null ? a.Agent!.Site!.ClientId : a.SnmpDevice!.ClientId)).Select(x => x.Name).FirstOrDefault(),
                SiteName = db.Sites.Where(x => x.Id == (a.AgentId != null ? a.Agent!.SiteId : a.SnmpDevice!.SiteId)).Select(x => x.Name).FirstOrDefault(),
                a.AlertType, a.CheckId, a.TaskId,
                a.Severity, a.Message, a.CreatedAt, a.Resolved, a.ResolvedAt, a.SnoozedUntil, a.EmailSent, a.WebhookSent,
            }).ToListAsync(ct);
        return TypedResults.Ok(new { items, total, page = p, pageSize = size });
    }

    private static async Task<IResult> BulkAsync(BulkAlertRequest r, CybereyesDbContext db, AlertService svc, CancellationToken ct)
    {
        var alerts = db.Alerts.Where(a => r.Ids.Contains(a.Id));
        switch (r.Action)
        {
            case "resolve":
                await alerts.ExecuteUpdateAsync(s => s.SetProperty(a => a.Resolved, true).SetProperty(a => a.ResolvedAt, DateTimeOffset.UtcNow), ct);
                await svc.AlertsResolvedAsync(r.Ids, ct);
                break;
            case "snooze" when r.Until is { } until && until > DateTimeOffset.UtcNow:
                var u = until.ToUniversalTime();
                await alerts.ExecuteUpdateAsync(s => s.SetProperty(a => a.SnoozedUntil, u), ct);
                break;
            default:
                return Problems.BadRequest("Acao invalida ou data de silencio no passado");
        }
        await svc.BroadcastAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> SaveTemplateAsync(int? id, SaveTemplateRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var lists = new[] { r.EmailSeverities, r.WebhookSeverities, r.DashboardSeverities };
        if (lists.Any(l => (l ?? []).Any(s => !Severity.All.Contains(s))))
        {
            return Problems.BadRequest("Severidade invalida");
        }
        if (r.WebhookUrl is { Length: > 0 } url && (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))
        {
            return Problems.BadRequest("URL de webhook invalida");
        }
        if (await db.AlertTemplates.AnyAsync(t => t.Name == r.Name.Trim() && t.Id != id, ct))
        {
            return Problems.Conflict("Ja existe um template com esse nome");
        }
        var template = id is null ? new AlertTemplate { Name = r.Name } : await db.AlertTemplates.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (template is null)
        {
            return Problems.NotFound("Template");
        }
        template.Name = r.Name.Trim();
        template.EmailRecipients = (r.EmailRecipients ?? []).Select(e => e.Trim()).Where(e => e.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        template.WebhookUrl = string.IsNullOrWhiteSpace(r.WebhookUrl) ? null : r.WebhookUrl.Trim();
        template.EmailSeverities = r.EmailSeverities ?? [];
        template.WebhookSeverities = r.WebhookSeverities ?? [];
        template.DashboardSeverities = r.DashboardSeverities ?? [];
        template.NotifyOnResolved = r.NotifyOnResolved;
        template.AgentOverdueEmail = r.AgentOverdueEmail;
        template.AgentOverdueWebhook = r.AgentOverdueWebhook;
        template.AgentOverdueDashboard = r.AgentOverdueDashboard;
        if (id is null)
        {
            db.AlertTemplates.Add(template);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "alert-template.created" : "alert-template.updated", "alert-template", Id(template.Id), template.Name, cancellationToken: ct);
        return id is null ? TypedResults.Created($"/api/alert-templates/{template.Id}", template) : TypedResults.Ok(template);
    }

    private static async Task<IResult> AssignTemplateAsync(TemplateAssignmentRequest r, CybereyesDbContext db, CancellationToken ct)
    {
        if (r.TemplateId is { } tid && !await db.AlertTemplates.AnyAsync(t => t.Id == tid, ct))
        {
            return Problems.BadRequest("Template nao encontrado");
        }
        switch (r.Target)
        {
            case "global":
                (await SettingsStore.GetAsync(db, ct)).DefaultAlertTemplateId = r.TemplateId;
                break;
            case "client" when await db.Clients.FirstOrDefaultAsync(c => c.Id == r.TargetId, ct) is { } client:
                client.AlertTemplateId = r.TemplateId;
                break;
            case "site" when await db.Sites.FirstOrDefaultAsync(s => s.Id == r.TargetId, ct) is { } site:
                site.AlertTemplateId = r.TemplateId;
                break;
            case "agent" when await db.Agents.FirstOrDefaultAsync(a => a.Id == r.TargetId, ct) is { } agent:
                agent.AlertTemplateId = r.TemplateId;
                break;
            default:
                return Problems.BadRequest("Destino invalido");
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> BlockInheritanceAsync(BlockInheritanceRequest r, CybereyesDbContext db, CancellationToken ct)
    {
        switch (r.Target)
        {
            case "client" when await db.Clients.FirstOrDefaultAsync(c => c.Id == r.TargetId, ct) is { } client:
                client.BlockPolicyInheritance = r.Block;
                break;
            case "site" when await db.Sites.FirstOrDefaultAsync(s => s.Id == r.TargetId, ct) is { } site:
                site.BlockPolicyInheritance = r.Block;
                break;
            case "agent" when await db.Agents.FirstOrDefaultAsync(a => a.Id == r.TargetId, ct) is { } agent:
                agent.BlockPolicyInheritance = r.Block;
                break;
            default:
                return Problems.BadRequest("Destino invalido");
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static object SettingsDto(CoreSettings s) => new
    {
        s.SmtpHost, s.SmtpPort, s.SmtpUsername, smtpPasswordSet = s.SmtpPasswordProtected is not null, s.SmtpFrom, s.SmtpUseTls,
        s.DefaultWebhookUrl, s.TimeZone, s.CheckHistoryDays, s.AgentHistoryDays,
    };

    private static async Task<IResult> SaveSettingsAsync(SettingsRequest r, CybereyesDbContext db, IDataProtectionProvider protection, IAuditService audit, CancellationToken ct)
    {
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(r.TimeZone, out _))
        {
            return Problems.BadRequest("Fuso horario invalido");
        }
        var s = await SettingsStore.GetAsync(db, ct);
        s.SmtpHost = r.SmtpHost?.Trim();
        s.SmtpPort = r.SmtpPort;
        s.SmtpUsername = r.SmtpUsername?.Trim();
        if (r.SmtpPassword is { } password)
        {
            s.SmtpPasswordProtected = password.Length == 0 ? null : protection.CreateProtector(DataProtectionNames.SmtpPasswordPurpose).Protect(password);
        }
        s.SmtpFrom = r.SmtpFrom?.Trim();
        s.SmtpUseTls = r.SmtpUseTls;
        s.DefaultWebhookUrl = string.IsNullOrWhiteSpace(r.DefaultWebhookUrl) ? null : r.DefaultWebhookUrl.Trim();
        s.TimeZone = r.TimeZone;
        s.CheckHistoryDays = r.CheckHistoryDays;
        s.AgentHistoryDays = r.AgentHistoryDays;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("settings.updated", "settings", "1", "Configuracoes globais alteradas", cancellationToken: ct);
        return TypedResults.Ok(SettingsDto(s));
    }

    private static async Task<IResult> SavePatchPolicyAsync(int? policyId, int? agentId, PatchPolicyRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (new[] { r.Critical, r.Important, r.Moderate, r.Low, r.Other }.Any(x => !PatchRules.Contains(x)) ||
            r.RebootAfterInstall is not ("never" or "required" or "always") || (r.RunTimeDays ?? []).Any(d => d is < 0 or > 6))
        {
            return Problems.BadRequest("Politica de patch invalida");
        }
        var policy = await db.PatchPolicies.FirstOrDefaultAsync(p => (policyId != null && p.PolicyId == policyId) || (agentId != null && p.AgentId == agentId), ct);
        if (policy is null)
        {
            policy = new PatchPolicy { PolicyId = policyId, AgentId = agentId };
            db.PatchPolicies.Add(policy);
        }
        policy.Critical = r.Critical;
        policy.Important = r.Important;
        policy.Moderate = r.Moderate;
        policy.Low = r.Low;
        policy.Other = r.Other;
        policy.RunTimeDays = r.RunTimeDays ?? [];
        policy.RunTimeHour = r.RunTimeHour;
        policy.RebootAfterInstall = r.RebootAfterInstall;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("patch-policy.updated", policyId is null ? "agent" : "policy", Id(policyId ?? agentId ?? 0), "Politica de patch alterada", cancellationToken: ct);
        return TypedResults.Ok(policy);
    }

    private static async Task<IResult> PublishAsync(int id, CybereyesDbContext db, IAgentRpc rpc, string func, Dictionary<string, object?>? extra, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (!agent.IsWindows)
        {
            return Problems.BadRequest("Recurso disponivel somente para agentes Windows");
        }
        var message = new Dictionary<string, object?> { ["func"] = func };
        foreach (var (k, v) in extra ?? [])
        {
            message[k] = v;
        }
        await rpc.PublishAsync(agent.AgentId, message, ct);
        return TypedResults.Accepted((string?)null);
    }

    private static List<object> SoftwareItems(string? json)
    {
        if (json is null)
        {
            return [];
        }
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.ValueKind != JsonValueKind.Array ? [] : doc.RootElement.EnumerateArray().Select(i => (object)new
        {
            name = S(i, "name"), version = S(i, "version"), publisher = S(i, "publisher"), installDate = S(i, "install_date"),
            size = S(i, "size"), source = S(i, "source"), location = S(i, "location"), uninstall = S(i, "uninstall"),
        }).ToList();
    }

    private static string S(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;

    private static async Task<IResult> RefreshSoftwareAsync(int id, CybereyesDbContext db, IAgentRpc rpc, TimeProvider time, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        try
        {
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?> { ["func"] = "softwarelist" }, TimeSpan.FromSeconds(60), ct);
            var json = MsgPack.ToJson(reply ?? Array.Empty<object>());
            var row = await db.AgentSoftware.FirstOrDefaultAsync(s => s.AgentId == id, ct);
            if (row is null)
            {
                db.AgentSoftware.Add(new AgentSoftware { AgentId = id, Software = json, UpdatedAt = time.GetUtcNow() });
            }
            else
            {
                row.Software = json;
                row.UpdatedAt = time.GetUtcNow();
            }
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new { updatedAt = time.GetUtcNow(), items = SoftwareItems(json) });
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,99}$")]
    private static partial System.Text.RegularExpressions.Regex ChocoPackage();

    // Identificadores do winget: Google.Chrome, 7zip.7zip, Notepad++.Notepad++.
    [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9_.+\-]{0,127}$")]
    private static partial System.Text.RegularExpressions.Regex WingetPackage();

    private static async Task<IResult> InstallSoftwareAsync(int id, InstallSoftwareRequest r, CybereyesDbContext db, IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var manager = string.IsNullOrWhiteSpace(r.Manager) ? "choco" : r.Manager.Trim().ToLowerInvariant();
        if (manager is not ("choco" or "winget"))
        {
            return Problems.Validation("manager", "Use choco ou winget");
        }
        var package = r.Package.Trim();
        if (!(manager == "choco" ? ChocoPackage() : WingetPackage()).IsMatch(package))
        {
            return Problems.Validation("package", manager == "choco"
                ? "Use letras, numeros, ponto, hifen ou sublinhado"
                : "Use o identificador do winget: letras, numeros, ponto, hifen, sublinhado ou +");
        }
        var label = manager == "choco" ? "Chocolatey" : "winget";
        if (!agent.IsWindows)
        {
            return Problems.BadRequest($"A instalacao pelo {label} so existe no Windows");
        }
        var action = new PendingAction
        {
            AgentId = id, Type = manager == "choco" ? "chocoinstall" : "wingetinstall",
            Details = JsonSerializer.Serialize(new { name = package, manager }),
        };
        db.PendingActions.Add(action);
        await db.SaveChangesAsync(ct);
        var request = manager == "choco"
            ? new Dictionary<string, object?> { ["func"] = "installwithchoco", ["choco_prog_name"] = package, ["pending_action_pk"] = (int)action.Id }
            : new Dictionary<string, object?> { ["func"] = "installwithwinget", ["winget_id"] = package, ["pending_action_pk"] = (int)action.Id };
        await rpc.PublishAsync(agent.AgentId, request, ct);
        await audit.LogAsync("software.install", "agent", Id(id), $"{agent.Hostname}: instalar {package} ({label})", cancellationToken: ct);
        return TypedResults.Accepted((string?)null, new { pendingActionId = action.Id });
    }

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
