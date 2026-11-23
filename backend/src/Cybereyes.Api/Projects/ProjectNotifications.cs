using System.Globalization;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Notifications;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Projects;

namespace Cybereyes.Api.Projects;

/// <summary>Aviso de projeto com os destinatarios ja escolhidos; quem fez a acao fica de fora.</summary>
public sealed record ProjectPush(int ProjectId, IReadOnlyList<Guid> UserIds, string Title, string Body, string Tag, Guid? ActorId);

/// <summary>Fila dos avisos de projeto: a requisicao so enfileira e o envio roda em segundo plano.</summary>
public sealed class ProjectPushOutbox(IHttpContextAccessor accessor)
{
    private readonly Channel<ProjectPush> channel = Channel.CreateUnbounded<ProjectPush>(new UnboundedChannelOptions { SingleReader = true });

    public ChannelReader<ProjectPush> Reader => channel.Reader;

    public void Enqueue(int projectId, IEnumerable<Guid> userIds, string title, string body, string tag)
    {
        var users = userIds.Distinct().ToList();
        if (users.Count > 0)
        {
            channel.Writer.TryWrite(new ProjectPush(projectId, users, title, body, tag, accessor.HttpContext?.User.UserId()));
        }
    }

    /// <summary>Quem passou a ser responsavel pelo projeto.</summary>
    public void Owner(Project project, Guid ownerId) =>
        Enqueue(project.Id, [ownerId], "Projeto sob sua responsabilidade", Join(project.Name, ProjectTexts.Period(project.StartDate, project.DueDate)),
            $"projeto-{project.Id}");

    /// <summary>Tarefas que passaram a ser de alguem: um aviso por pessoa, juntando as tarefas dela.</summary>
    public void Tasks(Project project, IEnumerable<ProjectTask> tasks)
    {
        foreach (var group in tasks.Where(t => t.AssigneeId is not null).GroupBy(t => t.AssigneeId!.Value))
        {
            var list = group.ToList();
            if (list.Count == 1)
            {
                var task = list[0];
                var due = task.DueDate is { } d ? $"prazo {d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}" : null;
                Enqueue(project.Id, [group.Key], "Tarefa atribuída a você", Join(task.Title, Join(project.Name, due)),
                    $"projeto-{project.Id}-tarefa-{task.Id}");
            }
            else
            {
                Enqueue(project.Id, [group.Key], $"{list.Count} tarefas atribuídas a você", project.Name, $"projeto-{project.Id}-tarefas");
            }
        }
    }

    public static string Join(string? first, string? second) =>
        string.IsNullOrWhiteSpace(second) ? first ?? string.Empty : string.IsNullOrWhiteSpace(first) ? second : $"{first} · {second}";
}

public static class ProjectTexts
{
    public static string? Period(DateOnly? start, DateOnly? due)
    {
        static string F(DateOnly d) => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return (start, due) switch
        {
            ({ } s, { } d) => $"{F(s)} a {F(d)}",
            ({ } s, null) => $"a partir de {F(s)}",
            (null, { } d) => $"até {F(d)}",
            _ => null,
        };
    }
}

