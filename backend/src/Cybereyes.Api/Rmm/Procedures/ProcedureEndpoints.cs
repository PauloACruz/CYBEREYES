using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Rmm.Procedures;

public sealed record ProcedureDto(
    long Id, int? AgentId, string Hostname, int ClientId, string ClientName, string Kind, string Title, string? Detail, string Status, string Source,
    Guid? UserId, string UserName, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, int? DurationSeconds, int? TicketId, string? TicketTitle,
    long? TimeEntryId, int? ServiceMinutes);

/// <summary>Totais do filtro inteiro (nao so da pagina): quantidade, tempo de execucao e o que ja entrou em chamado.</summary>
public sealed record ProcedureTotals(int Count, long Seconds, int InTickets, int ServiceMinutes, int Unlinked);

public sealed record ProcedurePage(IReadOnlyList<ProcedureDto> Items, int Total, int Page, int PageSize, ProcedureTotals Totals);

public sealed record IncludeProcedureItem(long ProcedureId, [property: Range(1, ProcedureLog.MaxMinutes)] int? Minutes);

public sealed record IncludeProceduresRequest([property: Required, MinLength(1), MaxLength(100)] IReadOnlyList<IncludeProcedureItem> Items);

public sealed record ProceduresTicketRequest(
    [property: Required, MinLength(1), MaxLength(100)] IReadOnlyList<long> ProcedureIds,
    [property: Required, StringLength(200, MinimumLength = 3)] string Title,
    [property: StringLength(20000)] string? Description,
    string? Type, string? Priority, bool Resolve);

/// <summary>Procedimentos feitos nos agentes: consulta com totais, inclusao em chamado e chamado criado a partir deles.</summary>
public static class ProcedureEndpoints
{
    public static void MapProcedureEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var ticketsView = Policies.Permission(Permissions.TicketsView);
        var ticketsManage = Policies.Permission(Permissions.TicketsManage);

        var procedures = app.MapGroup("/api/procedures").WithTags("Procedimentos");
        procedures.MapGet("/", ListAsync).RequireAuthorization(view);
        procedures.MapPost("/ticket", CreateTicketAsync).RequireAuthorization(view).RequireAuthorization(ticketsManage);

