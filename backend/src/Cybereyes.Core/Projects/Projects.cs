namespace Cybereyes.Core.Projects;

/// <summary>
/// Situacao guardada do projeto. "Agendado" (o ciclo ainda nao comecou) e "atrasado" (prazo vencido) saem das datas, nao daqui.
/// </summary>
public static class ProjectStatus
{
    public const string Active = "active";
    public const string Paused = "paused";
    public const string Done = "done";
    public const string Cancelled = "cancelled";

    public static readonly string[] All = [Active, Paused, Done, Cancelled];
}

/// <summary>Repeticao do projeto: a cada <see cref="Project.RecurrenceInterval"/> dias, semanas, meses ou anos.</summary>
public static class ProjectRecurrence
{
    public const string None = "none";
    public const string Daily = "daily";
    public const string Weekly = "weekly";
    public const string Monthly = "monthly";
    public const string Yearly = "yearly";

    public static readonly string[] All = [None, Daily, Weekly, Monthly, Yearly];

    /// <summary>Avanca a data em um periodo da repeticao (mensal no dia 31 cai no ultimo dia do mes).</summary>
    public static DateOnly Advance(DateOnly date, string recurrence, int interval) => recurrence switch
    {
        Daily => date.AddDays(interval),
        Weekly => date.AddDays(7 * interval),
        Monthly => date.AddMonths(interval),
        Yearly => date.AddYears(interval),
        _ => date,
    };
}

/// <summary>Situacao de uma estacao ou tarefa no ciclo atual. Concluida e "nao se aplica" contam como encerradas no progresso.</summary>
public static class ProjectItemStatus
{
    public const string Pending = "pending";
    public const string InProgress = "in_progress";
    public const string Done = "done";
    public const string Problem = "problem";
    public const string Skipped = "skipped";

    public static readonly string[] All = [Pending, InProgress, Done, Problem, Skipped];

    public static bool IsFinished(string status) => status is Done or Skipped;
}

/// <summary>Estacao ou tarefa com situacao no ciclo atual e quem a mudou por ultimo.</summary>
public interface IProjectItem
{
    string Status { get; set; }
    string? Note { get; set; }
    Guid? DoneById { get; set; }
    string? DoneByName { get; set; }
    DateTimeOffset? DoneAt { get; set; }
}

public static class ProjectNoteKind
{
    /// <summary>Registro escrito por alguem (texto e anexos).</summary>
    public const string Note = "note";

    /// <summary>Mudanca de situacao de estacao ou tarefa, gravada sozinha.</summary>
    public const string Status = "status";

    /// <summary>Acontecimento do projeto: criacao, ciclo concluido, pausa, retomada...</summary>
    public const string Event = "event";
}

/// <summary>
/// Projeto: tarefas com responsaveis e, opcionalmente, um escopo de clientes, setores (sites) e estacoes onde o trabalho e feito.
/// Recorrente, cada ciclo e concluido, vai para o historico (<see cref="ProjectCycle"/>) e o seguinte recomeca com tudo pendente.
/// </summary>
public sealed class Project
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = ProjectStatus.Active;

    /// <summary>Responsavel pelo projeto.</summary>
    public Guid? OwnerId { get; set; }

    public string Recurrence { get; set; } = ProjectRecurrence.None;
    public int RecurrenceInterval { get; set; } = 1;

    /// <summary>Numero do ciclo atual (1 no projeto que nao se repete).</summary>
    public int Cycle { get; set; } = 1;

    /// <summary>Inicio agendado do ciclo atual.</summary>
    public DateOnly? StartDate { get; set; }

    /// <summary>Prazo do ciclo atual.</summary>
    public DateOnly? DueDate { get; set; }

    public Guid? CreatedById { get; set; }
    public required string CreatedByName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>Ciclo cujo inicio ja foi avisado (lembrete do dia do inicio); nulo quando o atual ainda nao foi.</summary>
    public int? StartNotifiedCycle { get; set; }
}

/// <summary>Cliente envolvido no projeto: os escolhidos e os das estacoes e setores escolhidos. Define quem enxerga o projeto.</summary>
public sealed class ProjectClient
{
    public int ProjectId { get; set; }
    public int ClientId { get; set; }
}

/// <summary>Setor (site) escolhido para o projeto.</summary>
public sealed class ProjectSite
{
    public int ProjectId { get; set; }
    public int SiteId { get; set; }
}

/// <summary>
/// Estacao no escopo do projeto e a situacao dela no ciclo atual. Guarda hostname e cliente para o historico continuar legivel se o
/// agente for removido.
/// </summary>
public sealed class ProjectAgent : IProjectItem
{
    public long Id { get; set; }
    public int ProjectId { get; set; }
    public int? AgentId { get; set; }
    public int ClientId { get; set; }
    public required string Hostname { get; set; }
    public string Status { get; set; } = ProjectItemStatus.Pending;
    public string? Note { get; set; }
    public Guid? DoneById { get; set; }
    public string? DoneByName { get; set; }
    public DateTimeOffset? DoneAt { get; set; }
}

/// <summary>Tarefa do projeto com responsavel, prazo e a situacao no ciclo atual.</summary>
public sealed class ProjectTask : IProjectItem
{
    public long Id { get; set; }
    public int ProjectId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public Guid? AssigneeId { get; set; }
    public DateOnly? DueDate { get; set; }
    public int Position { get; set; }
    public string Status { get; set; } = ProjectItemStatus.Pending;
    public string? Note { get; set; }
    public Guid? DoneById { get; set; }
    public string? DoneByName { get; set; }
    public DateTimeOffset? DoneAt { get; set; }
}

/// <summary>Ciclo concluido de um projeto recorrente (ou o unico, no que nao se repete), com o resultado de cada estacao e tarefa.</summary>
public sealed class ProjectCycle
{
    public long Id { get; set; }
    public int ProjectId { get; set; }
    public int Number { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public DateTimeOffset ClosedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? ClosedById { get; set; }
    public required string ClosedByName { get; set; }
    public string? Summary { get; set; }

    /// <summary>Resultado de cada estacao e tarefa (JSON, lista de ProjectCycleItem da API).</summary>
    public string Items { get; set; } = "[]";
}

/// <summary>Registro da documentacao do projeto: texto livre, mudanca de situacao ou acontecimento, com anexos.</summary>
public sealed class ProjectNote
{
    public long Id { get; set; }
    public int ProjectId { get; set; }
    public int Cycle { get; set; }
    public string Kind { get; set; } = ProjectNoteKind.Note;
    public long? ProjectAgentId { get; set; }
    public long? ProjectTaskId { get; set; }

    /// <summary>Estacao ou tarefa no momento do registro (continua legivel se ela sair do projeto).</summary>
    public string? Subject { get; set; }

    /// <summary>Situacao registrada, nas notas que mudam a situacao.</summary>
    public string? ItemStatus { get; set; }

    public string Body { get; set; } = string.Empty;
    public Guid? AuthorId { get; set; }
    public required string AuthorName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ProjectAttachment
{
    public long Id { get; set; }
    public int ProjectId { get; set; }
    public long? NoteId { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public required string UploadedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Conteudo do anexo em tabela separada para que listagens nao carreguem os bytes.</summary>
public sealed class ProjectAttachmentData
{
    public long AttachmentId { get; set; }
    public required byte[] Content { get; set; }
}
