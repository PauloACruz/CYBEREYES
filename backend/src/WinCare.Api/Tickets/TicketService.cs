using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Rmm;
using WinCare.Core.Persistence;
using WinCare.Core.Tickets;

namespace WinCare.Api.Tickets;

public sealed record NewTicket(
    string Title, string Description, string Type, string Priority, int? QueueId, int? AgentId,
    string RequesterName, string? RequesterUsername, string? RequesterEmail, Guid? AssignedToId,
    long? AlertId, string Source, Guid? CreatedById);

public sealed record AttachmentDto(long Id, string FileName, string ContentType, long Size);

public sealed record MessageDto(long Id, int TicketId, string AuthorType, string AuthorName, string Body, bool Internal, DateTimeOffset CreatedAt,
    IReadOnlyList<AttachmentDto> Attachments);

public sealed record TrayMessageDto(long Id, string AuthorType, string AuthorName, string Body, DateTimeOffset CreatedAt, IReadOnlyList<AttachmentDto> Attachments);

public sealed record TrayTicketDto(int Id, string Title, string Status, string Priority, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    string? AssignedToName, bool ChatEnabled, DateTimeOffset? LastMessageAt);

/// <summary>Regras de negocio dos chamados: SLA, status, atribuicao, mensagens e avisos em tempo real.</summary>
public sealed class TicketService(WinCareDbContext db, IHubContext<ConsoleHub> console, IHubContext<TrayHub> tray, TimeProvider time)
{
    public static string ConsoleGroup(int ticketId) => $"ticket:{ticketId}";

    public static string TrayGroup(int agentId, string username) => $"tray:{agentId}:{username.ToLowerInvariant()}";

    public async Task<Ticket> CreateAsync(NewTicket request, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var queueId = request.QueueId ?? await DefaultQueueIdAsync(ct);
        var ticket = new Ticket
        {
            Title = request.Title.Trim(),
            Description = request.Description,
            Type = request.Type,
            Priority = request.Priority,
            QueueId = queueId,
            AgentId = request.AgentId,
            RequesterName = request.RequesterName,
            RequesterUsername = request.RequesterUsername?.ToLowerInvariant(),
            RequesterEmail = request.RequesterEmail,
            AssignedToId = request.AssignedToId,
            AlertId = request.AlertId,
            Source = request.Source,
            CreatedById = request.CreatedById,
            CreatedAt = now,
            UpdatedAt = now,
            Status = request.AssignedToId is null ? TicketStatus.New : TicketStatus.InProgress,
        };
        if (request.AgentId is { } agentId)
        {
            var place = await db.Agents.AsNoTracking().Where(a => a.Id == agentId)
                .Select(a => new { a.SiteId, a.Site!.ClientId }).FirstOrDefaultAsync(ct);
            ticket.SiteId = place?.SiteId;
            ticket.ClientId = place?.ClientId;
        }
        await ApplySlaAsync(ticket, ct);
        db.Tickets.Add(ticket);
        await db.SaveChangesAsync(ct);
        await TicketsChangedAsync(ticket.Id, ct);
        return ticket;
    }

    public async Task<int> DefaultQueueIdAsync(CancellationToken ct) =>
        await db.TicketQueues.Where(q => q.IsDefault).Select(q => (int?)q.Id).FirstOrDefaultAsync(ct)
        ?? await db.TicketQueues.OrderBy(q => q.Id).Select(q => q.Id).FirstAsync(ct);

    public async Task ApplySlaAsync(Ticket ticket, CancellationToken ct)
    {
        var rule = await db.SlaRules.AsNoTracking().FirstOrDefaultAsync(r => r.Priority == ticket.Priority, ct)
            ?? SlaRule.Defaults().First(r => r.Priority == ticket.Priority);
        ticket.FirstResponseDueAt = ticket.CreatedAt.AddMinutes(rule.FirstResponseMinutes);
        ticket.ResolutionDueAt = ticket.CreatedAt.AddMinutes(rule.ResolutionMinutes);
    }

    public async Task<MessageDto> AddMessageAsync(Ticket ticket, string authorType, Guid? authorUserId, string authorName, string body, bool isInternal,
        CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var message = new TicketMessage
        {
            TicketId = ticket.Id, AuthorType = authorType, AuthorUserId = authorUserId, AuthorName = authorName, Body = body,
            Internal = isInternal, CreatedAt = now,
        };
        db.TicketMessages.Add(message);
        ticket.UpdatedAt = now;
        var statusChanged = false;
        if (!isInternal && authorType != MessageAuthor.System)
        {
            ticket.LastMessageAt = now;
            ticket.LastMessageAuthor = authorType;
        }
        if (authorType == MessageAuthor.Technician && !isInternal && ticket.FirstResponseAt is null)
        {
            ticket.FirstResponseAt = now;
        }
        if (authorType == MessageAuthor.Requester && ticket.Status is TicketStatus.WaitingUser or TicketStatus.Resolved)
        {
            SetStatus(ticket, TicketStatus.InProgress, now);
            statusChanged = true;
        }
        await db.SaveChangesAsync(ct);

        var dto = new MessageDto(message.Id, ticket.Id, authorType, authorName, body, isInternal, now, []);
        await console.Clients.Group(ConsoleGroup(ticket.Id)).SendAsync("ticketMessage", ticket.Id, dto, ct);
        if (!isInternal)
        {
            await NotifyTrayMessageAsync(ticket, dto, ct);
        }
        await TicketsChangedAsync(ticket.Id, ct);
        if (statusChanged)
        {
            await NotifyTrayTicketAsync(ticket, ct);
        }
        return dto;
    }

