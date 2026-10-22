using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tickets;

public sealed record RotationMemberDto(Guid UserId, string Name, bool Active, IReadOnlyList<int> QueueIds, DateTimeOffset? LastAssignedAt, int OpenTickets);

public sealed record RotationOptionDto(string Id, string Name);

/// <summary>Fila de atendimento com quem pode entrar nela (<see cref="Candidates"/>) e as filas de chamados, para a tela nao depender das permissoes de chamados.</summary>
public sealed record RotationDto(bool Enabled, Guid? NextUserId, IReadOnlyList<RotationMemberDto> Members, IReadOnlyList<RotationOptionDto> Candidates,
    IReadOnlyList<RotationOptionDto> Queues);

public sealed record RotationMemberRequest(Guid UserId, bool Active = true, IReadOnlyList<int>? QueueIds = null);

public sealed record SaveRotationRequest(bool Enabled, IReadOnlyList<RotationMemberRequest> Members);

/// <summary>Tecnico escolhido pelo rodizio e o nome com que o agente assina a atribuicao.</summary>
public sealed record RotationPick(Guid UserId, string UserName, string Actor);

/// <summary>Quem pode receber chamados: usuario ativo com <c>tickets.manage</c> ou superusuario.</summary>
public sealed record TicketAssignee(Guid Id, string Name);

/// <summary>
/// Fila de atendimento: o chamado aberto sem tecnico vai para o tecnico da fila que esta ha mais tempo sem receber um, entre os
/// ativos que atendem a fila do chamado e veem o cliente dele. Empate (ninguem recebeu ainda) vai pela ordem da lista.
/// </summary>
public sealed class TicketRotation(CybereyesDbContext db)
{
    public static async Task<List<TicketAssignee>> AssigneesAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var rows = await (
            from u in db.Users.AsNoTracking()
            where u.IsActive
            join ur in db.UserRoles.AsNoTracking() on u.Id equals ur.UserId
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            select new { u.Id, u.FullName, u.UserName, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        return rows.Where(r => r.IsSuperuser || r.Permissions.Contains(Permissions.TicketsManage))
            .GroupBy(r => r.Id)
            .Select(g => new TicketAssignee(g.Key, string.IsNullOrEmpty(g.First().FullName) ? g.First().UserName! : g.First().FullName))
            .OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>Escolhe o tecnico da vez e marca a entrega; nulo com o rodizio desligado ou sem ninguem que possa atender.</summary>
    public async Task<RotationPick?> PickAsync(int queueId, int? clientId, DateTimeOffset now, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        if (!settings.TicketRotationEnabled || !await db.TicketRotationMembers.AnyAsync(m => m.Active, ct))
        {
            return null;
        }
        var assignees = (await AssigneesAsync(db, ct)).ToDictionary(a => a.Id);
        var scopes = clientId is null ? new Dictionary<Guid, IReadOnlySet<int>?>() : await ClientAccess.ScopesAsync(db, assignees.Keys.ToList(), ct);

        bool CanTake(TicketRotationMember m) =>
            assignees.ContainsKey(m.UserId)
            && (m.QueueIds.Count == 0 || m.QueueIds.Contains(queueId))
            // Mesma regra do filtro de chamados: sem cliente, o tecnico atribuido sempre ve o chamado.
            && (clientId is not { } id || (scopes.TryGetValue(m.UserId, out var scope) && scope.Sees(id)));

        var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            // As duas replicas da API abrem chamados ao mesmo tempo: a trava impede que entreguem ao mesmo tecnico da vez.
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('cybereyes-ticket-rotation'))", ct);
            var members = await db.TicketRotationMembers.Where(m => m.Active).ToListAsync(ct);
            var next = Order(members.Where(CanTake)).FirstOrDefault();
            if (next is null)
            {
                return null;
            }
            next.LastAssignedAt = now;
            await db.SaveChangesAsync(ct);
            if (own is not null)
            {
                await own.CommitAsync(ct);
            }
            return new RotationPick(next.UserId, assignees[next.UserId].Name, settings.AssistantName);
        }
        finally
        {
            if (own is not null)
            {
                await own.DisposeAsync();
            }
        }
    }

    /// <summary>Quem nunca recebeu vem primeiro, depois quem recebeu ha mais tempo; empate pela ordem da lista.</summary>
    public static IEnumerable<TicketRotationMember> Order(IEnumerable<TicketRotationMember> members) =>
        members.OrderBy(m => m.LastAssignedAt is null ? 0 : 1).ThenBy(m => m.LastAssignedAt).ThenBy(m => m.Position);
}

