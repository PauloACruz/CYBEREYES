namespace Cybereyes.Core.Rmm;

/// <summary>Tipos de procedimento feitos num agente; a interface traduz cada um.</summary>
public static class ProcedureKind
{
    public const string Remote = "remote";
    public const string Files = "files";
    public const string Care = "care";
    public const string Command = "command";
    public const string Script = "script";
    public const string Terminal = "terminal";
    public const string Rename = "rename";
    public const string Reboot = "reboot";
    public const string Shutdown = "shutdown";
    public const string Service = "service";
    public const string Process = "process";
    public const string Registry = "registry";
    public const string Software = "software";
    public const string Updates = "updates";
    public const string Task = "task";
    public const string Wake = "wake";
    public const string AgentUpdate = "agent_update";
    public const string Startup = "startup";
    public const string SpeedTest = "speedtest";

    public static readonly string[] All =
        [Remote, Files, Care, Command, Script, Terminal, Rename, Reboot, Shutdown, Service, Process, Registry, Software, Updates, Task, Wake, AgentUpdate, Startup,
            SpeedTest];
}

public static class ProcedureStatus
{
    public const string Running = "running";
    public const string Ok = "ok";
    public const string Warning = "warning";
    public const string Error = "error";
    public const string Cancelled = "cancelled";
    public const string Timeout = "timeout";

    public static readonly string[] All = [Running, Ok, Warning, Error, Cancelled, Timeout];
}

public static class ProcedureSource
{
    public const string Console = "console";
    public const string Tray = "tray";
}

/// <summary>Registro de origem que conclui o procedimento depois (sessao remota, execucao do Care, instalacao pendente...).</summary>
public static class ProcedureRef
{
    public const string RemoteSession = "remote_session";
    public const string CareRun = "care_run";
    public const string History = "agent_history";
    public const string PendingAction = "pending_action";
    public const string Terminal = "terminal";
    public const string Task = "task";
    public const string SpeedTest = "speed_test";
}

/// <summary>
/// Procedimento feito num agente (acesso remoto, Cybereyes Care, comando, reinicio...), com quem fez, quando, quanto durou e o
/// resultado. Guarda cliente e hostname para o indicador continuar valendo se o agente for removido. Incluido num chamado, vira um
/// apontamento de horas (<see cref="TimeEntryId"/>) e passa a contar no tempo de servico do chamado.
/// </summary>
public sealed class AgentProcedure
{
    public long Id { get; set; }
    public int? AgentId { get; set; }
    public int ClientId { get; set; }
    public required string Hostname { get; set; }
    public required string Kind { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public string Status { get; set; } = ProcedureStatus.Running;
    public string Source { get; set; } = ProcedureSource.Console;
    public Guid? UserId { get; set; }
    public required string UserName { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public int? DurationSeconds { get; set; }
    public int? TicketId { get; set; }
    public long? TimeEntryId { get; set; }
    public string? RefType { get; set; }
    public string? RefId { get; set; }
}