    public Task<MessageDto> SystemMessageAsync(Ticket ticket, string body, CancellationToken ct) =>
        AddMessageAsync(ticket, MessageAuthor.System, null, "Sistema", body, false, ct);

    public async Task ChangeStatusAsync(Ticket ticket, string status, string actor, CancellationToken ct)
    {
        if (ticket.Status == status)
        {
            return;
        }
        SetStatus(ticket, status, time.GetUtcNow());
        await SystemMessageAsync(ticket, $"{actor} alterou o status para {StatusName(status)}", ct);
        await NotifyTrayTicketAsync(ticket, ct);
    }

    public async Task AssignAsync(Ticket ticket, Guid? userId, string? userName, string actor, CancellationToken ct)
    {
        if (ticket.AssignedToId == userId)
        {
            return;
        }
        ticket.AssignedToId = userId;
        if (userId is not null && ticket.Status == TicketStatus.New)
        {
            SetStatus(ticket, TicketStatus.InProgress, time.GetUtcNow());
        }
        await SystemMessageAsync(ticket, userId is null ? $"{actor} removeu o tecnico do chamado" : $"{actor} atribuiu o chamado a {userName}", ct);
        await NotifyTrayTicketAsync(ticket, ct);
    }

    public async Task ChangePriorityAsync(Ticket ticket, string priority, string actor, CancellationToken ct)
    {
        if (ticket.Priority == priority)
        {
            return;
        }
        ticket.Priority = priority;
        await ApplySlaAsync(ticket, ct);
        await SystemMessageAsync(ticket, $"{actor} alterou a prioridade para {PriorityName(priority)}", ct);
        await NotifyTrayTicketAsync(ticket, ct);
    }

    public async Task<TrayTicketDto> TrayTicketAsync(Ticket ticket, CancellationToken ct)
    {
        var assigned = ticket.AssignedToId is { } id
            ? await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.FullName == "" ? u.UserName : u.FullName).FirstOrDefaultAsync(ct)
            : null;
        return ToTray(ticket, assigned);
    }

    public static TrayTicketDto ToTray(Ticket t, string? assignedToName) =>
        new(t.Id, t.Title, t.Status, t.Priority, t.CreatedAt, t.UpdatedAt, assignedToName,
            t.AssignedToId is not null && t.Status != TicketStatus.Closed, t.LastMessageAt);

    public Task TicketsChangedAsync(int ticketId, CancellationToken ct) =>
        console.Clients.All.SendAsync("ticketsChanged", new { ticketId }, ct);

    public async Task NotifyTrayTicketAsync(Ticket ticket, CancellationToken ct)
    {
        if (ticket.AgentId is { } agentId && ticket.RequesterUsername is { Length: > 0 } user)
        {
            await tray.Clients.Group(TrayGroup(agentId, user)).SendAsync("ticketChanged", await TrayTicketAsync(ticket, ct), ct);
        }
    }

    public async Task NotifyTrayMessageAsync(Ticket ticket, MessageDto message, CancellationToken ct)
    {
        if (ticket.AgentId is { } agentId && ticket.RequesterUsername is { Length: > 0 } user)
        {
            var dto = new TrayMessageDto(message.Id, message.AuthorType, message.AuthorName, message.Body, message.CreatedAt, message.Attachments);
            await tray.Clients.Group(TrayGroup(agentId, user)).SendAsync("ticketMessage", ticket.Id, dto, ct);
        }
    }

    public async Task<IReadOnlyList<MessageDto>> MessagesAsync(int ticketId, bool includeInternal, CancellationToken ct)
    {
        var messages = await db.TicketMessages.AsNoTracking().Where(m => m.TicketId == ticketId && (includeInternal || !m.Internal))
            .OrderBy(m => m.CreatedAt).ThenBy(m => m.Id).ToListAsync(ct);
        var attachments = (await db.TicketAttachments.AsNoTracking().Where(a => a.TicketId == ticketId && a.MessageId != null && (includeInternal || !a.Internal))
            .ToListAsync(ct)).ToLookup(a => a.MessageId);
        return messages.Select(m => new MessageDto(m.Id, m.TicketId, m.AuthorType, m.AuthorName, m.Body, m.Internal, m.CreatedAt,
            attachments[m.Id].Select(a => new AttachmentDto(a.Id, a.FileName, a.ContentType, a.Size)).ToList())).ToList();
    }

    private static void SetStatus(Ticket ticket, string status, DateTimeOffset now)
    {
        ticket.Status = status;
        ticket.UpdatedAt = now;
        switch (status)
        {
            case TicketStatus.Resolved:
                ticket.ResolvedAt = now;
                ticket.ClosedAt = null;
                break;
            case TicketStatus.Closed:
                ticket.ResolvedAt ??= now;
                ticket.ClosedAt = now;
                break;
            default:
                ticket.ResolvedAt = null;
                ticket.ClosedAt = null;
                break;
        }
    }

    public static string StatusName(string status) => status switch
    {
        TicketStatus.New => "Novo",
        TicketStatus.InProgress => "Em atendimento",
        TicketStatus.WaitingUser => "Aguardando usuario",
        TicketStatus.Resolved => "Resolvido",
        TicketStatus.Closed => "Fechado",
        _ => status,
    };

    public static string PriorityName(string priority) => priority switch
    {
        TicketPriority.Low => "Baixa",
        TicketPriority.Medium => "Media",
        TicketPriority.High => "Alta",
        TicketPriority.Critical => "Critica",
        _ => priority,
    };
}
