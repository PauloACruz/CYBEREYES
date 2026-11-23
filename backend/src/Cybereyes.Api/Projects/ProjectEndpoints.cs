using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Projects;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Projects;

/// <summary>
/// Projetos: tarefas com responsaveis e, opcionalmente, clientes, setores e estacoes onde o trabalho e feito, com a documentacao do
/// andamento. Quem tem projects.manage faz tudo; o responsavel pelo projeto ou por uma tarefa registra o andamento com projects.view.
/// </summary>
public static class ProjectEndpoints
{
    public const string PhaseScheduled = "scheduled";
    public const string PhaseInProgress = "in_progress";
    public const string PhaseLate = "late";
    public const int MaxAttachmentsPerNote = 10;
    private const int MaxAgents = 5000;
    private const int MaxTasks = 500;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.ProjectsView);
        var manage = Policies.Permission(Permissions.ProjectsManage);
        var projects = app.MapGroup("/api/projects").WithTags("Projetos");
        projects.MapGet("/", ListAsync).RequireAuthorization(view);
        projects.MapGet("/options", OptionsAsync).RequireAuthorization(view);
        projects.MapGet("/{id:int}", GetAsync).RequireAuthorization(view);
        projects.MapPost("/", (SaveProjectRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService a, ProjectPushOutbox push, TimeProvider t,
            CancellationToken ct) => SaveAsync(null, r, p, db, a, push, t, ct)).RequireAuthorization(manage);
        projects.MapPut("/{id:int}", (int id, SaveProjectRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService a, ProjectPushOutbox push,
            TimeProvider t, CancellationToken ct) => SaveAsync(id, r, p, db, a, push, t, ct)).RequireAuthorization(manage);
        projects.MapDelete("/{id:int}", DeleteAsync).RequireAuthorization(manage);
        projects.MapPut("/{id:int}/status", StatusAsync).RequireAuthorization(manage);
        projects.MapPost("/{id:int}/tasks", (int id, SaveProjectTaskRequest r, CybereyesDbContext db, ProjectPushOutbox push, TimeProvider t,
            CancellationToken ct) => SaveTaskAsync(id, null, r, db, push, t, ct)).RequireAuthorization(manage);
        projects.MapPut("/{id:int}/tasks/{taskId:long}", (int id, long taskId, SaveProjectTaskRequest r, CybereyesDbContext db, ProjectPushOutbox push,
            TimeProvider t, CancellationToken ct) => SaveTaskAsync(id, taskId, r, db, push, t, ct)).RequireAuthorization(manage);
        projects.MapDelete("/{id:int}/tasks/{taskId:long}", DeleteTaskAsync).RequireAuthorization(manage);
        projects.MapPut("/{id:int}/progress", ProgressAsync).RequireAuthorization(view);
        projects.MapGet("/{id:int}/notes", NotesAsync).RequireAuthorization(view);
        projects.MapPost("/{id:int}/notes", CreateNoteAsync).RequireAuthorization(view);
        projects.MapDelete("/{id:int}/notes/{noteId:long}", DeleteNoteAsync).RequireAuthorization(view);
        projects.MapPost("/{id:int}/notes/{noteId:long}/attachments", UploadAsync).RequireAuthorization(view).DisableAntiforgery();
        projects.MapGet("/{id:int}/attachments/{attachmentId:long}", DownloadAsync).RequireAuthorization(view);
        projects.MapGet("/{id:int}/cycles", CyclesAsync).RequireAuthorization(view);
        projects.MapPost("/{id:int}/cycles", CloseCycleAsync).RequireAuthorization(manage);
        app.MapGet("/api/agents/{id:int}/projects", AgentProjectsAsync).RequireAuthorization(view).WithTags("Projetos");
    }

    /// <summary>Fase exibida: a situacao guardada, ou, no projeto ativo, agendado/atrasado/em andamento pelas datas do ciclo.</summary>
    public static string Phase(Project p, DateOnly today) =>
        p.Status != ProjectStatus.Active ? p.Status
        : p.StartDate is { } start && start > today ? PhaseScheduled
        : p.DueDate is { } due && due < today ? PhaseLate
        : PhaseInProgress;

    /// <summary>
    /// Inicio do proximo ciclo: um periodo depois do atual, pulando os ciclos que ja teriam terminado (concluido com atraso, o
    /// seguinte e o que contem hoje). Devolve quantos periodos avancar.
    /// </summary>
    public static int CyclesToAdvance(DateOnly start, string recurrence, int interval, DateOnly today)
    {
        var steps = 1;
        while (steps < 100_000 && ProjectRecurrence.Advance(start, recurrence, interval * (steps + 1)) <= today)
        {
            steps++;
        }
        return steps;
    }

    /// <summary>Data de hoje no fuso do console.</summary>
    public static async Task<DateOnly> TodayAsync(CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var zone = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), zone).DateTime);
    }

    private static string DisplayName(string fullName, string? userName) => string.IsNullOrWhiteSpace(fullName) ? userName ?? "?" : fullName;

    /// <summary>Usuarios ativos que podem ser responsaveis: superusuarios e quem tem alguma permissao de projetos.</summary>
    public static async Task<List<ProjectUserRef>> EligibleUsersAsync(CybereyesDbContext db, CancellationToken ct)
    {
        var rows = await (
            from u in db.Users.AsNoTracking()
            where u.IsActive
            join ur in db.UserRoles.AsNoTracking() on u.Id equals ur.UserId
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            select new { u.Id, u.FullName, u.UserName, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        return rows.Where(r => r.IsSuperuser || r.Permissions.Contains(Permissions.ProjectsView) || r.Permissions.Contains(Permissions.ProjectsManage))
            .GroupBy(r => r.Id)
            .Select(g => new ProjectUserRef(g.Key, DisplayName(g.First().FullName, g.First().UserName)))
            .OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private static async Task<Dictionary<Guid, string>> UserNamesAsync(CybereyesDbContext db, IEnumerable<Guid?> ids, CancellationToken ct)
    {
        var list = ids.OfType<Guid>().Distinct().ToList();
        if (list.Count == 0)
        {
            return [];
        }
        var users = await db.Users.AsNoTracking().Where(u => list.Contains(u.Id)).Select(u => new { u.Id, u.FullName, u.UserName }).ToListAsync(ct);
        return users.ToDictionary(u => u.Id, u => DisplayName(u.FullName, u.UserName));
    }

    private static ProjectUserRef? UserRef(Guid? id, Dictionary<Guid, string> names) =>
        id is { } value ? new ProjectUserRef(value, names.GetValueOrDefault(value, "?")) : null;

    /// <summary>Recusa responsavel que nao enxergaria o projeto: precisa ver todos os clientes envolvidos.</summary>
    private static async Task<IResult?> ScopeProblemAsync(CybereyesDbContext db, string field, List<Guid> userIds,
        List<int> clientIds, Dictionary<Guid, string> names, CancellationToken ct)
    {
        if (userIds.Count == 0 || clientIds.Count == 0)
        {
            return null;
        }
        var scopes = await ClientAccess.ScopesAsync(db, userIds, ct);
        foreach (var (userId, scope) in scopes)
        {
            if (!clientIds.All(scope.Sees))
            {
                return Problems.Validation(field, $"{names.GetValueOrDefault(userId, "O responsavel")} nao tem acesso a todos os clientes do projeto");
            }
        }
        return null;
    }

    private static async Task<Dictionary<int, ProjectProgressDto>> ProgressByProjectAsync(CybereyesDbContext db, List<int> ids, DateOnly today,
        CancellationToken ct)
    {
        var agents = await db.ProjectAgents.AsNoTracking().Where(a => ids.Contains(a.ProjectId)).GroupBy(a => a.ProjectId)
            .Select(g => new
            {
                g.Key,
                Total = g.Count(),
                Finished = g.Count(a => a.Status == ProjectItemStatus.Done || a.Status == ProjectItemStatus.Skipped),
                Problems = g.Count(a => a.Status == ProjectItemStatus.Problem),
            }).ToDictionaryAsync(x => x.Key, ct);
        var tasks = await db.ProjectTasks.AsNoTracking().Where(t => ids.Contains(t.ProjectId)).GroupBy(t => t.ProjectId)
            .Select(g => new
            {
                g.Key,
                Total = g.Count(),
                Finished = g.Count(t => t.Status == ProjectItemStatus.Done || t.Status == ProjectItemStatus.Skipped),
                Problems = g.Count(t => t.Status == ProjectItemStatus.Problem),
                Overdue = g.Count(t => t.DueDate != null && t.DueDate < today && t.Status != ProjectItemStatus.Done && t.Status != ProjectItemStatus.Skipped),
            }).ToDictionaryAsync(x => x.Key, ct);
        return ids.ToDictionary(id => id, id =>
        {
            var a = agents.GetValueOrDefault(id);
            var t = tasks.GetValueOrDefault(id);
            return new ProjectProgressDto(a?.Total ?? 0, a?.Finished ?? 0, t?.Total ?? 0, t?.Finished ?? 0, (a?.Problems ?? 0) + (t?.Problems ?? 0),
                t?.Overdue ?? 0);
        });
    }

    private static async Task<Dictionary<int, List<ProjectRef>>> ClientsByProjectAsync(CybereyesDbContext db, List<int> ids, CancellationToken ct)
    {
        var rows = await (
            from pc in db.ProjectClients.AsNoTracking()
            where ids.Contains(pc.ProjectId)
            join c in db.Clients.AsNoTracking() on pc.ClientId equals c.Id
            orderby c.Name
            select new { pc.ProjectId, c.Id, c.Name }).ToListAsync(ct);
        return rows.GroupBy(r => r.ProjectId).ToDictionary(g => g.Key, g => g.Select(r => new ProjectRef(r.Id, r.Name)).ToList());
    }

    private static async Task<IResult> ListAsync(string? status, int? clientId, string? search, bool? mine, ClaimsPrincipal principal,
        CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var query = db.Projects.AsNoTracking();
        switch (status)
        {
            case null or "" or "open":
                query = query.Where(p => p.Status == ProjectStatus.Active || p.Status == ProjectStatus.Paused);
                break;
            case "all":
                break;
            case var s when ProjectStatus.All.Contains(s):
                query = query.Where(p => p.Status == s);
                break;
            default:
                return Problems.Validation("status", "Situacao invalida");
        }
        if (clientId is { } c)
        {
            query = query.Where(p => db.ProjectClients.Any(pc => pc.ProjectId == p.Id && pc.ClientId == c));
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = Logs.LogEndpoints.Like(search.Trim());
            query = query.Where(p => EF.Functions.ILike(p.Name, pattern) || EF.Functions.ILike(p.Description, pattern));
        }
        var me = principal.UserId();
        if (mine == true)
        {
            query = query.Where(p => p.OwnerId == me || db.ProjectTasks.Any(t => t.ProjectId == p.Id && t.AssigneeId == me));
        }
        var projects = await query.OrderBy(p => p.DueDate == null).ThenBy(p => p.DueDate).ThenBy(p => p.Name).Take(500).ToListAsync(ct);
        var ids = projects.Select(p => p.Id).ToList();
        var today = await TodayAsync(db, time, ct);
        var progress = await ProgressByProjectAsync(db, ids, today, ct);
        var clients = await ClientsByProjectAsync(db, ids, ct);
        var names = await UserNamesAsync(db, projects.Select(p => p.OwnerId), ct);
        var myOpen = me is null
            ? []
            : await db.ProjectTasks.AsNoTracking()
                .Where(t => ids.Contains(t.ProjectId) && t.AssigneeId == me && t.Status != ProjectItemStatus.Done && t.Status != ProjectItemStatus.Skipped)
                .GroupBy(t => t.ProjectId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        return TypedResults.Ok(projects.Select(p => new ProjectSummaryDto(p.Id, p.Name, p.Status, Phase(p, today), UserRef(p.OwnerId, names), p.Recurrence,
            p.RecurrenceInterval, p.Cycle, p.StartDate, p.DueDate, clients.GetValueOrDefault(p.Id) ?? [], progress[p.Id], myOpen.GetValueOrDefault(p.Id),
            p.UpdatedAt)));
    }

    private static async Task<IResult> OptionsAsync(CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var users = await EligibleUsersAsync(db, ct);
        var clients = await db.Clients.AsNoTracking().OrderBy(c => c.Name)
            .Select(c => new ProjectOptionClient(c.Id, c.Name, c.Sites.OrderBy(s => s.Name).Select(s => new ProjectOptionSite(s.Id, s.Name)).ToList()))
            .ToListAsync(ct);
        var now = time.GetUtcNow();
        var agents = await db.Agents.AsNoTracking().OrderBy(a => a.Hostname)
            .Select(a => new { a.Id, a.Hostname, a.Site!.ClientId, a.SiteId, a.Description, a.LastSeen, a.OfflineTime, a.OverdueTime }).ToListAsync(ct);
        return TypedResults.Ok(new ProjectOptionsDto(users, clients, agents.Select(a => new ProjectOptionAgent(a.Id, a.Hostname, a.ClientId, a.SiteId,
            a.Description, AgentStatus.Compute(a.LastSeen, a.OfflineTime, a.OverdueTime, now))).ToList()));
    }

    private static async Task<IResult> GetAsync(int id, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct) =>
        await db.Projects.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct) is { } project
            ? TypedResults.Ok(await DetailAsync(project, principal, db, time, ct))
            : Problems.NotFound("Projeto");

    private static bool IsOpen(Project p) => p.Status is ProjectStatus.Active or ProjectStatus.Paused;

    private static async Task<ProjectDetailDto> DetailAsync(Project p, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time,
        CancellationToken ct)
    {
        var today = await TodayAsync(db, time, ct);
        var now = time.GetUtcNow();
        var clients = (await ClientsByProjectAsync(db, [p.Id], ct)).GetValueOrDefault(p.Id) ?? [];
        var sites = await (
            from ps in db.ProjectSites.AsNoTracking()
            where ps.ProjectId == p.Id
            join s in db.Sites.AsNoTracking() on ps.SiteId equals s.Id
            join c in db.Clients.AsNoTracking() on s.ClientId equals c.Id
            orderby c.Name, s.Name
            select new ProjectSiteDto(s.Id, s.Name, c.Id, c.Name)).ToListAsync(ct);

        var rows = await db.ProjectAgents.AsNoTracking().Where(a => a.ProjectId == p.Id).ToListAsync(ct);
        var agentIds = rows.Select(r => r.AgentId).OfType<int>().ToList();
        var agents = await db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.Id))
            .Select(a => new { a.Id, a.SiteId, SiteName = a.Site!.Name, a.Description, a.LastSeen, a.OfflineTime, a.OverdueTime })
            .ToDictionaryAsync(a => a.Id, ct);
        var clientNames = await db.Clients.AsNoTracking().Where(c => rows.Select(r => r.ClientId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var agentDtos = rows.Select(r =>
        {
            var a = r.AgentId is { } aid ? agents.GetValueOrDefault(aid) : null;
            return new ProjectAgentDto(r.Id, r.AgentId, r.Hostname, r.ClientId, clientNames.GetValueOrDefault(r.ClientId), a?.SiteId, a?.SiteName,
                a?.Description, a is null ? null : AgentStatus.Compute(a.LastSeen, a.OfflineTime, a.OverdueTime, now), r.Status, r.Note, r.DoneByName,
                r.DoneAt);
        }).OrderBy(a => a.ClientName, StringComparer.CurrentCultureIgnoreCase).ThenBy(a => a.SiteName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(a => a.Hostname, StringComparer.CurrentCultureIgnoreCase).ToList();

        var tasks = await db.ProjectTasks.AsNoTracking().Where(t => t.ProjectId == p.Id).OrderBy(t => t.Position).ThenBy(t => t.Id).ToListAsync(ct);
        var names = await UserNamesAsync(db, tasks.Select(t => t.AssigneeId).Append(p.OwnerId), ct);
        var me = principal.UserId();
        var manage = principal.HasPermission(Permissions.ProjectsManage);
        var owner = me is not null && p.OwnerId == me;
        var open = IsOpen(p);
        var record = open && (manage || owner || (me is not null && tasks.Any(t => t.AssigneeId == me)));
        var taskDtos = tasks.Select(t => new ProjectTaskDto(t.Id, t.Title, t.Description, UserRef(t.AssigneeId, names), t.DueDate, t.Position, t.Status,
            t.Note, t.DoneByName, t.DoneAt, t.DueDate is { } due && due < today && !ProjectItemStatus.IsFinished(t.Status),
            open && (manage || owner || (me is not null && t.AssigneeId == me)))).ToList();

        var progress = new ProjectProgressDto(rows.Count, rows.Count(r => ProjectItemStatus.IsFinished(r.Status)), tasks.Count,
            tasks.Count(t => ProjectItemStatus.IsFinished(t.Status)),
            rows.Count(r => r.Status == ProjectItemStatus.Problem) + tasks.Count(t => t.Status == ProjectItemStatus.Problem),
            taskDtos.Count(t => t.Overdue));
        var closed = await db.ProjectCycles.CountAsync(c => c.ProjectId == p.Id, ct);
        var next = p.Recurrence != ProjectRecurrence.None && p.StartDate is { } start
            ? ProjectRecurrence.Advance(start, p.Recurrence, p.RecurrenceInterval)
            : (DateOnly?)null;
        return new ProjectDetailDto(p.Id, p.Name, p.Description, p.Status, Phase(p, today), UserRef(p.OwnerId, names), p.Recurrence, p.RecurrenceInterval,
            p.Cycle, p.StartDate, p.DueDate, next, clients, sites, agentDtos, taskDtos, progress, closed, p.CreatedByName, p.CreatedAt, p.UpdatedAt,
            p.CompletedAt, new ProjectAbilitiesDto(manage, record));
    }

    private static async Task<IResult> SaveAsync(int? id, SaveProjectRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        ProjectPushOutbox push, TimeProvider time, CancellationToken ct)
    {
        var recurrence = r.Recurrence ?? ProjectRecurrence.None;
        if (!ProjectRecurrence.All.Contains(recurrence))
        {
            return Problems.Validation("recurrence", "Repeticao invalida");
        }
        var interval = recurrence == ProjectRecurrence.None ? 1 : r.RecurrenceInterval ?? 1;
        if (recurrence != ProjectRecurrence.None && r.StartDate is null)
        {
            return Problems.Validation("startDate", "Informe a data de inicio do primeiro ciclo do projeto recorrente");
        }
        if (r.StartDate is { } s && r.DueDate is { } d)
        {
            if (d < s)
            {
                return Problems.Validation("dueDate", "O prazo nao pode ser antes do inicio");
            }
            if (recurrence != ProjectRecurrence.None && d >= ProjectRecurrence.Advance(s, recurrence, interval))
            {
                return Problems.Validation("dueDate", "O prazo precisa vir antes do inicio do proximo ciclo");
            }
        }
        if (id is not null && r.Tasks is { Count: > 0 })
        {
            return Problems.Validation("tasks", "Tarefas de um projeto existente sao alteradas pelas rotas de tarefa");
        }
        if ((r.Tasks?.Count ?? 0) > MaxTasks)
        {
            return Problems.Validation("tasks", $"No maximo {MaxTasks} tarefas");
        }

        var clientIds = (r.ClientIds ?? []).Distinct().ToList();
        var siteIds = (r.SiteIds ?? []).Distinct().ToList();
        var agentIds = (r.AgentIds ?? []).Distinct().ToList();
        if (agentIds.Count > MaxAgents)
        {
            return Problems.Validation("agentIds", $"No maximo {MaxAgents} estacoes por projeto");
        }
        if (await db.Clients.CountAsync(c => clientIds.Contains(c.Id), ct) != clientIds.Count)
        {
            return Problems.Validation("clientIds", "Cliente nao encontrado");
        }
        var sites = await db.Sites.AsNoTracking().Where(x => siteIds.Contains(x.Id)).Select(x => new { x.Id, x.ClientId }).ToListAsync(ct);
        if (sites.Count != siteIds.Count)
        {
            return Problems.Validation("siteIds", "Setor nao encontrado");
        }
        var agents = await db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.Id)).Select(a => new { a.Id, a.Hostname, a.Site!.ClientId })
            .ToDictionaryAsync(a => a.Id, ct);
        if (agents.Count != agentIds.Count)
        {
            return Problems.Validation("agentIds", "Estacao nao encontrada");
        }
        var allClients = clientIds.Concat(sites.Select(x => x.ClientId)).Concat(agents.Values.Select(a => a.ClientId)).Distinct().ToList();

        var eligible = (await EligibleUsersAsync(db, ct)).ToDictionary(u => u.Id, u => u.Name);
        if (r.OwnerId is { } ownerId && !eligible.ContainsKey(ownerId))
        {
            return Problems.Validation("ownerId", "O responsavel precisa ser um usuario ativo com acesso aos projetos");
        }
        var newTasks = r.Tasks ?? [];
        if (newTasks.FirstOrDefault(t => t.AssigneeId is { } a && !eligible.ContainsKey(a)) is not null)
        {
            return Problems.Validation("tasks", "O responsavel pela tarefa precisa ser um usuario ativo com acesso aos projetos");
        }

        Project? project = null;
        if (id is not null)
        {
            project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (project is null)
            {
                return Problems.NotFound("Projeto");
            }
        }
        var people = newTasks.Select(t => t.AssigneeId).Append(r.OwnerId).OfType<Guid>().ToList();
        if (id is not null)
        {
            people.AddRange(await db.ProjectTasks.Where(t => t.ProjectId == id && t.AssigneeId != null).Select(t => t.AssigneeId!.Value).ToListAsync(ct));
        }
        if (await ScopeProblemAsync(db, "ownerId", people.Distinct().ToList(), allClients, eligible, ct) is { } scopeProblem)
        {
            return scopeProblem;
        }

        var now = time.GetUtcNow();
        var today = await TodayAsync(db, time, ct);
        var me = principal.UserId();
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        var previousOwner = project?.OwnerId;
        var previousStart = project?.StartDate;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (project is null)
        {
            project = new Project { Name = r.Name.Trim(), CreatedById = me, CreatedByName = actor, CreatedAt = now };
            db.Projects.Add(project);
        }
        project.Name = r.Name.Trim();
        project.Description = r.Description?.Trim() ?? string.Empty;
        project.OwnerId = r.OwnerId;
        project.Recurrence = recurrence;
        project.RecurrenceInterval = interval;
        project.StartDate = r.StartDate;
        project.DueDate = r.DueDate;
        project.UpdatedAt = now;
        // Lembrete do inicio: o projeto criado ja em andamento nao avisa (as atribuicoes avisam); inicio movido para o futuro avisa de novo.
        if (r.StartDate is { } start && start > today)
        {
            project.StartNotifiedCycle = null;
        }
        else if (id is null || previousStart is null)
        {
            project.StartNotifiedCycle = project.Cycle;
        }
        await db.SaveChangesAsync(ct);

        var currentClients = await db.ProjectClients.Where(x => x.ProjectId == project.Id).ToListAsync(ct);
        db.ProjectClients.RemoveRange(currentClients.Where(x => !allClients.Contains(x.ClientId)));
        db.ProjectClients.AddRange(allClients.Where(c => currentClients.All(x => x.ClientId != c)).Select(c => new ProjectClient { ProjectId = project.Id, ClientId = c }));

        var currentSites = await db.ProjectSites.Where(x => x.ProjectId == project.Id).ToListAsync(ct);
        db.ProjectSites.RemoveRange(currentSites.Where(x => !siteIds.Contains(x.SiteId)));
        db.ProjectSites.AddRange(siteIds.Where(sid => currentSites.All(x => x.SiteId != sid)).Select(sid => new ProjectSite { ProjectId = project.Id, SiteId = sid }));

        // Estacao que sai perde a situacao do ciclo atual (as notas continuam, com o nome dela); a de agente removido sai tambem.
        var currentAgents = await db.ProjectAgents.Where(x => x.ProjectId == project.Id).ToListAsync(ct);
        db.ProjectAgents.RemoveRange(currentAgents.Where(x => x.AgentId is not { } aid || !agents.ContainsKey(aid)));
        foreach (var row in currentAgents.Where(x => x.AgentId is { } aid && agents.ContainsKey(aid)))
        {
            var a = agents[row.AgentId!.Value];
            row.Hostname = a.Hostname;
            row.ClientId = a.ClientId;
        }
        db.ProjectAgents.AddRange(agents.Values.Where(a => currentAgents.All(x => x.AgentId != a.Id))
            .Select(a => new ProjectAgent { ProjectId = project.Id, AgentId = a.Id, Hostname = a.Hostname, ClientId = a.ClientId }));

        var position = 0;
        var created = newTasks.Select(t => new ProjectTask
        {
            ProjectId = project.Id, Title = t.Title.Trim(), Description = Clean(t.Description), AssigneeId = t.AssigneeId, DueDate = t.DueDate,
            Position = position++,
        }).ToList();
        db.ProjectTasks.AddRange(created);
        if (id is null)
        {
            AddEvent(db, project, "Projeto criado", null, me, actor, now);
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        if (project.OwnerId is { } owner && owner != previousOwner)
        {
            push.Owner(project, owner);
        }
        push.Tasks(project, created);

        await audit.LogAsync(id is null ? "project.create" : "project.update", "project", project.Id.ToString(CultureInfo.InvariantCulture),
            $"Projeto {project.Name}", cancellationToken: ct);
        var dto = await DetailAsync(project, principal, db, time, ct);
        return id is null ? TypedResults.Created($"/api/projects/{project.Id}", dto) : TypedResults.Ok(dto);
    }

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static void AddEvent(CybereyesDbContext db, Project project, string subject, string? body, Guid? me, string actor, DateTimeOffset now) =>
        db.ProjectNotes.Add(new ProjectNote
        {
            ProjectId = project.Id, Cycle = project.Cycle, Kind = ProjectNoteKind.Event, Subject = subject, Body = body ?? string.Empty, AuthorId = me,
            AuthorName = actor, CreatedAt = now,
        });

    private static async Task<IResult> DeleteAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        db.Projects.Remove(project);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("project.delete", "project", id.ToString(CultureInfo.InvariantCulture), $"Projeto {project.Name}", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Pausa, retoma, cancela ou reabre. Concluir e pelo ciclo (POST cycles), que guarda o resultado; reabrir um projeto concluido
    /// desfaz o fechamento do ultimo ciclo.
    /// </summary>
    private static async Task<IResult> StatusAsync(int id, ProjectStatusRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if (!ProjectStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Situacao invalida");
        }
        if (r.Status == ProjectStatus.Done)
        {
            return Problems.Validation("status", "Para concluir, conclua o ciclo do projeto");
        }
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        if (project.Status == r.Status)
        {
            return TypedResults.Ok(await DetailAsync(project, principal, db, time, ct));
        }
        var previous = project.Status;
        var label = (previous, r.Status) switch
        {
            (_, ProjectStatus.Paused) => "Projeto pausado",
            (_, ProjectStatus.Cancelled) => "Projeto cancelado",
            (ProjectStatus.Paused, ProjectStatus.Active) => "Projeto retomado",
            _ => "Projeto reaberto",
        };
        if (previous == ProjectStatus.Done)
        {
            var last = await db.ProjectCycles.Where(c => c.ProjectId == id && c.Number == project.Cycle).ToListAsync(ct);
            db.ProjectCycles.RemoveRange(last);
        }
        var now = time.GetUtcNow();
        project.Status = r.Status;
        project.CompletedAt = r.Status == ProjectStatus.Cancelled ? now : null;
        project.UpdatedAt = now;
        AddEvent(db, project, label, null, principal.UserId(), await TicketEndpoints.ActorNameAsync(principal, db, ct), now);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("project.status", "project", id.ToString(CultureInfo.InvariantCulture), $"{label}: {project.Name}", cancellationToken: ct);
        return TypedResults.Ok(await DetailAsync(project, principal, db, time, ct));
    }

    private static async Task<IResult> SaveTaskAsync(int id, long? taskId, SaveProjectTaskRequest r, CybereyesDbContext db, ProjectPushOutbox push,
        TimeProvider time, CancellationToken ct)
    {
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        if (r.AssigneeId is { } assignee)
        {
            var eligible = (await EligibleUsersAsync(db, ct)).ToDictionary(u => u.Id, u => u.Name);
            if (!eligible.ContainsKey(assignee))
            {
                return Problems.Validation("assigneeId", "O responsavel precisa ser um usuario ativo com acesso aos projetos");
            }
            var clients = await db.ProjectClients.Where(x => x.ProjectId == id).Select(x => x.ClientId).ToListAsync(ct);
            if (await ScopeProblemAsync(db, "assigneeId", [assignee], clients, eligible, ct) is { } problem)
            {
                return problem;
            }
        }
        ProjectTask task;
        if (taskId is null)
        {
            if (await db.ProjectTasks.CountAsync(t => t.ProjectId == id, ct) >= MaxTasks)
            {
                return Problems.Validation("title", $"No maximo {MaxTasks} tarefas por projeto");
            }
            var position = await db.ProjectTasks.Where(t => t.ProjectId == id).MaxAsync(t => (int?)t.Position, ct) ?? -1;
            task = new ProjectTask { ProjectId = id, Title = r.Title.Trim(), Position = position + 1 };
            db.ProjectTasks.Add(task);
        }
        else
        {
            var found = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Tarefa");
            }
            task = found;
        }
        var previousAssignee = taskId is null ? null : task.AssigneeId;
        task.Title = r.Title.Trim();
        task.Description = Clean(r.Description);
        task.AssigneeId = r.AssigneeId;
        task.DueDate = r.DueDate;
        project.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        if (task.AssigneeId is not null && task.AssigneeId != previousAssignee)
        {
            push.Tasks(project, [task]);
        }
        return taskId is null ? TypedResults.Created($"/api/projects/{id}/tasks/{task.Id}", new { id = task.Id }) : TypedResults.NoContent();
    }

    private static async Task<IResult> DeleteTaskAsync(int id, long taskId, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == id, ct);
        if (task is null)
        {
            return Problems.NotFound("Tarefa");
        }
        db.ProjectTasks.Remove(task);
        if (await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct) is { } project)
        {
            project.UpdatedAt = time.GetUtcNow();
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private sealed record Actor(Guid? Id, bool Manage, bool Owner, bool Assignee);

    private static async Task<Actor> ActorAsync(Project project, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var me = principal.UserId();
        var assignee = me is not null && await db.ProjectTasks.AnyAsync(t => t.ProjectId == project.Id && t.AssigneeId == me, ct);
        return new Actor(me, principal.HasPermission(Permissions.ProjectsManage), me is not null && project.OwnerId == me, assignee);
    }

    private static bool CanRecord(Actor a) => a.Manage || a.Owner || a.Assignee;

    private static bool CanUpdate(Actor a, ProjectTask t) => a.Manage || a.Owner || (a.Id is not null && t.AssigneeId == a.Id);

    private static void Apply(IProjectItem item, string status, string? note, Guid? me, string actor, DateTimeOffset now)
    {
        item.Status = status;
        if (Clean(note) is { } text)
        {
            item.Note = text.Length <= 2000 ? text : text[..2000];
        }
        var pending = status == ProjectItemStatus.Pending;
        item.DoneById = pending ? null : me;
        item.DoneByName = pending ? null : actor;
        item.DoneAt = pending ? null : now;
    }

    /// <summary>Muda a situacao de estacoes e/ou tarefas de uma vez e registra uma nota de andamento.</summary>
    private static async Task<IResult> ProgressAsync(int id, ProjectProgressRequest r, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time,
        CancellationToken ct)
    {
        if (!ProjectItemStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Situacao invalida");
        }
        var agentRowIds = (r.AgentRowIds ?? []).Distinct().ToList();
        var taskIds = (r.TaskIds ?? []).Distinct().ToList();
        if (agentRowIds.Count + taskIds.Count == 0)
        {
            return Problems.Validation("agentRowIds", "Escolha ao menos uma estacao ou tarefa");
        }
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        if (!IsOpen(project))
        {
            return Problems.Conflict("Projeto encerrado; reabra para registrar o andamento");
        }
        var actor = await ActorAsync(project, principal, db, ct);
        var rows = await db.ProjectAgents.Where(a => a.ProjectId == id && agentRowIds.Contains(a.Id)).ToListAsync(ct);
        var tasks = await db.ProjectTasks.Where(t => t.ProjectId == id && taskIds.Contains(t.Id)).ToListAsync(ct);
        if (rows.Count != agentRowIds.Count || tasks.Count != taskIds.Count)
        {
            return Problems.NotFound("Estacao ou tarefa do projeto");
        }
        if ((rows.Count > 0 && !CanRecord(actor)) || tasks.Any(t => !CanUpdate(actor, t)))
        {
            return Problems.Forbidden("So o responsavel pelo projeto ou pela tarefa (ou quem gerencia projetos) registra o andamento");
        }
        var now = time.GetUtcNow();
        var name = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        foreach (var item in rows.Cast<IProjectItem>().Concat(tasks))
        {
            Apply(item, r.Status, r.Note, actor.Id, name, now);
        }
        var subject = Subject(rows.Select(x => x.Hostname).Concat(tasks.Select(t => t.Title)).ToList());
        db.ProjectNotes.Add(new ProjectNote
        {
            ProjectId = id, Cycle = project.Cycle, Kind = ProjectNoteKind.Status, ItemStatus = r.Status,
            ProjectAgentId = rows.Count == 1 && tasks.Count == 0 ? rows[0].Id : null,
            ProjectTaskId = tasks.Count == 1 && rows.Count == 0 ? tasks[0].Id : null,
            Subject = subject,
            Body = Clean(r.Note) ?? string.Empty, AuthorId = actor.Id, AuthorName = name, CreatedAt = now,
        });
        project.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Nomes das estacoes e tarefas, cortado em "e mais N" para caber nos 300 caracteres do assunto.</summary>
    public static string Subject(IReadOnlyList<string> names)
    {
        var text = string.Empty;
        for (var i = 0; i < names.Count; i++)
        {
            var next = i == 0 ? names[i] : $"{text}, {names[i]}";
            if (next.Length > 270)
            {
                return i == 0 ? names[0][..Math.Min(names[0].Length, 300)] : $"{text} e mais {names.Count - i}";
            }
            text = next;
        }
        return text;
    }

    private static async Task<IResult> NotesAsync(int id, int? cycle, long? projectAgentId, long? projectTaskId, ClaimsPrincipal principal,
        CybereyesDbContext db, CancellationToken ct)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == id, ct))
        {
            return Problems.NotFound("Projeto");
        }
        var query = db.ProjectNotes.AsNoTracking().Where(n => n.ProjectId == id);
        if (cycle is { } c)
        {
            query = query.Where(n => n.Cycle == c);
        }
        if (projectAgentId is { } a)
        {
            query = query.Where(n => n.ProjectAgentId == a);
        }
        if (projectTaskId is { } t)
        {
            query = query.Where(n => n.ProjectTaskId == t);
        }
        var notes = await query.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(500).ToListAsync(ct);
        var noteIds = notes.Select(n => n.Id).ToList();
        var attachments = (await db.ProjectAttachments.AsNoTracking().Where(x => x.NoteId != null && noteIds.Contains(x.NoteId.Value)).OrderBy(x => x.Id)
            .ToListAsync(ct)).ToLookup(x => x.NoteId!.Value);
        var me = principal.UserId();
        var manage = principal.HasPermission(Permissions.ProjectsManage);
        return TypedResults.Ok(notes.Select(n => ToDto(n, attachments[n.Id], manage, me)));
    }

    private static ProjectNoteDto ToDto(ProjectNote n, IEnumerable<ProjectAttachment> attachments, bool manage, Guid? me) =>
        new(n.Id, n.Cycle, n.Kind, n.ProjectAgentId, n.ProjectTaskId, n.Subject, n.ItemStatus, n.Body, n.AuthorId, n.AuthorName, n.CreatedAt,
            attachments.Select(ToDto).ToList(), n.Kind != ProjectNoteKind.Event && (manage || (me is not null && n.AuthorId == me)));

    private static ProjectAttachmentDto ToDto(ProjectAttachment a) => new(a.Id, a.FileName, a.ContentType, a.Size);

    /// <summary>Nota na documentacao; os anexos vao depois, um por envio (POST .../notes/{noteId}/attachments).</summary>
    private static async Task<IResult> CreateNoteAsync(int id, CreateProjectNoteRequest r, ClaimsPrincipal principal, CybereyesDbContext db,
        TimeProvider time, CancellationToken ct)
    {
        if (r.Status is not null && !ProjectItemStatus.All.Contains(r.Status))
        {
            return Problems.Validation("status", "Situacao invalida");
        }
        if (r.ProjectAgentId is not null && r.ProjectTaskId is not null)
        {
            return Problems.Validation("projectTaskId", "A nota e de uma estacao ou de uma tarefa, nao das duas");
        }
        if (r.Status is not null && r.ProjectAgentId is null && r.ProjectTaskId is null)
        {
            return Problems.Validation("status", "Escolha a estacao ou a tarefa cuja situacao muda");
        }
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        if (!IsOpen(project))
        {
            return Problems.Conflict("Projeto encerrado; reabra para documentar");
        }
        var actor = await ActorAsync(project, principal, db, ct);
        IProjectItem? item = null;
        string? subject = null;
        if (r.ProjectAgentId is { } rowId)
        {
            var row = await db.ProjectAgents.FirstOrDefaultAsync(a => a.Id == rowId && a.ProjectId == id, ct);
            if (row is null)
            {
                return Problems.NotFound("Estacao do projeto");
            }
            (item, subject) = (row, row.Hostname);
        }
        if (r.ProjectTaskId is { } taskId)
        {
            var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == id, ct);
            if (task is null)
            {
                return Problems.NotFound("Tarefa do projeto");
            }
            if (r.Status is not null && !CanUpdate(actor, task))
            {
                return Problems.Forbidden("So o responsavel pelo projeto ou pela tarefa (ou quem gerencia projetos) muda a situacao da tarefa");
            }
            (item, subject) = (task, task.Title);
        }
        if (!CanRecord(actor))
        {
            return Problems.Forbidden("So o responsavel pelo projeto, os responsaveis pelas tarefas e quem gerencia projetos documentam o projeto");
        }
        var now = time.GetUtcNow();
        var name = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        if (item is not null && r.Status is { } status)
        {
            Apply(item, status, r.Body, actor.Id, name, now);
        }
        var note = new ProjectNote
        {
            ProjectId = id, Cycle = project.Cycle, Kind = r.Status is null ? ProjectNoteKind.Note : ProjectNoteKind.Status, ItemStatus = r.Status,
            ProjectAgentId = r.ProjectAgentId, ProjectTaskId = r.ProjectTaskId, Subject = subject, Body = r.Body?.Trim() ?? string.Empty,
            AuthorId = actor.Id, AuthorName = name, CreatedAt = now,
        };
        db.ProjectNotes.Add(note);
        project.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/{id}/notes/{note.Id}", ToDto(note, [], actor.Manage, actor.Id));
    }

    private static async Task<IResult> DeleteNoteAsync(int id, long noteId, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        CancellationToken ct)
    {
        var note = await db.ProjectNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.ProjectId == id, ct);
        if (note is null)
        {
            return Problems.NotFound("Registro");
        }
        var me = principal.UserId();
        if (note.Kind == ProjectNoteKind.Event || (!principal.HasPermission(Permissions.ProjectsManage) && (me is null || note.AuthorId != me)))
        {
            return Problems.Forbidden("So quem escreveu (ou quem gerencia projetos) exclui o registro");
        }
        db.ProjectNotes.Remove(note);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("project.note.delete", "project", id.ToString(CultureInfo.InvariantCulture),
            $"Registro de {note.AuthorName} em {note.CreatedAt:O} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> UploadAsync(int id, long noteId, [FromForm] IFormFile? file, ClaimsPrincipal principal, CybereyesDbContext db,
        CancellationToken ct)
    {
        var note = await db.ProjectNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.ProjectId == id, ct);
        if (note is null)
        {
            return Problems.NotFound("Registro");
        }
        var me = principal.UserId();
        if (!principal.HasPermission(Permissions.ProjectsManage) && (me is null || note.AuthorId != me))
        {
            return Problems.Forbidden("So quem escreveu o registro anexa arquivos a ele");
        }
        if (await db.ProjectAttachments.CountAsync(a => a.NoteId == noteId, ct) >= MaxAttachmentsPerNote)
        {
            return Problems.Validation("file", $"No maximo {MaxAttachmentsPerNote} anexos por registro");
        }
        if (file is null || file.Length == 0)
        {
            return Problems.Validation("file", "Envie um arquivo");
        }
        if (file.Length > Attachments.MaxBytes)
        {
            return Problems.Create(StatusCodes.Status413PayloadTooLarge, "Arquivo maior que 10 MB", ErrorCodes.Validation);
        }
        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var content = buffer.ToArray();
        var name = Path.GetFileName(file.FileName);
        var attachment = new ProjectAttachment
        {
            ProjectId = id, NoteId = noteId, FileName = string.IsNullOrWhiteSpace(name) ? "arquivo" : name[..Math.Min(name.Length, 255)],
            ContentType = Attachments.DetectImage(content) ?? "application/octet-stream", Size = content.Length,
            UploadedBy = await TicketEndpoints.ActorNameAsync(principal, db, ct),
        };
        db.ProjectAttachments.Add(attachment);
        await db.SaveChangesAsync(ct);
        db.ProjectAttachmentData.Add(new ProjectAttachmentData { AttachmentId = attachment.Id, Content = content });
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/{id}/attachments/{attachment.Id}", ToDto(attachment));
    }

    private static async Task<IResult> DownloadAsync(int id, long attachmentId, CybereyesDbContext db, CancellationToken ct)
    {
        var attachment = await db.ProjectAttachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == attachmentId && a.ProjectId == id, ct);
        var content = attachment is null
            ? null
            : await db.ProjectAttachmentData.AsNoTracking().Where(d => d.AttachmentId == attachmentId).Select(d => d.Content).FirstOrDefaultAsync(ct);
        if (attachment is null || content is null)
        {
            return Problems.NotFound("Anexo");
        }
        // So imagens reconhecidas pela assinatura abrem no navegador; o resto baixa como arquivo.
        return attachment.ContentType.StartsWith("image/", StringComparison.Ordinal)
            ? Results.File(content, attachment.ContentType, enableRangeProcessing: false)
            : Results.File(content, "application/octet-stream", attachment.FileName);
    }

    private static async Task<IResult> CyclesAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == id, ct))
        {
            return Problems.NotFound("Projeto");
        }
        var cycles = await db.ProjectCycles.AsNoTracking().Where(c => c.ProjectId == id).OrderByDescending(c => c.Number).ToListAsync(ct);
        return TypedResults.Ok(cycles.Select(c => new ProjectCycleDto(c.Id, c.Number, c.StartDate, c.DueDate, c.ClosedAt, c.ClosedByName, c.Summary,
            JsonSerializer.Deserialize<List<ProjectCycleItem>>(c.Items, Json) ?? [])));
    }

    /// <summary>
    /// Conclui o ciclo atual e guarda o resultado de cada estacao e tarefa. Recorrente (sem <c>finish</c>): as datas avancam, tudo volta
    /// a pendente e o ciclo seguinte comeca. Sem repeticao (ou com <c>finish</c>): o projeto fica concluido.
    /// </summary>
    private static async Task<IResult> CloseCycleAsync(int id, CloseProjectCycleRequest r, ClaimsPrincipal principal, CybereyesDbContext db,
        IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
        {
            return Problems.NotFound("Projeto");
        }
        if (!IsOpen(project))
        {
            return Problems.Conflict("O projeto ja esta encerrado");
        }
        var rows = await db.ProjectAgents.Where(a => a.ProjectId == id).ToListAsync(ct);
        var tasks = await db.ProjectTasks.Where(t => t.ProjectId == id).OrderBy(t => t.Position).ThenBy(t => t.Id).ToListAsync(ct);
        var agentIds = rows.Select(x => x.AgentId).OfType<int>().ToList();
        var siteNames = await db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.Id)).Select(a => new { a.Id, a.Site!.Name })
            .ToDictionaryAsync(a => a.Id, a => a.Name, ct);
        var clientIds = rows.Select(x => x.ClientId).Distinct().ToList();
        var clientNames = await db.Clients.AsNoTracking().Where(c => clientIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var names = await UserNamesAsync(db, tasks.Select(t => t.AssigneeId), ct);
        var items = rows
            .Select(x => new ProjectCycleItem("agent", x.Hostname,
                string.Join(" / ", new[] { clientNames.GetValueOrDefault(x.ClientId), x.AgentId is { } aid ? siteNames.GetValueOrDefault(aid) : null }.OfType<string>()),
                x.Status, x.Note, x.DoneByName, x.DoneAt))
            .OrderBy(x => x.Detail, StringComparer.CurrentCultureIgnoreCase).ThenBy(x => x.Title, StringComparer.CurrentCultureIgnoreCase)
            .Concat(tasks.Select(t => new ProjectCycleItem("task", t.Title, t.AssigneeId is { } a ? names.GetValueOrDefault(a) : null, t.Status, t.Note,
                t.DoneByName, t.DoneAt)))
            .ToList();

        var now = time.GetUtcNow();
        var me = principal.UserId();
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        var number = project.Cycle;
        db.ProjectCycles.RemoveRange(await db.ProjectCycles.Where(c => c.ProjectId == id && c.Number == number).ToListAsync(ct));
        db.ProjectCycles.Add(new ProjectCycle
        {
            ProjectId = id, Number = number, StartDate = project.StartDate, DueDate = project.DueDate, ClosedAt = now, ClosedById = me,
            ClosedByName = actor, Summary = Clean(r.Summary), Items = JsonSerializer.Serialize(items, Json),
        });
        var recurring = project.Recurrence != ProjectRecurrence.None && project.StartDate is not null;
        var keepGoing = recurring && !r.Finish;
        AddEvent(db, project, keepGoing ? $"Ciclo {number} concluido" : "Projeto concluido", Clean(r.Summary), me, actor, now);
        if (keepGoing)
        {
            var today = await TodayAsync(db, time, ct);
            var steps = CyclesToAdvance(project.StartDate!.Value, project.Recurrence, project.RecurrenceInterval, today);
            var by = project.RecurrenceInterval * steps;
            project.StartDate = ProjectRecurrence.Advance(project.StartDate!.Value, project.Recurrence, by);
            project.DueDate = project.DueDate is { } due ? ProjectRecurrence.Advance(due, project.Recurrence, by) : null;
            foreach (var t in tasks)
            {
                t.DueDate = t.DueDate is { } td ? ProjectRecurrence.Advance(td, project.Recurrence, by) : null;
            }
            foreach (var item in rows.Cast<IProjectItem>().Concat(tasks))
            {
                item.Status = ProjectItemStatus.Pending;
                item.Note = null;
                item.DoneById = null;
                item.DoneByName = null;
                item.DoneAt = null;
            }
            project.Cycle = number + 1;
        }
        else
        {
            project.Status = ProjectStatus.Done;
            project.CompletedAt = now;
        }
        project.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("project.cycle", "project", id.ToString(CultureInfo.InvariantCulture),
            keepGoing ? $"Ciclo {number} do projeto {project.Name} concluido" : $"Projeto {project.Name} concluido", cancellationToken: ct);
        return TypedResults.Ok(await DetailAsync(project, principal, db, time, ct));
    }

    private static async Task<IResult> AgentProjectsAsync(int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var today = await TodayAsync(db, time, ct);
        var rows = await (
            from pa in db.ProjectAgents.AsNoTracking()
            where pa.AgentId == id
            join p in db.Projects.AsNoTracking() on pa.ProjectId equals p.Id
            orderby p.Status == ProjectStatus.Active || p.Status == ProjectStatus.Paused descending, p.UpdatedAt descending
            select new { P = p, pa.Status, pa.DoneByName, pa.DoneAt }).Take(200).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(x => new AgentProjectDto(x.P.Id, x.P.Name, Phase(x.P, today), x.P.Cycle, x.P.DueDate, x.Status, x.DoneByName,
            x.DoneAt)));
    }
}
