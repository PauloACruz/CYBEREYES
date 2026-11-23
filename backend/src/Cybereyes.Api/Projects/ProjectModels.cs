using System.ComponentModel.DataAnnotations;

namespace Cybereyes.Api.Projects;

/// <summary>
/// Projeto novo ou editado. Escopo opcional: clientes, setores (sites) e estacoes; os clientes dos setores e das estacoes entram
/// sozinhos. Recorrente exige a data de inicio. <see cref="Tasks"/> so vale na criacao (depois, pelas rotas de tarefa).
/// </summary>
public sealed record SaveProjectRequest(
    [property: Required, StringLength(200, MinimumLength = 2)] string Name,
    [property: StringLength(20000)] string? Description,
    Guid? OwnerId,
    string? Recurrence,
    [property: Range(1, 365)] int? RecurrenceInterval,
    DateOnly? StartDate,
    DateOnly? DueDate,
    List<int>? ClientIds,
    List<int>? SiteIds,
    List<int>? AgentIds,
    List<SaveProjectTaskRequest>? Tasks = null);

public sealed record SaveProjectTaskRequest(
    [property: Required, StringLength(300, MinimumLength = 1)] string Title,
    [property: StringLength(4000)] string? Description,
    Guid? AssigneeId,
    DateOnly? DueDate);

public sealed record ProjectStatusRequest([property: Required] string Status);

/// <summary>Situacao de varias estacoes e/ou tarefas de uma vez, com uma observacao opcional.</summary>
public sealed record ProjectProgressRequest(
    List<long>? AgentRowIds,
    List<long>? TaskIds,
    [property: Required] string Status,
    [property: StringLength(2000)] string? Note);

/// <summary>Registro na documentacao; com estacao ou tarefa e situacao, tambem muda a situacao dela.</summary>
public sealed record CreateProjectNoteRequest(
    [property: StringLength(20000)] string? Body,
    long? ProjectAgentId,
    long? ProjectTaskId,
    string? Status);

/// <summary>Conclui o ciclo atual. Recorrente, o proximo comeca; <see cref="Finish"/> encerra o projeto em vez disso.</summary>
public sealed record CloseProjectCycleRequest([property: StringLength(4000)] string? Summary, bool Finish = false);

public sealed record ProjectRef(int Id, string Name);

public sealed record ProjectUserRef(Guid Id, string Name);

public sealed record ProjectProgressDto(int AgentsTotal, int AgentsFinished, int TasksTotal, int TasksFinished, int Problems, int OverdueTasks);

/// <summary>
/// Projeto na lista. Phase: scheduled (ciclo ainda nao comecou), in_progress, late (prazo vencido), paused, done ou cancelled.
/// </summary>
public sealed record ProjectSummaryDto(int Id, string Name, string Status, string Phase, ProjectUserRef? Owner, string Recurrence, int RecurrenceInterval,
    int Cycle, DateOnly? StartDate, DateOnly? DueDate, IReadOnlyList<ProjectRef> Clients, ProjectProgressDto Progress, int MyOpenTasks,
    DateTimeOffset UpdatedAt);

public sealed record ProjectSiteDto(int Id, string Name, int ClientId, string ClientName);

public sealed record ProjectAgentDto(long Id, int? AgentId, string Hostname, int ClientId, string? ClientName, int? SiteId, string? SiteName,
    string? Description, string? AgentStatus, string Status, string? Note, string? DoneByName, DateTimeOffset? DoneAt);

public sealed record ProjectTaskDto(long Id, string Title, string? Description, ProjectUserRef? Assignee, DateOnly? DueDate, int Position, string Status,
    string? Note, string? DoneByName, DateTimeOffset? DoneAt, bool Overdue, bool CanUpdate);

/// <summary>O que quem consulta pode fazer: manage (editar tudo) e record (registrar andamento e documentar).</summary>
public sealed record ProjectAbilitiesDto(bool Manage, bool Record);

public sealed record ProjectDetailDto(int Id, string Name, string Description, string Status, string Phase, ProjectUserRef? Owner, string Recurrence,
    int RecurrenceInterval, int Cycle, DateOnly? StartDate, DateOnly? DueDate, DateOnly? NextStartDate, IReadOnlyList<ProjectRef> Clients,
    IReadOnlyList<ProjectSiteDto> Sites, IReadOnlyList<ProjectAgentDto> Agents, IReadOnlyList<ProjectTaskDto> Tasks, ProjectProgressDto Progress,
    int ClosedCycles, string CreatedByName, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? CompletedAt, ProjectAbilitiesDto Can);

public sealed record ProjectAttachmentDto(long Id, string FileName, string ContentType, long Size);

public sealed record ProjectNoteDto(long Id, int Cycle, string Kind, long? ProjectAgentId, long? ProjectTaskId, string? Subject, string? ItemStatus,
    string Body, Guid? AuthorId, string AuthorName, DateTimeOffset CreatedAt, IReadOnlyList<ProjectAttachmentDto> Attachments, bool CanDelete);

/// <summary>Resultado de uma estacao (kind agent) ou tarefa (kind task) num ciclo concluido.</summary>
public sealed record ProjectCycleItem(string Kind, string Title, string? Detail, string Status, string? Note, string? DoneByName, DateTimeOffset? DoneAt);

public sealed record ProjectCycleDto(long Id, int Number, DateOnly? StartDate, DateOnly? DueDate, DateTimeOffset ClosedAt, string ClosedByName,
    string? Summary, IReadOnlyList<ProjectCycleItem> Items);

public sealed record ProjectOptionSite(int Id, string Name);

public sealed record ProjectOptionClient(int Id, string Name, IReadOnlyList<ProjectOptionSite> Sites);

public sealed record ProjectOptionAgent(int Id, string Hostname, int ClientId, int SiteId, string? Description, string Status);

/// <summary>Listas do formulario: quem pode ser responsavel, clientes com setores e estacoes do escopo de quem consulta.</summary>
public sealed record ProjectOptionsDto(IReadOnlyList<ProjectUserRef> Users, IReadOnlyList<ProjectOptionClient> Clients, IReadOnlyList<ProjectOptionAgent> Agents);

/// <summary>Projeto de que a estacao faz parte, com a situacao dela no ciclo atual (aba Projetos do agente).</summary>
public sealed record AgentProjectDto(int Id, string Name, string Phase, int Cycle, DateOnly? DueDate, string ItemStatus, string? DoneByName,
    DateTimeOffset? DoneAt);