public static class TicketRotationEndpoints
{
    public static void MapTicketRotationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/ticket-rotation").WithTags("Chamados");
        group.MapGet("/", GetAsync).RequireAuthorization(Policies.Permission(Permissions.UsersView));
        group.MapPut("/", SaveAsync).RequireAuthorization(Policies.Permission(Permissions.UsersManage));
    }

    private static async Task<IResult> GetAsync(CybereyesDbContext db, CancellationToken ct) => TypedResults.Ok(await DtoAsync(db, ct));

    private static async Task<RotationDto> DtoAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        var members = await db.TicketRotationMembers.AsNoTracking().OrderBy(m => m.Position).ToListAsync(ct);
        var ids = members.Select(m => m.UserId).ToList();
        var names = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, Name = u.FullName == "" ? u.UserName! : u.FullName }).ToDictionaryAsync(u => u.Id, u => u.Name, ct);
        var open = await db.Tickets.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.AssignedToId != null && ids.Contains(t.AssignedToId.Value) && TicketStatus.Open.Contains(t.Status))
            .GroupBy(t => t.AssignedToId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var assignees = await TicketRotation.AssigneesAsync(db, ct);
        var allowed = assignees.Select(a => a.Id).ToHashSet();
        var next = TicketRotation.Order(members.Where(m => m.Active && allowed.Contains(m.UserId))).FirstOrDefault();
        var queues = await db.TicketQueues.AsNoTracking().OrderBy(q => q.Name)
            .Select(q => new RotationOptionDto(q.Id.ToString(CultureInfo.InvariantCulture), q.Name)).ToListAsync(ct);
        return new RotationDto(settings.TicketRotationEnabled, next?.UserId,
            members.Select(m => new RotationMemberDto(m.UserId, names.GetValueOrDefault(m.UserId, "?"), m.Active, m.QueueIds, m.LastAssignedAt,
                open.GetValueOrDefault(m.UserId))).ToList(),
            assignees.Where(a => members.All(m => m.UserId != a.Id)).Select(a => new RotationOptionDto(a.Id.ToString(), a.Name)).ToList(),
            queues);
    }

    private static async Task<IResult> SaveAsync(SaveRotationRequest r, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var requested = r.Members ?? [];
        if (requested.Select(m => m.UserId).Distinct().Count() != requested.Count)
        {
            return Problems.Validation("members", "O mesmo tecnico aparece duas vezes na fila");
        }
        var assignees = (await TicketRotation.AssigneesAsync(db, ct)).ToDictionary(a => a.Id);
        if (requested.Any(m => !assignees.ContainsKey(m.UserId)))
        {
            return Problems.Validation("members", "So entra na fila quem esta ativo e pode atender chamados");
        }
        var queueIds = requested.SelectMany(m => m.QueueIds ?? []).Distinct().ToList();
        var known = await db.TicketQueues.Where(q => queueIds.Contains(q.Id)).Select(q => q.Id).ToListAsync(ct);
        if (queueIds.Except(known).Any())
        {
            return Problems.Validation("members", "Fila de chamados inexistente");
        }

        var settings = await SettingsStore.GetAsync(db, ct);
        settings.TicketRotationEnabled = r.Enabled;
        // A ordem da lista vale para o desempate; quem continua na fila guarda a ultima entrega para o rodizio seguir de onde estava.
        var current = await db.TicketRotationMembers.ToDictionaryAsync(m => m.UserId, ct);
        db.TicketRotationMembers.RemoveRange(current.Values.Where(m => requested.All(x => x.UserId != m.UserId)));
        for (var i = 0; i < requested.Count; i++)
        {
            var item = requested[i];
            if (!current.TryGetValue(item.UserId, out var member))
            {
                member = new TicketRotationMember { UserId = item.UserId };
                db.TicketRotationMembers.Add(member);
            }
            member.Position = i;
            member.Active = item.Active;
            member.QueueIds = (item.QueueIds ?? []).Distinct().Order().ToList();
        }
        await db.SaveChangesAsync(ct);
        var active = requested.Where(m => m.Active).Select(m => assignees[m.UserId].Name).ToList();
        await audit.LogAsync("ticket.rotation", "ticket_rotation", null,
            $"Fila de atendimento {(r.Enabled ? "ligada" : "desligada")}: {(active.Count == 0 ? "ninguem ativo" : string.Join(", ", active))}",
            cancellationToken: ct);
        return TypedResults.Ok(await DtoAsync(db, ct));
    }
}
