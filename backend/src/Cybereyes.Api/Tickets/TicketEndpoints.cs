using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tickets;

public sealed record TicketListItem(
    int Id, string Type, string Title, string Status, string Priority, int QueueId, string QueueName, int? AgentId, string? Hostname,
    string? ClientName, string? SiteName, string RequesterName, Guid? AssignedToId, string? AssignedToName, string Source,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? FirstResponseDueAt, DateTimeOffset? ResolutionDueAt,
    bool SlaBreached, bool UnreadForTechnician);

public sealed record TicketAgentDto(int Id, string Hostname, string Status, string? Plat, string? OperatingSystem, string? LoggedInUsername,
    string? PublicIp, string? MeshNodeId);

public sealed record TicketDetail(
    int Id, string Type, string Title, string Status, string Priority, int QueueId, string QueueName, int? AgentId, string? Hostname,
    string? ClientName, string? SiteName, string RequesterName, Guid? AssignedToId, string? AssignedToName, string Source,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? FirstResponseDueAt, DateTimeOffset? ResolutionDueAt,
    bool SlaBreached, bool UnreadForTechnician, string Description, string? RequesterUsername, string? RequesterEmail, long? AlertId,
    string? CreatedByName, DateTimeOffset? FirstResponseAt, DateTimeOffset? ResolvedAt, DateTimeOffset? ClosedAt, int TotalMinutes,
    TicketAgentDto? Agent);

public sealed record CreateTicketRequest(
    [property: Required, StringLength(200, MinimumLength = 3)] string Title,
    [property: StringLength(20000)] string? Description,
    string? Type, string? Priority, int? QueueId, int? AgentId,
    [property: StringLength(200)] string? RequesterName,
    [property: StringLength(256), EmailAddress] string? RequesterEmail,
    Guid? AssignedToId);

public sealed record UpdateTicketRequest(
    [property: StringLength(200, MinimumLength = 3)] string? Title,
    [property: StringLength(20000)] string? Description,
    string? Type, string? Priority, int? QueueId);

public sealed record StatusRequest([property: Required] string Status, [property: StringLength(20000)] string? Message);

public sealed record AssignRequest(Guid? UserId);

public sealed record MessageRequest([property: Required, StringLength(20000, MinimumLength = 1)] string Body, bool Internal);

public sealed record TimeEntryRequest([property: Range(1, 1440)] int Minutes, [property: StringLength(1000)] string? Description, DateOnly? WorkDate);

public sealed record QueueRequest([property: Required, StringLength(100, MinimumLength = 2)] string Name, [property: StringLength(500)] string? Description,
    bool IsDefault);

public sealed record SlaRuleDto(string Priority, [property: Range(1, 525600)] int FirstResponseMinutes, [property: Range(1, 525600)] int ResolutionMinutes);

public sealed record IncidentSettingsDto(bool Enabled, List<string> Severities, string Priority, int? QueueId, bool ResolveWithAlert);

public static class TicketEndpoints
{
    private sealed class Row
    {
        public required Ticket T { get; init; }
        public required string QueueName { get; init; }
        public string? Hostname { get; init; }
        public string? ClientName { get; init; }
        public string? SiteName { get; init; }
        public string? AssignedName { get; init; }
        public string? CreatedByName { get; init; }
    }

