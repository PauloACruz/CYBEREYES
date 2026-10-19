namespace Cybereyes.Core.Notifications;

/// <summary>
/// Aparelho (navegador ou app do tecnico) inscrito no Web Push de um usuario, com os avisos que ele quer receber.
/// O endereco e as chaves vem do PushManager do navegador; o servidor so envia mensagens cifradas para ele.
/// </summary>
public sealed class PushSubscription
{
    public long Id { get; set; }
    public Guid UserId { get; set; }
    public required string Endpoint { get; set; }
    public required string P256dh { get; set; }
    public required string Auth { get; set; }
    public string? Device { get; set; }

    /// <summary>Chamado novo aberto num cliente que o usuario ve.</summary>
    public bool NewTickets { get; set; } = true;

    /// <summary>Chamado atribuido ao usuario e mudancas de status ou prioridade nos chamados dele.</summary>
    public bool Updates { get; set; } = true;

    /// <summary>Mensagens nos chamados do usuario (e nos sem responsavel, quando vem do solicitante).</summary>
    public bool Messages { get; set; } = true;

    /// <summary>Analises de erros recorrentes nos logs feitas pelo assistente de IA.</summary>
    public bool Insights { get; set; } = true;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSentAt { get; set; }
}