/// <summary>
/// Envia os avisos de projeto aos aparelhos com a opcao "Projetos" ligada, de quem ainda enxerga o projeto (permissao de projetos e
/// todos os clientes dele no escopo). Inscricoes que o navegador descartou saem do banco.
/// </summary>
public sealed partial class ProjectPushDispatcher(ProjectPushOutbox queue, IServiceScopeFactory scopes, IPushTransport transport, TimeProvider time,
    ILogger<ProjectPushDispatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var item in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await DispatchAsync(item, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogDispatchFailed(logger, ex, item.ProjectId);
            }
        }
    }

    private async Task DispatchAsync(ProjectPush item, CancellationToken ct)
    {
        var users = item.UserIds.Where(u => u != item.ActorId).ToList();
        if (users.Count == 0)
        {
            return;
        }
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        if (!await db.Projects.AnyAsync(p => p.Id == item.ProjectId, ct))
        {
            return;
        }
        var eligible = (await ProjectEndpoints.EligibleUsersAsync(db, ct)).Select(u => u.Id).ToHashSet();
        users = users.Where(eligible.Contains).ToList();
        var clients = await db.ProjectClients.AsNoTracking().Where(pc => pc.ProjectId == item.ProjectId).Select(pc => pc.ClientId).ToListAsync(ct);
        if (clients.Count > 0 && users.Count > 0)
        {
            var userScopes = await ClientAccess.ScopesAsync(db, users, ct);
            users = users.Where(u => userScopes.TryGetValue(u, out var s) && clients.All(s.Sees)).ToList();
        }
        if (users.Count == 0)
        {
            return;
        }
        var subscriptions = await db.PushSubscriptions.AsNoTracking().Where(s => s.Projects && users.Contains(s.UserId)).ToListAsync(ct);
        if (subscriptions.Count == 0)
        {
            return;
        }
        var message = new PushMessage(item.Title, item.Body, $"/projetos/{item.ProjectId}", item.Tag);
        var results = await Task.WhenAll(subscriptions.Select(async s => (s.Id, Result: await transport.SendAsync(s, message, ct))));
        var gone = results.Where(r => r.Result.Gone).Select(r => r.Id).ToList();
        var delivered = results.Where(r => r.Result.Delivered).Select(r => r.Id).ToList();
        if (gone.Count > 0)
        {
            await db.PushSubscriptions.Where(s => gone.Contains(s.Id)).ExecuteDeleteAsync(ct);
        }
        if (delivered.Count > 0)
        {
            var now = time.GetUtcNow();
            await db.PushSubscriptions.Where(s => delivered.Contains(s.Id)).ExecuteUpdateAsync(u => u.SetProperty(s => s.LastSentAt, now), ct);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao enviar o aviso do projeto {ProjectId}")]
    private static partial void LogDispatchFailed(ILogger logger, Exception exception, int projectId);
}

/// <summary>
/// Lembrete do inicio do ciclo agendado: no dia do inicio (ou depois, se ninguem foi avisado ainda), o responsavel e quem tem
/// tarefa no projeto recebem um aviso. A reserva do ciclo no banco garante um aviso so, mesmo com varias replicas da API.
/// </summary>
public sealed partial class ProjectReminderService(IServiceScopeFactory scopes, ProjectPushOutbox outbox, TimeProvider time,
    ILogger<ProjectReminderService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10), time);
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
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var today = await ProjectEndpoints.TodayAsync(db, time, ct);
        var due = await db.Projects.AsNoTracking()
            .Where(p => p.Status == ProjectStatus.Active && p.StartDate != null && p.StartDate <= today && (p.DueDate == null || p.DueDate >= today) &&
                (p.StartNotifiedCycle == null || p.StartNotifiedCycle != p.Cycle))
            .ToListAsync(ct);
        foreach (var project in due)
        {
            var cycle = project.Cycle;
            var claimed = await db.Projects
                .Where(p => p.Id == project.Id && p.Cycle == cycle && (p.StartNotifiedCycle == null || p.StartNotifiedCycle != cycle))
                .ExecuteUpdateAsync(u => u.SetProperty(p => p.StartNotifiedCycle, cycle), ct);
            if (claimed == 0)
            {
                continue;
            }
            var people = await db.ProjectTasks.AsNoTracking().Where(t => t.ProjectId == project.Id && t.AssigneeId != null)
                .Select(t => t.AssigneeId!.Value).ToListAsync(ct);
            if (project.OwnerId is { } owner)
            {
                people.Add(owner);
            }
            var agents = await db.ProjectAgents.CountAsync(a => a.ProjectId == project.Id, ct);
            var tasks = await db.ProjectTasks.CountAsync(t => t.ProjectId == project.Id, ct);
            var what = project.Recurrence == ProjectRecurrence.None ? project.Name : $"Ciclo {cycle} de {project.Name}";
            var title = project.StartDate == today ? $"{what} começa hoje" : $"{what} começou";
            var parts = new List<string>();
            if (agents > 0)
            {
                parts.Add(agents == 1 ? "1 estação" : $"{agents} estações");
            }
            if (tasks > 0)
            {
                parts.Add(tasks == 1 ? "1 tarefa" : $"{tasks} tarefas");
            }
            if (project.DueDate is { } d)
            {
                parts.Add($"prazo {d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}");
            }
            outbox.Enqueue(project.Id, people, title, parts.Count > 0 ? string.Join(" · ", parts) : project.Name, $"projeto-{project.Id}-ciclo-{cycle}");
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao conferir o inicio dos ciclos dos projetos")]
    private static partial void LogFailed(ILogger logger, Exception exception);
}