    public static void MapTicketEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.TicketsView);
        var manage = Policies.Permission(Permissions.TicketsManage);
        var settings = Policies.Permission(Permissions.SettingsManage);
        var tickets = app.MapGroup("/api/tickets").WithTags("Chamados");

        tickets.MapGet("/", ListAsync).RequireAuthorization(view);
        tickets.MapGet("/summary", SummaryAsync).RequireAuthorization(view);
        tickets.MapGet("/assignees", AssigneesAsync).RequireAuthorization(view);
        tickets.MapGet("/sla", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await SlaAsync(db, ct))).RequireAuthorization(view);
        tickets.MapPut("/sla", SaveSlaAsync).RequireAuthorization(settings);
        tickets.MapGet("/incident-settings", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(ToDto(await SettingsStore.GetAsync(db, ct))))
            .RequireAuthorization(view);
        tickets.MapPut("/incident-settings", SaveIncidentSettingsAsync).RequireAuthorization(settings);
        tickets.MapGet("/{id:int}", GetAsync).RequireAuthorization(view);
        tickets.MapPost("/", CreateAsync).RequireAuthorization(manage);
        tickets.MapPatch("/{id:int}", UpdateAsync).RequireAuthorization(manage);
        tickets.MapPut("/{id:int}/status", StatusAsync).RequireAuthorization(manage);
        tickets.MapPut("/{id:int}/assign", AssignAsync).RequireAuthorization(manage);
        tickets.MapGet("/{id:int}/messages", async (int id, CybereyesDbContext db, TicketService svc, CancellationToken ct) =>
            await db.Tickets.AnyAsync(t => t.Id == id, ct) ? Results.Ok(await svc.MessagesAsync(id, true, ct)) : Problems.NotFound("Chamado"))
            .RequireAuthorization(view);
        tickets.MapPost("/{id:int}/messages", MessageAsync).RequireAuthorization(manage);
        tickets.MapGet("/{id:int}/attachments", async (int id, CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(
            (await db.TicketAttachments.AsNoTracking().Where(a => a.TicketId == id).OrderBy(a => a.Id).ToListAsync(ct)).Select(Attachments.ToDto)))
            .RequireAuthorization(view);
        tickets.MapPost("/{id:int}/attachments", UploadAsync).RequireAuthorization(manage).DisableAntiforgery();
        tickets.MapGet("/{id:int}/attachments/{attachmentId:long}", async (int id, long attachmentId, CybereyesDbContext db, CancellationToken ct) =>
            await db.TicketAttachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == attachmentId && a.TicketId == id, ct) is { } a
                ? await Attachments.DownloadAsync(db, a, ct)
                : Problems.NotFound("Anexo")).RequireAuthorization(view);
        tickets.MapGet("/{id:int}/time", TimeListAsync).RequireAuthorization(view);
        tickets.MapPost("/{id:int}/time", TimeAddAsync).RequireAuthorization(manage);
        tickets.MapDelete("/{id:int}/time/{entryId:long}", TimeDeleteAsync).RequireAuthorization(manage);

        app.MapGet("/api/agents/{id:int}/tickets", async (int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct) =>
        {
            var rows = await Rows(db).Where(r => r.T.AgentId == id).OrderByDescending(r => r.T.CreatedAt).Take(50).ToListAsync(ct);
            var now = time.GetUtcNow();
            return TypedResults.Ok(rows.Select(r => ToItem(r, now)));
        }).WithTags("Chamados").RequireAuthorization(view);

        var queues = app.MapGroup("/api/ticket-queues").WithTags("Chamados");
        queues.MapGet("/", async (CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await db.TicketQueues.AsNoTracking().OrderBy(q => q.Name)
            .Select(q => new
            {
                q.Id, q.Name, q.Description, q.IsDefault,
                OpenCount = db.Tickets.Count(t => t.QueueId == q.Id && TicketStatus.Open.Contains(t.Status)),
            }).ToListAsync(ct))).RequireAuthorization(view);
        queues.MapPost("/", (QueueRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveQueueAsync(null, r, db, audit, ct))
            .RequireAuthorization(settings);
        queues.MapPut("/{id:int}", (int id, QueueRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct) => SaveQueueAsync(id, r, db, audit, ct))
            .RequireAuthorization(settings);
        queues.MapDelete("/{id:int}", DeleteQueueAsync).RequireAuthorization(settings);
    }

    private static IQueryable<Row> Rows(CybereyesDbContext db) =>
        from t in db.Tickets.AsNoTracking()
        join q in db.TicketQueues on t.QueueId equals q.Id
        join a in db.Agents on t.AgentId equals a.Id into ag
        from a in ag.DefaultIfEmpty()
        join c in db.Clients on t.ClientId equals c.Id into cg
        from c in cg.DefaultIfEmpty()
        join s in db.Sites on t.SiteId equals s.Id into sg
        from s in sg.DefaultIfEmpty()
        join u in db.Users on t.AssignedToId equals u.Id into ug
        from u in ug.DefaultIfEmpty()
        join cb in db.Users on t.CreatedById equals cb.Id into cbg
        from cb in cbg.DefaultIfEmpty()
        select new Row
        {
            T = t, QueueName = q.Name, Hostname = a.Hostname, ClientName = c.Name, SiteName = s.Name,
            AssignedName = u == null ? null : (u.FullName != "" ? u.FullName : u.UserName),
            CreatedByName = cb == null ? null : (cb.FullName != "" ? cb.FullName : cb.UserName),
        };

    public static bool Breached(Ticket t, DateTimeOffset now) =>
        (t.FirstResponseAt == null && t.ResolvedAt == null && t.FirstResponseDueAt < now) || (t.ResolvedAt == null && t.ResolutionDueAt < now);

    private static TicketListItem ToItem(Row r, DateTimeOffset now)
    {
        var t = r.T;
        return new TicketListItem(t.Id, t.Type, t.Title, t.Status, t.Priority, t.QueueId, r.QueueName, t.AgentId, r.Hostname, r.ClientName, r.SiteName,
            t.RequesterName, t.AssignedToId, r.AssignedName, t.Source, t.CreatedAt, t.UpdatedAt, t.FirstResponseDueAt, t.ResolutionDueAt,
            Breached(t, now), t.LastMessageAuthor == MessageAuthor.Requester);
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct,
        string? status = null, string? priority = null, string? type = null, int? queueId = null, string? assigned = null, int? agentId = null,
        string? search = null, bool open = false, int page = 1, int pageSize = 25)
    {
        var size = Math.Clamp(pageSize, 1, 200);
        var p = Math.Max(page, 1);
        var now = time.GetUtcNow();
        var query = Rows(db);
        if (open)
        {
            query = query.Where(r => TicketStatus.Open.Contains(r.T.Status));
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(r => r.T.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(priority))
        {
            query = query.Where(r => r.T.Priority == priority);
        }
        if (!string.IsNullOrWhiteSpace(type))
        {
            query = query.Where(r => r.T.Type == type);
        }
        if (queueId is not null)
        {
            query = query.Where(r => r.T.QueueId == queueId);
        }
        if (agentId is not null)
        {
            query = query.Where(r => r.T.AgentId == agentId);
        }
        switch (assigned)
        {
            case "me":
                var me = principal.UserId();
                query = query.Where(r => r.T.AssignedToId == me);
                break;
            case "unassigned":
                query = query.Where(r => r.T.AssignedToId == null);
                break;
            case { Length: > 0 } when Guid.TryParse(assigned, out var userId):
                query = query.Where(r => r.T.AssignedToId == userId);
                break;
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            var number = int.TryParse(search.Trim().TrimStart('#'), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : -1;
            query = query.Where(r => r.T.Id == number || EF.Functions.ILike(r.T.Title, term) || EF.Functions.ILike(r.T.RequesterName, term) ||
                (r.Hostname != null && EF.Functions.ILike(r.Hostname, term)));
        }

        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(r => r.T.UpdatedAt).ThenByDescending(r => r.T.Id).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        return TypedResults.Ok(new Paged<TicketListItem>(rows.Select(r => ToItem(r, now)).ToList(), total, p, size));
    }

    private static async Task<IResult> SummaryAsync(ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var me = principal.UserId();
        var byStatus = await db.Tickets.GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var open = db.Tickets.Where(t => TicketStatus.Open.Contains(t.Status));
        return TypedResults.Ok(new
        {
            open = await open.CountAsync(ct),
            unassigned = await open.CountAsync(t => t.AssignedToId == null, ct),
            mine = await open.CountAsync(t => t.AssignedToId == me, ct),
            breached = await open.CountAsync(t => (t.FirstResponseAt == null && t.FirstResponseDueAt < now) || t.ResolutionDueAt < now, ct),
            byStatus = TicketStatus.All.ToDictionary(s => s, s => byStatus.GetValueOrDefault(s)),
        });
    }

    private static async Task<List<(Guid Id, string Name)>> AssigneeListAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var rows = await (
            from u in db.Users.AsNoTracking()
            where u.IsActive
            join ur in db.UserRoles.AsNoTracking() on u.Id equals ur.UserId
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            select new { u.Id, u.FullName, u.UserName, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        return rows.Where(r => r.IsSuperuser || r.Permissions.Contains(Permissions.TicketsManage))
            .GroupBy(r => r.Id).Select(g => (g.Key, string.IsNullOrEmpty(g.First().FullName) ? g.First().UserName! : g.First().FullName))
            .OrderBy(x => x.Item2, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private static async Task<IResult> AssigneesAsync(CybereyesDbContext db, CancellationToken ct) =>
        TypedResults.Ok((await AssigneeListAsync(db, ct)).Select(x => new { id = x.Id, name = x.Name }));

    private static async Task<IResult> GetAsync(int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct) =>
        await DetailAsync(id, db, time, ct) is { } detail ? TypedResults.Ok(detail) : Problems.NotFound("Chamado");

    private static async Task<TicketDetail?> DetailAsync(int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var row = await Rows(db).FirstOrDefaultAsync(r => r.T.Id == id, ct);
        if (row is null)
        {
            return null;
        }
        var t = row.T;
        var minutes = await db.TimeEntries.Where(e => e.TicketId == id).SumAsync(e => (int?)e.Minutes, ct) ?? 0;
        var agent = t.AgentId is { } agentId
            ? await db.Agents.AsNoTracking().Where(a => a.Id == agentId)
                .Select(a => new TicketAgentDto(a.Id, a.Hostname, a.Status, a.Plat, a.OperatingSystem, a.LoggedInUsername, a.PublicIp, a.MeshNodeId))
                .FirstOrDefaultAsync(ct)
            : null;
        var item = ToItem(row, time.GetUtcNow());
        return new TicketDetail(item.Id, item.Type, item.Title, item.Status, item.Priority, item.QueueId, item.QueueName, item.AgentId, item.Hostname,
            item.ClientName, item.SiteName, item.RequesterName, item.AssignedToId, item.AssignedToName, item.Source, item.CreatedAt, item.UpdatedAt,
            item.FirstResponseDueAt, item.ResolutionDueAt, item.SlaBreached, item.UnreadForTechnician, t.Description, t.RequesterUsername,
            t.RequesterEmail, t.AlertId, row.CreatedByName, t.FirstResponseAt, t.ResolvedAt, t.ClosedAt, minutes, agent);
    }

    public static async Task<string> ActorNameAsync(ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var id = principal.UserId();
        var name = id is null ? null : await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(name) ? principal.Identity?.Name ?? "?" : name;
    }

    private static IResult? ValidateEnums(string? type, string? priority)
    {
        if (type is not null && !TicketType.All.Contains(type))
        {
            return Problems.Validation("type", "Tipo invalido");
        }
        if (priority is not null && !TicketPriority.All.Contains(priority))
        {
            return Problems.Validation("priority", "Prioridade invalida");
        }
        return null;
    }

    private static async Task<IResult> CreateAsync(CreateTicketRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (ValidateEnums(r.Type, r.Priority) is { } invalid)
        {
            return invalid;
        }
        if (r.QueueId is { } queueId && !await db.TicketQueues.AnyAsync(q => q.Id == queueId, ct))
        {
            return Problems.Validation("queueId", "Fila inexistente");
        }
        string? requester = r.RequesterName;
        if (r.AgentId is { } agentId)
        {
            var agent = await db.Agents.AsNoTracking().Where(a => a.Id == agentId).Select(a => new { a.Hostname }).FirstOrDefaultAsync(ct);
            if (agent is null)
            {
                return Problems.Validation("agentId", "Agente inexistente");
            }
        }
        if (r.AssignedToId is { } assignee && (await AssigneeListAsync(db, ct)).All(a => a.Id != assignee))
        {
            return Problems.Validation("assignedToId", "O usuario nao pode receber chamados");
        }

        var actor = await ActorNameAsync(principal, db, ct);
        var ticket = await svc.CreateAsync(new NewTicket(r.Title, r.Description ?? string.Empty, r.Type ?? TicketType.Request, r.Priority ?? TicketPriority.Medium,
            r.QueueId, r.AgentId, string.IsNullOrWhiteSpace(requester) ? actor : requester.Trim(), null, r.RequesterEmail, r.AssignedToId, null,
            TicketSource.Console, principal.UserId()), ct);
        await audit.LogAsync("ticket.create", "ticket", Id(ticket.Id), $"Chamado #{ticket.Id} criado: {ticket.Title}", cancellationToken: ct);
        return TypedResults.Created($"/api/tickets/{ticket.Id}", await DetailAsync(ticket.Id, db, time, ct));
    }

    private static async Task<IResult> UpdateAsync(int id, UpdateTicketRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (ValidateEnums(r.Type, r.Priority) is { } invalid)
        {
            return invalid;
        }
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        if (r.QueueId is { } queueId)
        {
            if (!await db.TicketQueues.AnyAsync(q => q.Id == queueId, ct))
            {
                return Problems.Validation("queueId", "Fila inexistente");
            }
            ticket.QueueId = queueId;
        }
        if (r.Title is { } title)
        {
            ticket.Title = title.Trim();
        }
        if (r.Description is { } description)
        {
            ticket.Description = description;
        }
        if (r.Type is { } type)
        {
            ticket.Type = type;
        }
        ticket.UpdatedAt = time.GetUtcNow();
        if (r.Priority is { } priority && priority != ticket.Priority)
        {
            await svc.ChangePriorityAsync(ticket, priority, await ActorNameAsync(principal, db, ct), ct);
        }
        else
        {
            await db.SaveChangesAsync(ct);
            await svc.TicketsChangedAsync(id, ct);
            await svc.NotifyTrayTicketAsync(ticket, ct);
        }
        await audit.LogAsync("ticket.update", "ticket", Id(id), $"Chamado #{id} alterado", cancellationToken: ct);
        return TypedResults.Ok(await DetailAsync(id, db, time, ct));
    }

    private static async Task<IResult> StatusAsync(int id, StatusRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (!TicketStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Status invalido");
        }
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        var actor = await ActorNameAsync(principal, db, ct);
        if (!string.IsNullOrWhiteSpace(r.Message))
        {
            await svc.AddMessageAsync(ticket, MessageAuthor.Technician, principal.UserId(), actor, r.Message.Trim(), false, ct);
        }
        await svc.ChangeStatusAsync(ticket, r.Status, actor, ct);
        await audit.LogAsync("ticket.status", "ticket", Id(id), $"Chamado #{id}: status {r.Status}", cancellationToken: ct);
        return TypedResults.Ok(await DetailAsync(id, db, time, ct));
    }

    private static async Task<IResult> AssignAsync(int id, AssignRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        string? name = null;
        if (r.UserId is { } userId)
        {
            var match = (await AssigneeListAsync(db, ct)).FirstOrDefault(a => a.Id == userId);
            if (match.Name is null)
            {
                return Problems.BadRequest("O usuario nao pode receber chamados");
            }
            name = match.Name;
        }
        await svc.AssignAsync(ticket, r.UserId, name, await ActorNameAsync(principal, db, ct), ct);
        await audit.LogAsync("ticket.assign", "ticket", Id(id), $"Chamado #{id} atribuido a {name ?? "ninguem"}", cancellationToken: ct);
        return TypedResults.Ok(await DetailAsync(id, db, time, ct));
    }

    private static async Task<IResult> MessageAsync(int id, MessageRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, CancellationToken ct)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        var message = await svc.AddMessageAsync(ticket, MessageAuthor.Technician, principal.UserId(), await ActorNameAsync(principal, db, ct),
            r.Body.Trim(), r.Internal, ct);
        await audit.LogAsync(r.Internal ? "ticket.note" : "ticket.reply", "ticket", Id(id), $"Mensagem no chamado #{id}", cancellationToken: ct);
        return TypedResults.Created($"/api/tickets/{id}/messages/{message.Id}", message);
    }

    private static async Task<IResult> UploadAsync(int id, [FromForm] IFormFile? file, [FromForm] long? messageId, [FromForm] bool? @internal,
        ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc, IAuditService audit, CancellationToken ct)
    {
        if (!await db.Tickets.AnyAsync(t => t.Id == id, ct))
        {
            return Problems.NotFound("Chamado");
        }
        var isInternal = @internal ?? false;
        if (messageId is { } mid)
        {
            var message = await db.TicketMessages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == mid && m.TicketId == id, ct);
            if (message is null)
            {
                return Problems.Validation("messageId", "Mensagem inexistente neste chamado");
            }
            isInternal = message.Internal;
        }
        var (attachment, error) = await Attachments.StoreAsync(db, id, messageId, file, await ActorNameAsync(principal, db, ct), isInternal, false, ct);
        if (error is not null)
        {
            return error;
        }
        await audit.LogAsync("ticket.attachment", "ticket", Id(id), $"Anexo {attachment!.FileName} no chamado #{id}", cancellationToken: ct);
        await svc.TicketsChangedAsync(id, ct);
        return TypedResults.Created($"/api/tickets/{id}/attachments/{attachment.Id}", Attachments.ToDto(attachment));
    }

    private static async Task<IResult> TimeListAsync(int id, CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await (
        from e in db.TimeEntries.AsNoTracking()
        where e.TicketId == id
        join u in db.Users on e.UserId equals u.Id
        orderby e.WorkDate, e.Id
        select new { e.Id, e.UserId, UserName = u.FullName != "" ? u.FullName : u.UserName, e.Minutes, e.Description, e.WorkDate, e.CreatedAt })
        .ToListAsync(ct));

    private static async Task<IResult> TimeAddAsync(int id, TimeEntryRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (principal.UserId() is not { } userId)
        {
            return Problems.Forbidden("Somente usuarios podem apontar horas");
        }
        if (!await db.Tickets.AnyAsync(t => t.Id == id, ct))
        {
            return Problems.NotFound("Chamado");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        var zone = TimeZoneInfo.TryFindSystemTimeZoneById(settings.TimeZone, out var tz) ? tz : TimeZoneInfo.Utc;
        var entry = new TimeEntry
        {
            TicketId = id, UserId = userId, Minutes = r.Minutes, Description = r.Description?.Trim(),
            WorkDate = r.WorkDate ?? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), zone).DateTime), CreatedAt = time.GetUtcNow(),
        };
        db.TimeEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("ticket.time", "ticket", Id(id), $"{r.Minutes} min apontados no chamado #{id}", cancellationToken: ct);
        await svc.TicketsChangedAsync(id, ct);
        return TypedResults.Created($"/api/tickets/{id}/time/{entry.Id}", new { entry.Id, entry.UserId, entry.Minutes, entry.Description, entry.WorkDate, entry.CreatedAt });
    }

    private static async Task<IResult> TimeDeleteAsync(int id, long entryId, ClaimsPrincipal principal, CybereyesDbContext db, TicketService svc,
        IAuditService audit, CancellationToken ct)
    {
        var entry = await db.TimeEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.TicketId == id, ct);
        if (entry is null)
        {
            return Problems.NotFound("Apontamento");
        }
        if (entry.UserId != principal.UserId() && !principal.IsSuperuser())
        {
            return Problems.Forbidden("Somente o autor pode excluir o apontamento");
        }
        db.TimeEntries.Remove(entry);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("ticket.time-delete", "ticket", Id(id), $"Apontamento removido do chamado #{id}", cancellationToken: ct);
        await svc.TicketsChangedAsync(id, ct);
        return TypedResults.NoContent();
    }

    private static async Task<List<SlaRuleDto>> SlaAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var rules = await db.SlaRules.AsNoTracking().ToDictionaryAsync(r => r.Priority, ct);
        return SlaRule.Defaults().Select(d => rules.GetValueOrDefault(d.Priority) ?? d)
            .Select(r => new SlaRuleDto(r.Priority, r.FirstResponseMinutes, r.ResolutionMinutes)).ToList();
    }

    private static async Task<IResult> SaveSlaAsync(List<SlaRuleDto> rules, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (rules.Count != TicketPriority.All.Length || rules.Select(r => r.Priority).Distinct().Count() != rules.Count ||
            rules.Any(r => !TicketPriority.All.Contains(r.Priority)))
        {
            return Problems.BadRequest("Informe uma regra para cada prioridade (low, medium, high, critical)");
        }
        if (rules.Any(r => r.FirstResponseMinutes < 1 || r.ResolutionMinutes < r.FirstResponseMinutes))
        {
            return Problems.BadRequest("O prazo de solucao deve ser maior ou igual ao de primeira resposta");
        }
        var existing = await db.SlaRules.ToDictionaryAsync(r => r.Priority, ct);
        foreach (var r in rules)
        {
            if (existing.TryGetValue(r.Priority, out var rule))
            {
                rule.FirstResponseMinutes = r.FirstResponseMinutes;
                rule.ResolutionMinutes = r.ResolutionMinutes;
            }
            else
            {
                db.SlaRules.Add(new SlaRule { Priority = r.Priority, FirstResponseMinutes = r.FirstResponseMinutes, ResolutionMinutes = r.ResolutionMinutes });
            }
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("tickets.sla", "settings", null, "Regras de SLA alteradas", cancellationToken: ct);
        return TypedResults.Ok(await SlaAsync(db, ct));
    }

    private static IncidentSettingsDto ToDto(CoreSettings s) =>
        new(s.IncidentsEnabled, s.IncidentSeverities, s.IncidentPriority, s.IncidentQueueId, s.IncidentResolveWithAlert);

    private static async Task<IResult> SaveIncidentSettingsAsync(IncidentSettingsDto r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        if (r.Severities.Any(s => !Severity.All.Contains(s)))
        {
            return Problems.Validation("severities", "Severidade invalida");
        }
        if (!TicketPriority.All.Contains(r.Priority))
        {
            return Problems.Validation("priority", "Prioridade invalida");
        }
        if (r.QueueId is { } queueId && !await db.TicketQueues.AnyAsync(q => q.Id == queueId, ct))
        {
            return Problems.Validation("queueId", "Fila inexistente");
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        settings.IncidentsEnabled = r.Enabled;
        settings.IncidentSeverities = r.Severities.Distinct().ToList();
        settings.IncidentPriority = r.Priority;
        settings.IncidentQueueId = r.QueueId;
        settings.IncidentResolveWithAlert = r.ResolveWithAlert;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("tickets.incident-settings", "settings", null, "Regras de incidente alteradas", cancellationToken: ct);
        return TypedResults.Ok(ToDto(settings));
    }

    private static async Task<IResult> SaveQueueAsync(int? id, QueueRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var name = r.Name.Trim();
        if (await db.TicketQueues.AnyAsync(q => q.Name == name && q.Id != id, ct))
        {
            return Problems.Conflict("Ja existe uma fila com esse nome");
        }
        TicketQueue queue;
        if (id is null)
        {
            queue = new TicketQueue { Name = name };
            db.TicketQueues.Add(queue);
        }
        else
        {
            var found = await db.TicketQueues.FirstOrDefaultAsync(q => q.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Fila");
            }
            queue = found;
            queue.Name = name;
        }
        queue.Description = r.Description?.Trim();
        if (r.IsDefault && !queue.IsDefault)
        {
            await db.TicketQueues.Where(q => q.IsDefault).ExecuteUpdateAsync(s => s.SetProperty(q => q.IsDefault, false), ct);
            queue.IsDefault = true;
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "ticket-queue.create" : "ticket-queue.update", "ticket-queue", Id(queue.Id), $"Fila {queue.Name}", cancellationToken: ct);
        var result = new { queue.Id, queue.Name, queue.Description, queue.IsDefault, OpenCount = 0 };
        return id is null ? TypedResults.Created($"/api/ticket-queues/{queue.Id}", result) : TypedResults.Ok(result);
    }

    private static async Task<IResult> DeleteQueueAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var queue = await db.TicketQueues.FirstOrDefaultAsync(q => q.Id == id, ct);
        if (queue is null)
        {
            return Problems.NotFound("Fila");
        }
        if (queue.IsDefault || await db.Tickets.AnyAsync(t => t.QueueId == id, ct))
        {
            return Problems.Conflict("A fila padrao e filas com chamados nao podem ser excluidas");
        }
        db.TicketQueues.Remove(queue);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("ticket-queue.delete", "ticket-queue", Id(id), $"Fila {queue.Name} excluida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static string Id(long id) => id.ToString(CultureInfo.InvariantCulture);
}
