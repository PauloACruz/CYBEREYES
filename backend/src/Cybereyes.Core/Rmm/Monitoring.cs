namespace Cybereyes.Core.Rmm;

public static class CheckTypes
{
    public const string DiskSpace = "diskspace";
    public const string CpuLoad = "cpuload";
    public const string Memory = "memory";
    public const string Ping = "ping";
    public const string Script = "script";
    public const string WinSvc = "winsvc";
    public const string EventLog = "eventlog";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
        { DiskSpace, CpuLoad, Memory, Ping, Script, WinSvc, EventLog };
}

public static class CheckStatus
{
    public const string Passing = "passing";
    public const string Failing = "failing";
    public const string Pending = "pending";
}

public static class Severity
{
    public const string Info = "info";
    public const string Warning = "warning";
    public const string Error = "error";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Info, Warning, Error };
}

public sealed class Policy
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Check
{
    public int Id { get; set; }
    public int? AgentId { get; set; }
    public int? PolicyId { get; set; }
    public required string CheckType { get; set; }
    public string Name { get; set; } = string.Empty;
    public int RunInterval { get; set; }
    public int FailsBeforeAlert { get; set; } = 1;
    public string AlertSeverity { get; set; } = Severity.Warning;
    public int WarningThreshold { get; set; }
    public int ErrorThreshold { get; set; }
    public string? Disk { get; set; }
    public string? Ip { get; set; }
    public int? ScriptId { get; set; }
    public List<string> ScriptArgs { get; set; } = [];
    public List<string> EnvVars { get; set; } = [];
    public int? Timeout { get; set; }
    public List<long> InfoReturnCodes { get; set; } = [];
    public List<long> WarningReturnCodes { get; set; } = [];
    public List<long> SuccessReturnCodes { get; set; } = [];
    public string? SvcName { get; set; }
    public bool PassIfStartPending { get; set; }
    public bool PassIfSvcNotExist { get; set; }
    public bool RestartIfStopped { get; set; }
    public string? LogName { get; set; }
    public int? EventId { get; set; }
    public bool EventIdIsWildcard { get; set; }
    public string? EventType { get; set; }
    public string? EventSource { get; set; }
    public string? EventMessage { get; set; }
    public string FailWhen { get; set; } = "contains";
    public int SearchLastDays { get; set; } = 1;
    public int NumberOfEventsBeforeAlert { get; set; } = 1;
    public bool EmailAlert { get; set; }
    public bool WebhookAlert { get; set; }
    public bool DashboardAlert { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CheckResult
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public int CheckId { get; set; }
    public string Status { get; set; } = CheckStatus.Pending;
    public string? AlertSeverity { get; set; }
    public string? MoreInfo { get; set; }
    public DateTimeOffset? LastRun { get; set; }
    public int FailCount { get; set; }
    public string? Stdout { get; set; }
    public string? Stderr { get; set; }
    public long? Retcode { get; set; }
    public double? ExecutionTime { get; set; }
    public List<int> History { get; set; } = [];
    public string? ExtraDetails { get; set; }
}

public sealed class CheckHistory
{
    public long Id { get; set; }
    public int CheckId { get; set; }
    public int AgentId { get; set; }
    public DateTimeOffset Time { get; set; } = DateTimeOffset.UtcNow;
    public double Value { get; set; }
    public string Status { get; set; } = CheckStatus.Passing;
    public string? Results { get; set; }
}

public static class TaskSchedules
{
    public const string Manual = "manual";
    public const string Once = "once";
    public const string Daily = "daily";
    public const string Weekly = "weekly";
    public const string Monthly = "monthly";
    public const string CheckFailure = "check_failure";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Manual, Once, Daily, Weekly, Monthly, CheckFailure };
}

public sealed class AutomatedTask
{
    public int Id { get; set; }
    public int? AgentId { get; set; }
    public int? PolicyId { get; set; }
    public required string Name { get; set; }
    public bool Enabled { get; set; } = true;
    public bool ContinueOnError { get; set; } = true;
    public string AlertSeverity { get; set; } = Severity.Warning;
    public required string Actions { get; set; }
    public string ScheduleType { get; set; } = TaskSchedules.Manual;
    public DateTimeOffset? RunAt { get; set; }
    public string? Time { get; set; }
    public List<int> DaysOfWeek { get; set; } = [];
    public int? DayOfMonth { get; set; }
    public int? AssignedCheckId { get; set; }
    public bool EmailAlert { get; set; }
    public bool WebhookAlert { get; set; }
    public bool DashboardAlert { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class TaskResult
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public int TaskId { get; set; }
    public string Status { get; set; } = CheckStatus.Pending;
    public long? Retcode { get; set; }
    public string? Stdout { get; set; }
    public string? Stderr { get; set; }
    public double? ExecutionTime { get; set; }
    public DateTimeOffset? LastRun { get; set; }
}

/// <summary>Registro de disparo agendado: a chave unica impede que duas replicas disparem o mesmo horario.</summary>
public sealed class TaskDispatch
{
    public long Id { get; set; }
    public int TaskId { get; set; }
    public int AgentId { get; set; }
    public DateTimeOffset Slot { get; set; }
}

public static class AlertTypes
{
    public const string Availability = "availability";
    public const string Check = "check";
    public const string Task = "task";
    public const string Log = "log";
    public const string SnmpDevice = "snmp_device";
    public const string SnmpInterface = "snmp_interface";
    public const string SnmpSensor = "snmp_sensor";
    public const string SnmpTrap = "snmp_trap";
}

public sealed class Alert
{
    public long Id { get; set; }
    public int? AgentId { get; set; }
    public Agent? Agent { get; set; }
    public int? SnmpDeviceId { get; set; }
    public SnmpDevice? SnmpDevice { get; set; }

