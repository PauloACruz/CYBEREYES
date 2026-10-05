namespace Cybereyes.Core.Rmm;

public static class ScriptShells
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
        { "powershell", "cmd", "python", "shell", "nushell", "deno" };

    public static readonly IReadOnlySet<string> Platforms = new HashSet<string>(StringComparer.Ordinal) { "windows", "linux", "darwin" };
}

public sealed class Script
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public required string Shell { get; set; }
    public required string Body { get; set; }
    public List<string> DefaultArgs { get; set; } = [];
    public List<string> EnvVars { get; set; } = [];
    public int DefaultTimeout { get; set; } = 90;
    public bool RunAsUser { get; set; }
    public List<string> Platforms { get; set; } = [];
    public required string CreatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ScriptSnippet
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = string.Empty;
    public required string Shell { get; set; }
    public required string Code { get; set; }
}

public sealed class GlobalKey
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Value { get; set; }
}

public sealed class UrlAction
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = string.Empty;
    public required string Pattern { get; set; }
}

public static class AgentHistoryType
{
    public const string CommandRun = "cmd_run";
    public const string ScriptRun = "script_run";
    public const string TaskRun = "task_run";
}

public sealed class AgentHistory
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public Agent? Agent { get; set; }
    public DateTimeOffset Time { get; set; } = DateTimeOffset.UtcNow;
    public required string Type { get; set; }
    public string Command { get; set; } = string.Empty;
    public required string Username { get; set; }
    public int? ScriptId { get; set; }
    public string? ScriptName { get; set; }
    public string? Results { get; set; }
    public string? ScriptResults { get; set; }
}
