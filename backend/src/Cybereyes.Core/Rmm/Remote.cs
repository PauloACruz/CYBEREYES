namespace Cybereyes.Core.Rmm;

/// <summary>Estados de uma sessao de acesso remoto (docs/remoto/contrato-remoto.md, secao 2.2).</summary>
public static class RemoteSessionState
{
    public const string Starting = "starting";
    public const string WaitingConsent = "waiting-consent";
    public const string Active = "active";
    public const string Ended = "ended";
}

/// <summary>Modos de aviso ao usuario da estacao (contrato, secao 8).</summary>
public static class RemoteConsent
{
    public const string None = "none";
    public const string Notify = "notify";
    public const string Ask = "ask";

    public static bool IsValid(string? value) => value is None or Notify or Ask;
}

/// <summary>Escopos de politica: o efetivo e o mais especifico (site, depois cliente, depois global).</summary>
public static class RemotePolicyScope
{
    public const string Global = "global";
    public const string Client = "client";
    public const string Site = "site";

    public static bool IsValid(string? value) => value is Global or Client or Site;
}

/// <summary>Registro de cada sessao de acesso remoto, para auditoria e historico.</summary>
public sealed class RemoteSession
{
    public long Id { get; set; }
    public required string SessionId { get; set; }
    public int AgentId { get; set; }
    public Guid UserId { get; set; }
    public required string Username { get; set; }
    public int? TicketId { get; set; }
    public required string Channels { get; set; }
    public bool ViewOnly { get; set; }
    public string ConsentMode { get; set; } = RemoteConsent.None;
    public string? ConsentResult { get; set; }
    public string State { get; set; } = RemoteSessionState.Starting;
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FirstFrameAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public string? EndReason { get; set; }
    public string? ViewerIp { get; set; }
    public long BytesToViewer { get; set; }
    public long BytesToAgent { get; set; }
    public int ClipboardToRemote { get; set; }
    public int ClipboardToLocal { get; set; }
}

/// <summary>Arquivo enviado ou baixado numa sessao (contrato, secao 7).</summary>
public sealed class RemoteTransfer
{
    public long Id { get; set; }
    public required string SessionId { get; set; }
    public int AgentId { get; set; }
    public Guid UserId { get; set; }
    public required string Username { get; set; }
    public required string Direction { get; set; }
    public required string RemotePath { get; set; }
    public long SizeBytes { get; set; }
    public string? Sha256 { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public string Status { get; set; } = "running";
    public string? Error { get; set; }
}

/// <summary>
/// Politica do acesso remoto por escopo. Campo nulo herda do escopo de cima; o global tem todos preenchidos.
/// ScopeId e 0 no global.
/// </summary>
public sealed class RemotePolicy
{
    public int Id { get; set; }
    public required string Scope { get; set; }
    public int ScopeId { get; set; }
    public string? Consent { get; set; }
    public int? ConsentTimeoutSeconds { get; set; }
    public bool? AllowAtLoginScreen { get; set; }
    public bool? ClipboardToRemote { get; set; }
    public bool? ClipboardToLocal { get; set; }
    public bool? FilesUpload { get; set; }
    public bool? FilesDownload { get; set; }
    public int? MaxFileMb { get; set; }
    public int? IdleMinutes { get; set; }
    public int? MaxHours { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? UpdatedBy { get; set; }

    /// <summary>Valores padrao do escopo global (contrato, secao 8.1; ADR-023, D-04).</summary>
    public static RemotePolicy Defaults() => new()
    {
        Scope = RemotePolicyScope.Global,
        Consent = RemoteConsent.None,
        ConsentTimeoutSeconds = 60,
        AllowAtLoginScreen = true,
        ClipboardToRemote = true,
        ClipboardToLocal = true,
        FilesUpload = true,
        FilesDownload = true,
        MaxFileMb = 2048,
        IdleMinutes = 30,
        MaxHours = 8,
    };
}