    /// <summary>Distingue alertas do mesmo tipo na mesma origem (regra de log, interface, sensor).</summary>
    public string? SubjectKey { get; set; }
    public required string AlertType { get; set; }
    public int? CheckId { get; set; }
    public int? TaskId { get; set; }
    public required string Severity { get; set; }
    public required string Message { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool Resolved { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public DateTimeOffset? SnoozedUntil { get; set; }
    public bool EmailSent { get; set; }
    public bool WebhookSent { get; set; }
}

public sealed class AlertTemplate
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public List<string> EmailRecipients { get; set; } = [];
    public string? WebhookUrl { get; set; }
    public List<string> EmailSeverities { get; set; } = [Severity.Error];
    public List<string> WebhookSeverities { get; set; } = [Severity.Error];
    public List<string> DashboardSeverities { get; set; } = [Severity.Info, Severity.Warning, Severity.Error];
    public bool NotifyOnResolved { get; set; }
    public bool AgentOverdueEmail { get; set; }
    public bool AgentOverdueWebhook { get; set; }
    public bool AgentOverdueDashboard { get; set; } = true;
}

public sealed class WinUpdate
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public required string UpdateGuid { get; set; }
    public string Kb { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public List<string> Categories { get; set; } = [];
    public List<string> KbArticleIds { get; set; } = [];
    public List<string> MoreInfoUrls { get; set; } = [];
    public string SupportUrl { get; set; } = string.Empty;
    public long RevisionNumber { get; set; }
    public bool Installed { get; set; }
    public bool Downloaded { get; set; }
    public string Action { get; set; } = "nothing";
    public string Result { get; set; } = "n/a";
    public DateTimeOffset? DateInstalled { get; set; }
}

public sealed class PatchPolicy
{
    public int Id { get; set; }
    public int? PolicyId { get; set; }
    public int? AgentId { get; set; }
    public string Critical { get; set; } = "manual";
    public string Important { get; set; } = "manual";
    public string Moderate { get; set; } = "manual";
    public string Low { get; set; } = "manual";
    public string Other { get; set; } = "manual";
    public List<int> RunTimeDays { get; set; } = [];
    public int RunTimeHour { get; set; } = 3;
    public string RebootAfterInstall { get; set; } = "never";
}

public sealed class PendingAction
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public required string Type { get; set; }
    public required string Details { get; set; }
    public string Status { get; set; } = "pending";
    public string? Output { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CoreSettings
{
    public int Id { get; set; } = 1;
    public string? SmtpHost { get; set; }
    public int SmtpPort { get; set; } = 587;
    public string? SmtpUsername { get; set; }
    public string? SmtpPasswordProtected { get; set; }
    public string? SmtpFrom { get; set; }
    public bool SmtpUseTls { get; set; } = true;
    public string? DefaultWebhookUrl { get; set; }
    public string TimeZone { get; set; } = "America/Sao_Paulo";
    public int CheckHistoryDays { get; set; } = 30;
    public int AgentHistoryDays { get; set; } = 60;
    public int? DefaultServerPolicyId { get; set; }
    public int? DefaultWorkstationPolicyId { get; set; }
    public int? DefaultAlertTemplateId { get; set; }
    public bool IncidentsEnabled { get; set; } = true;
    public List<string> IncidentSeverities { get; set; } = [Severity.Error];
    public string IncidentPriority { get; set; } = "high";
    public int? IncidentQueueId { get; set; }
    public bool IncidentResolveWithAlert { get; set; } = true;
    public bool SelfServiceEnabled { get; set; }
    public List<string> SelfServiceTasks { get; set; } = [];
    public bool LogsEnabled { get; set; } = true;
    public string LogMinLevel { get; set; } = LogLevels.Warning;
    public List<string> LogWindowsLogs { get; set; } = ["System", "Application"];
    public int LogMaxPerCycle { get; set; } = 500;
    public int LogRetentionDays { get; set; } = 30;
    public bool DisablePasswordLogin { get; set; }
}
