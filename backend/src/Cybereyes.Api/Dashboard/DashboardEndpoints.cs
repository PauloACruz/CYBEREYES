using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Endpoints;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Dashboard;

public sealed record DashboardAgentsClient(int ClientId, string ClientName, int Total, int Online, int Overdue, int Offline);
public sealed record DashboardAgents(int Total, int Online, int Overdue, int Offline, IReadOnlyList<DashboardAgentsClient> ByClient);
public sealed record DashboardTicketDay(DateOnly Date, int Opened, int Resolved);
public sealed record DashboardTickets(int Open, int Unassigned, int Breached, int OpenedInPeriod, int ResolvedInPeriod, IReadOnlyList<DashboardTicketDay> Days);
public sealed record DashboardCheckDay(DateOnly Date, int Passing, int Failing);
public sealed record DashboardChecks(int Total, int Passing, int Failing, int HistoryDays, IReadOnlyList<DashboardCheckDay> Days);
public sealed record DashboardOverview(DateOnly From, DateOnly To, DashboardAgents? Agents, DashboardTickets? Tickets, DashboardChecks? Checks);

/// <summary>Visao geral do Painel: estacoes online, chamados e checks por dia, com filtro de cliente, tecnico e periodo.</summary>
public static class DashboardEndpoints
{
    /// <summary>Periodos aceitos, em dias.</summary>
    public static readonly int[] PeriodDays = [7, 14, 30];

    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/dashboard").WithTags("Painel").MapGet("/overview", OverviewAsync).RequireAuthorization();
    }

    private static async Task<IResult> OverviewAsync(ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time,
        int? clientId, Guid? technicianId, int? days, CancellationToken ct)
    {
        var period = days ?? 30;
        if (!PeriodDays.Contains(period))
        {
            return Problems.Validation("days", "Use " + string.Join(", ", PeriodDays));
        }
        var settings = await SettingsStore.GetAsync(db, ct);
        var zone = SettingsStore.TimeZone(settings);
        var now = time.GetUtcNow();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        var from = today.AddDays(1 - period);
        // Inicio do primeiro dia no fuso do console, em UTC (o banco guarda timestamptz).
        var since = new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), zone.GetUtcOffset(from.ToDateTime(TimeOnly.MinValue))).ToUniversalTime();
        var offsetMinutes = zone.GetUtcOffset(now).TotalMinutes;
        var dates = Enumerable.Range(0, period).Select(i => from.AddDays(i)).ToList();

        DashboardAgents? agents = null;
        DashboardChecks? checks = null;
        if (principal.HasPermission(Permissions.AgentsView))
        {
            var agentQuery = db.Agents.AsNoTracking();
            if (clientId is { } c)
            {
                agentQuery = agentQuery.Where(a => a.Site!.ClientId == c);
            }
            var byClient = await agentQuery
                .GroupBy(a => new { a.Site!.ClientId, a.Site.Client!.Name })
                .Select(g => new DashboardAgentsClient(g.Key.ClientId, g.Key.Name, g.Count(),
                    g.Count(a => a.Status == AgentStatus.Online), g.Count(a => a.Status == AgentStatus.Overdue), g.Count(a => a.Status == AgentStatus.Offline)))
                .ToListAsync(ct);
            byClient = byClient.OrderBy(x => x.ClientName, StringComparer.CurrentCultureIgnoreCase).ToList();
            agents = new DashboardAgents(byClient.Sum(x => x.Total), byClient.Sum(x => x.Online), byClient.Sum(x => x.Overdue), byClient.Sum(x => x.Offline), byClient);

            var history = db.CheckHistory.AsNoTracking().Where(h => h.Time >= since);
            if (clientId is { } hc)
            {
                history = history.Where(h => db.Agents.Any(a => a.Id == h.AgentId && a.Site!.ClientId == hc));
            }
            // Agrupa pelo dia no fuso do console (deslocamento atual; o Brasil nao tem horario de verao).
            var rows = await history
                .Select(h => new { Local = h.Time.AddMinutes(offsetMinutes), h.Status })
                .GroupBy(x => new { x.Local.Year, x.Local.Month, x.Local.Day, x.Status })
                .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Day, g.Key.Status, Count = g.Count() })
                .ToListAsync(ct);
            var checkDays = dates.Select(d => new DashboardCheckDay(d,
                rows.Where(r => r.Year == d.Year && r.Month == d.Month && r.Day == d.Day && r.Status == CheckStatus.Passing).Sum(r => r.Count),
                rows.Where(r => r.Year == d.Year && r.Month == d.Month && r.Day == d.Day && r.Status == CheckStatus.Failing).Sum(r => r.Count))).ToList();
            var passing = checkDays.Sum(d => d.Passing);
            var failing = checkDays.Sum(d => d.Failing);
            checks = new DashboardChecks(passing + failing, passing, failing, settings.CheckHistoryDays, checkDays);
        }

        DashboardTickets? tickets = null;
        if (principal.HasPermission(Permissions.TicketsView))
        {
            var ticketQuery = db.Tickets.AsNoTracking();
            if (clientId is { } tc)
            {
                ticketQuery = ticketQuery.Where(t => t.ClientId == tc);
            }
            if (technicianId is { } tech)
            {
                ticketQuery = ticketQuery.Where(t => t.AssignedToId == tech);
            }
            var open = ticketQuery.Where(t => TicketStatus.Open.Contains(t.Status));
            var openCount = await open.CountAsync(ct);
            var unassigned = technicianId is null ? await open.CountAsync(t => t.AssignedToId == null, ct) : 0;
            var breached = await open.CountAsync(t => (t.FirstResponseAt == null && t.FirstResponseDueAt < now) || t.ResolutionDueAt < now, ct);
            var opened = await ticketQuery.Where(t => t.CreatedAt >= since).Select(t => t.CreatedAt).ToListAsync(ct);
            var resolved = await ticketQuery.Where(t => t.ResolvedAt != null && t.ResolvedAt >= since).Select(t => t.ResolvedAt!.Value).ToListAsync(ct);
            DateOnly Local(DateTimeOffset value) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(value, zone).DateTime);
            var openedByDay = opened.GroupBy(Local).ToDictionary(g => g.Key, g => g.Count());
            var resolvedByDay = resolved.GroupBy(Local).ToDictionary(g => g.Key, g => g.Count());
            var ticketDays = dates.Select(d => new DashboardTicketDay(d, openedByDay.GetValueOrDefault(d), resolvedByDay.GetValueOrDefault(d))).ToList();
            tickets = new DashboardTickets(openCount, unassigned, breached, ticketDays.Sum(d => d.Opened), ticketDays.Sum(d => d.Resolved), ticketDays);
        }

        return TypedResults.Ok(new DashboardOverview(from, today, agents, tickets, checks));
    }
}
