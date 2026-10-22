namespace Cybereyes.Core.Rmm;

/// <summary>
/// Teste de velocidade pedido no console e medido pelo EYES (3.4.0+). O agente informa o andamento e, no fim, o relatorio
/// completo (<see cref="Report"/>, JSON normalizado pela API); os numeros principais ficam em colunas para o historico.
/// </summary>
public sealed class AgentSpeedTest
{
    public long Id { get; set; }
    public int AgentId { get; set; }
    public string Mode { get; set; } = SpeedTestMode.Full;
    public string Status { get; set; } = SpeedTestStatus.Pending;
    public string? Phase { get; set; }
    public int Progress { get; set; }
    public double? LiveMbps { get; set; }
    public string RequestedBy { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>Velocidade contratada informada por quem pediu o teste, para comparar com a entregue.</summary>
    public double? PlanDownloadMbps { get; set; }
    public double? PlanUploadMbps { get; set; }

    public double? DownloadMbps { get; set; }
    public double? UploadMbps { get; set; }
    public double? LatencyMs { get; set; }
    public double? JitterMs { get; set; }
    public double? LossPct { get; set; }
    public string? Report { get; set; }
    public string? Error { get; set; }
}

public static class SpeedTestMode
{
    public const string Full = "full";
    public const string Quick = "quick";
}

public static class SpeedTestStatus
{
    public const string Pending = "pending";
    public const string Running = "running";
    public const string Completed = "completed";
    public const string Failed = "failed";

    public static bool IsActive(string status) => status is Pending or Running;
}
