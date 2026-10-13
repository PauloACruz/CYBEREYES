namespace Cybereyes.Core.Apps;

public static class SshAuthMethod
{
    public const string Password = "password";
    public const string Key = "key";

    public static readonly string[] All = [Password, Key];
}

public static class WebAppStatus
{
    /// <summary>Ainda sem verificacoes suficientes para dizer se esta no ar.</summary>
    public const string Pending = "pending";
    public const string Up = "up";
    public const string Down = "down";

    /// <summary>Monitoramento desligado na aplicacao.</summary>
    public const string Paused = "paused";

    public static readonly string[] All = [Pending, Up, Down, Paused];
}

public static class WebAppCheckType
{
    public const string Http = "http";
    public const string Tcp = "tcp";

    public static readonly string[] All = [Http, Tcp];
}

public static class AppRunKind
{
    public const string Command = "command";
    public const string Deploy = "deploy";
}

public static class AppRunStatus
{
    public const string Running = "running";
    public const string Success = "success";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
    public const string Timeout = "timeout";
}

/// <summary>Servidor (VPS) acessado por SSH; hospeda uma ou mais aplicacoes.</summary>
public sealed class AppServer
{
    public int Id { get; set; }
    public int ClientId { get; set; }
    public required string Name { get; set; }
    public required string Host { get; set; }
    public int Port { get; set; } = 22;
    public required string Username { get; set; }
    public string AuthMethod { get; set; } = SshAuthMethod.Password;

    /// <summary>Segredos cifrados pelo cofre (AES-256-GCM, chave VAULT_KEY).</summary>
    public string? PasswordEncrypted { get; set; }
    public string? PrivateKeyEncrypted { get; set; }
    public string? PassphraseEncrypted { get; set; }

    /// <summary>SHA256 da chave do servidor (formato do ssh, sem o prefixo), fixada no primeiro acesso.</summary>
    public string? HostKeyFingerprint { get; set; }
    public string? HostKeyAlgorithm { get; set; }
    public string? Provider { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset? LastConnectedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Aplicacao web ou site: monitorada pela URL e, quando tem servidor, com deploy e comandos por SSH.</summary>
public sealed class WebApp
{
    public int Id { get; set; }
    public int ClientId { get; set; }

    /// <summary>Nulo para sites em hospedagem sem SSH: so o monitoramento funciona.</summary>
    public int? ServerId { get; set; }
    public required string Name { get; set; }
    public string? Environment { get; set; }
    public string? Stack { get; set; }
    public string? Url { get; set; }
    public string? Notes { get; set; }

    public bool MonitorEnabled { get; set; } = true;
    public string CheckType { get; set; } = WebAppCheckType.Http;

    /// <summary>URL verificada (http) ou host:porta (tcp).</summary>
    public required string CheckTarget { get; set; }
    public string Method { get; set; } = "GET";

    /// <summary>Codigos aceitos, em faixas e listas: "200-399", "200,204,301-302".</summary>
    public string ExpectedStatus { get; set; } = "200-399";
    public string? Keyword { get; set; }
    public int IntervalSeconds { get; set; } = 60;
    public int TimeoutSeconds { get; set; } = 10;
    public int FailuresBeforeAlert { get; set; } = 2;
    public string AlertSeverity { get; set; } = "error";
    public bool IgnoreTlsErrors { get; set; }

    /// <summary>Dias antes do vencimento do certificado para o aviso; 0 desliga.</summary>
    public int SslWarnDays { get; set; } = 14;

    public string Status { get; set; } = WebAppStatus.Pending;
    public DateTimeOffset? StatusChangedAt { get; set; }
    public DateTimeOffset? LastCheckedAt { get; set; }
    public int? LastLatencyMs { get; set; }
    public int? LastStatusCode { get; set; }
    public string? LastError { get; set; }
    public int ConsecutiveFailures { get; set; }
    public DateTimeOffset NextCheckAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SslExpiresAt { get; set; }

    /// <summary>Pasta da aplicacao no servidor: deploy, comandos e terminal comecam nela.</summary>
    public string? DeployPath { get; set; }
    public string? RepoUrl { get; set; }
    public string? Branch { get; set; }
    public string? DeployScript { get; set; }
    public int DeployTimeoutMinutes { get; set; } = 30;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Resultado de uma verificacao de disponibilidade (guardado por 30 dias).</summary>
public sealed class WebAppCheck
{
    public long Id { get; set; }
    public int WebAppId { get; set; }
    public DateTimeOffset Time { get; set; }
    public bool Up { get; set; }
    public int? LatencyMs { get; set; }
    public int? StatusCode { get; set; }
    public string? Error { get; set; }
}

/// <summary>Comando salvo (snippet) de um servidor ou de uma aplicacao; o da aplicacao roda na pasta dela.</summary>
public sealed class AppCommand
{
    public int Id { get; set; }
    public int? ServerId { get; set; }
    public int? WebAppId { get; set; }
    public required string Name { get; set; }
    public required string Script { get; set; }
    public string? Description { get; set; }

    /// <summary>Pede confirmacao antes de rodar (reiniciar, apagar, etc.).</summary>
    public bool Confirm { get; set; }
    public int TimeoutMinutes { get; set; } = 10;
    public int SortOrder { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }
}

/// <summary>Execucao de comando ou deploy por SSH, com a saida guardada.</summary>
public sealed class AppRun
{
    public long Id { get; set; }
    public int ServerId { get; set; }
    public int? WebAppId { get; set; }
    public int? CommandId { get; set; }
    public string Kind { get; set; } = AppRunKind.Command;
    public required string Title { get; set; }
    public required string Script { get; set; }
    public string Status { get; set; } = AppRunStatus.Running;
    public int? ExitCode { get; set; }
    public string Output { get; set; } = string.Empty;
    public bool OutputTruncated { get; set; }
    public string? Error { get; set; }
    public bool CancelRequested { get; set; }
    public required string StartedBy { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
}