        var tickets = app.MapGroup("/api/tickets/{id:int}/procedures").WithTags("Procedimentos");
        tickets.MapGet("/", TicketListAsync).RequireAuthorization(ticketsView);
        tickets.MapPost("/", IncludeAsync).RequireAuthorization(view).RequireAuthorization(ticketsManage);
        tickets.MapDelete("/{procedureId:long}", RemoveAsync).RequireAuthorization(ticketsManage);
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, int? agentId, int? clientId, Guid? userId, string? kind, string? status,
        int? ticketId, bool? linked, DateOnly? from, DateOnly? to, int? page, int? pageSize, CancellationToken ct)
    {
        if (kind is not null && !ProcedureKind.All.Contains(kind))
        {
            return Problems.Validation("kind", "Tipo de procedimento invalido");
        }
        if (status is not null && !ProcedureStatus.All.Contains(status))
        {
            return Problems.Validation("status", "Situacao invalida");
        }
        if (from is { } f && to is { } t && t < f)
        {
            return Problems.Validation("to", "A data final e anterior a inicial");
        }
        var (p, size) = Paging.Normalize(page, pageSize, 50);
        var query = db.AgentProcedures.AsNoTracking();
        query = agentId is { } a ? query.Where(x => x.AgentId == a) : query;
        query = clientId is { } c ? query.Where(x => x.ClientId == c) : query;
        query = userId is { } u ? query.Where(x => x.UserId == u) : query;
        query = kind is not null ? query.Where(x => x.Kind == kind) : query;
        query = status is not null ? query.Where(x => x.Status == status) : query;
        query = ticketId is { } tk ? query.Where(x => x.TicketId == tk) : query;
        query = linked switch
        {
            true => query.Where(x => x.TicketId != null),
            false => query.Where(x => x.TicketId == null),
            null => query,
        };
        if (from is not null || to is not null)
        {
            var zone = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
            if (from is { } start)
            {
                var since = LocalStart(start, zone);
                query = query.Where(x => x.StartedAt >= since);
            }
            if (to is { } end)
            {
                var until = LocalStart(end.AddDays(1), zone);
                query = query.Where(x => x.StartedAt < until);
            }
        }

        var count = await query.CountAsync(ct);
        var inTickets = await query.CountAsync(x => x.TicketId != null, ct);
        var totals = new ProcedureTotals(count,
            await query.SumAsync(x => (long?)x.DurationSeconds, ct) ?? 0,
            inTickets,
            await (from x in query join e in db.TimeEntries on x.TimeEntryId equals e.Id select (int?)e.Minutes).SumAsync(ct) ?? 0,
            count - inTickets);
        var items = await Project(db, query.OrderByDescending(x => x.StartedAt).ThenByDescending(x => x.Id).Skip((p - 1) * size).Take(size))
            .ToListAsync(ct);
        return TypedResults.Ok(new ProcedurePage(items, totals.Count, p, size, totals));
    }

    private static async Task<IResult> TicketListAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        if (!await db.Tickets.AnyAsync(t => t.Id == id, ct))
        {
            return Problems.NotFound("Chamado");
        }
        var items = await Project(db, db.AgentProcedures.AsNoTracking().Where(x => x.TicketId == id).OrderBy(x => x.StartedAt).ThenBy(x => x.Id))
            .ToListAsync(ct);
        return TypedResults.Ok(items);
    }

    private static async Task<IResult> IncludeAsync(int id, IncludeProceduresRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        ProcedureLog log, TicketService tickets, IAuditService audit, CancellationToken ct)
    {
        if (principal.UserId() is not { } userId)
        {
            return Problems.Forbidden("Somente usuarios podem incluir procedimentos");
        }
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null)
        {
            return Problems.NotFound("Chamado");
        }
        var ids = request.Items.Select(i => i.ProcedureId).Distinct().ToList();
        var found = await db.AgentProcedures.Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        if (Validate(ids, found, ticket.ClientId, ticket.Id) is { } invalid)
        {
            return invalid;
        }
        foreach (var item in request.Items.DistinctBy(i => i.ProcedureId))
        {
            var procedure = found[item.ProcedureId];
            await log.IncludeAsync(procedure, ticket, item.Minutes ?? ProcedureLog.DefaultMinutes(procedure), null, userId, ct);
        }
        await audit.LogAsync("ticket.procedures", "ticket", Id(id),
            $"{ids.Count} procedimento(s) incluido(s) no chamado #{id}: {string.Join(", ", ids)}", cancellationToken: ct);
        await tickets.TicketsChangedAsync(id, ct);
        var items = await Project(db, db.AgentProcedures.AsNoTracking().Where(x => ids.Contains(x.Id)).OrderBy(x => x.StartedAt)).ToListAsync(ct);
        return TypedResults.Ok(items);
    }

    private static async Task<IResult> RemoveAsync(int id, long procedureId, ClaimsPrincipal principal, CybereyesDbContext db, TicketService tickets,
        IAuditService audit, CancellationToken ct)
    {
        var procedure = await db.AgentProcedures.FirstOrDefaultAsync(x => x.Id == procedureId && x.TicketId == id, ct);
        if (procedure is null)
        {
            return Problems.NotFound("Procedimento");
        }
        var entry = procedure.TimeEntryId is { } entryId ? await db.TimeEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct) : null;
        // Mesma regra do apontamento: so quem tem o apontamento (ou o superusuario) tira o tempo do chamado.
        if (entry is not null && entry.UserId != principal.UserId() && !principal.IsSuperuser())
        {
            return Problems.Forbidden("Somente o autor do apontamento pode remover o procedimento do chamado");
        }
        procedure.TicketId = null;
        procedure.TimeEntryId = null;
        if (entry is not null)
        {
            db.TimeEntries.Remove(entry);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("ticket.procedure-remove", "ticket", Id(id), $"Procedimento {procedureId} removido do chamado #{id}", cancellationToken: ct);
        await tickets.TicketsChangedAsync(id, ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Atendimento feito sem chamado (um acesso remoto, uma manutencao): cria o chamado ja com os procedimentos e o tempo deles,
    /// atribuido a quem registra e, se pedido, ja resolvido.
    /// </summary>
    private static async Task<IResult> CreateTicketAsync(ProceduresTicketRequest request, ClaimsPrincipal principal, CybereyesDbContext db, ProcedureLog log,
        TicketService tickets, IAuditService audit, CancellationToken ct)
    {
        if (principal.UserId() is not { } userId)
        {
            return Problems.Forbidden("Somente usuarios podem registrar chamados");
        }
        if (request.Type is not null && !TicketType.All.Contains(request.Type))
        {
            return Problems.Validation("type", "Tipo invalido");
        }
        if (request.Priority is not null && !TicketPriority.All.Contains(request.Priority))
        {
            return Problems.Validation("priority", "Prioridade invalida");
        }
        var ids = request.ProcedureIds.Distinct().ToList();
        var found = await db.AgentProcedures.Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        if (Validate(ids, found, null, null) is { } invalid)
        {
            return invalid;
        }
        var procedures = found.Values.OrderBy(x => x.StartedAt).ToList();
        if (procedures.Select(x => x.ClientId).Distinct().Count() > 1)
        {
            return Problems.Validation("procedureIds", "Os procedimentos sao de clientes diferentes");
        }
        // Uma maquina so: o chamado fica nela. Varias maquinas do mesmo cliente: chamado do cliente, sem maquina.
        var agentIds = procedures.Select(x => x.AgentId).Distinct().ToList();
        var agentId = agentIds is [{ } single] ? single : (int?)null;
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        var ticket = await tickets.CreateAsync(new NewTicket(request.Title, request.Description ?? string.Empty, request.Type ?? TicketType.Request,
            request.Priority ?? TicketPriority.Low, null, agentId, actor, null, null, userId, null, TicketSource.Console, userId), ct);
        if (agentId is null)
        {
            ticket.ClientId = procedures[0].ClientId;
            await db.SaveChangesAsync(ct);
        }
        foreach (var procedure in procedures)
        {
            await log.IncludeAsync(procedure, ticket, ProcedureLog.DefaultMinutes(procedure), null, userId, ct);
        }
        if (request.Resolve)
        {
            await tickets.ChangeStatusAsync(ticket, TicketStatus.Resolved, actor, ct);
            await db.SaveChangesAsync(ct);
        }
        await audit.LogAsync("ticket.create", "ticket", Id(ticket.Id),
            $"Chamado #{ticket.Id} criado a partir de {procedures.Count} procedimento(s): {ticket.Title}", cancellationToken: ct);
        await tickets.TicketsChangedAsync(ticket.Id, ct);
        return TypedResults.Created($"/api/tickets/{ticket.Id}", new { id = ticket.Id });
    }

    /// <summary>Todos existem, ja terminaram, nao estao em outro chamado e (com chamado de cliente) sao do mesmo cliente.</summary>
    private static IResult? Validate(List<long> ids, Dictionary<long, AgentProcedure> found, int? ticketClientId, int? ticketId)
    {
        if (ids.FirstOrDefault(i => !found.ContainsKey(i)) is var missing && missing != 0)
        {
            return Problems.NotFound($"Procedimento {missing}");
        }
        if (found.Values.FirstOrDefault(x => x.Status == ProcedureStatus.Running) is { } running)
        {
            return Problems.Validation("procedureIds", $"O procedimento {running.Id} ainda esta em andamento");
        }
        if (found.Values.FirstOrDefault(x => x.TicketId is not null && x.TicketId != ticketId) is { } other)
        {
            return Problems.Conflict($"O procedimento {other.Id} ja esta no chamado #{other.TicketId}");
        }
        if (found.Values.FirstOrDefault(x => x.TicketId == ticketId && ticketId is not null) is { } same)
        {
            return Problems.Conflict($"O procedimento {same.Id} ja esta neste chamado");
        }
        if (ticketClientId is { } client && found.Values.FirstOrDefault(x => x.ClientId != client) is { } foreign)
        {
            return Problems.Validation("procedureIds", $"O procedimento {foreign.Id} e de outro cliente");
        }
        return null;
    }

    private static IQueryable<ProcedureDto> Project(CybereyesDbContext db, IQueryable<AgentProcedure> query) =>
        from x in query
        join cl in db.Clients on x.ClientId equals cl.Id
        join tk in db.Tickets on x.TicketId equals tk.Id into tks
        from tk in tks.DefaultIfEmpty()
        join te in db.TimeEntries on x.TimeEntryId equals te.Id into tes
        from te in tes.DefaultIfEmpty()
        select new ProcedureDto(x.Id, x.AgentId, x.Hostname, x.ClientId, cl.Name, x.Kind, x.Title, x.Detail, x.Status, x.Source, x.UserId, x.UserName,
            x.StartedAt, x.FinishedAt, x.DurationSeconds, x.TicketId, tk == null ? null : tk.Title, x.TimeEntryId, te == null ? null : te.Minutes);

    private static DateTimeOffset LocalStart(DateOnly date, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
}
