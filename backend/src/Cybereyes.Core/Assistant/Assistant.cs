namespace Cybereyes.Core.Assistant;

/// <summary>Modelos do Claude que o assistente pode usar; o primeiro e o padrao.</summary>
public static class AssistantModels
{
    public const string Default = "claude-opus-5-5";

    /// <summary>Usa o modelo configurado no agente vinculado da conta da Anthropic.</summary>
    public const string FromAgent = "agent";

    public static readonly string[] All = [Default, "claude-sonnet-5-5", "claude-haiku-5-5"];

    /// <summary>Niveis de esforco (output_config.effort), do mais rapido ao mais profundo.</summary>
    public static readonly string[] Efforts = ["low", "medium", "high", "xhigh", "max"];
}

/// <summary>Agentes que executam os pedidos dos tecnicos no console (menu Agente de IA).</summary>
public static class AssistantExecutors
{
    /// <summary>Agente nativo do Cybereyes: instrucoes escritas no console.</summary>
    public const string Native = "native";

    /// <summary>Agente vinculado da conta da Anthropic.</summary>
    public const string Anthropic = "anthropic";

    public static readonly string[] All = [Native, Anthropic];

    /// <summary>Permissoes que cada agente comeca tendo: so leitura. A equipe libera o resto em Configuracoes > Assistente de IA.</summary>
    public static readonly string[] DefaultPermissions =
    [
        "clients.view", "agents.view", "alerts.view", "tickets.view", "logs.view", "scripts.view", "docs.view", "inventory.view",
    ];
}

public static class AssistantSessionStatus
{
    public const string Running = "running";

    /// <summary>O agente pediu uma acao que muda maquinas e espera o tecnico aprovar ou recusar.</summary>
    public const string AwaitingApproval = "awaiting_approval";

    public const string Idle = "idle";
    public const string Failed = "failed";
}

/// <summary>
/// Conversa de um tecnico com o agente de IA no console. <see cref="Messages"/> guarda a conversa no formato da Messages API
/// (texto, pedidos de ferramenta e resultados) e <see cref="Pending"/> as acoes que esperam aprovacao.
/// </summary>
public sealed class AssistantSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Executor { get; set; }
    public required string ExecutorName { get; set; }
    public required string Title { get; set; }
    public string Status { get; set; } = AssistantSessionStatus.Idle;
    public string Messages { get; set; } = "[]";
    public string? Pending { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Situacao do atendimento do assistente num chamado aberto pelo app de bandeja.</summary>
public static class AssistantStates
{
    /// <summary>O assistente conversa com o solicitante ate um tecnico assumir.</summary>
    public const string Active = "active";

    /// <summary>Encaminhado para a equipe: o chat continua aberto, mas o assistente nao responde mais.</summary>
    public const string Handoff = "handoff";

    /// <summary>O solicitante confirmou que o passo a passo resolveu.</summary>
    public const string Done = "done";
}

public static class FaqTags
{
    /// <summary>Entrada que o assistente pode mandar ao cliente como passo a passo.</summary>
    public const string Guide = "orientar";
}

/// <summary>Situacao da entrada: so as publicadas valem para o assistente, para os tecnicos e para o app EYES.</summary>
public static class FaqStatus
{
    public const string Published = "published";

    /// <summary>Sugestao do assistente, de um tecnico sem permissao de editar ou de um usuario do app, aguardando revisao.</summary>
    public const string Proposed = "proposed";

    public static readonly string[] All = [Published, Proposed];
}

/// <summary>Quem criou a entrada.</summary>
public static class FaqSource
{
    public const string Team = "team";

    /// <summary>O assistente escreveu a partir de um chamado resolvido.</summary>
    public const string Assistant = "assistant";

    /// <summary>Pergunta enviada por um usuario pelo app EYES.</summary>
    public const string Requester = "requester";
}

/// <summary>Pergunta frequente com a solucao. Sem cliente vale para todos; com cliente, so para os chamados dele.</summary>
public sealed class FaqEntry
{
    public int Id { get; set; }
    public int? ClientId { get; set; }
    public required string Question { get; set; }
    public string Answer { get; set; } = string.Empty;
    public List<string> Tags { get; set; } = [];
    public bool Enabled { get; set; } = true;

    /// <summary>Assunto para navegar no FAQ (Impressoras, E-mail...); nulo fica em "Sem categoria".</summary>
    public string? Category { get; set; }

    public string Status { get; set; } = FaqStatus.Published;

    /// <summary>Aparece para os usuarios na ajuda do app EYES.</summary>
    public bool Public { get; set; }

    public string Source { get; set; } = FaqSource.Team;

    /// <summary>Chamado de onde a entrada saiu (sugestao do assistente ou de um tecnico).</summary>
    public int? SourceTicketId { get; set; }

    /// <summary>Quem sugeriu: tecnico, assistente ou "usuario em MAQUINA".</summary>
    public string? SuggestedBy { get; set; }

    /// <summary>Aberturas na ajuda do app EYES.</summary>
    public int Views { get; set; }

    public int HelpfulCount { get; set; }
    public int NotHelpfulCount { get; set; }

    /// <summary>Vezes que o assistente mandou o passo a passo ou um tecnico inseriu a resposta num chamado.</summary>
    public int UsedCount { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }

    public bool Guides => Tags.Contains(FaqTags.Guide, StringComparer.OrdinalIgnoreCase);
}

public static class LogInsightStatus
{
    public const string Ok = "ok";
    public const string Error = "error";
}

/// <summary>
/// Analise dos erros recorrentes nos logs feita pelo assistente. <see cref="Content"/> guarda o JSON com os grupos de
/// eventos (contagens e o que o modelo disse de cada um) e as sugestoes de uso da plataforma.
/// </summary>
public sealed class LogInsightReport
{
    public long Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset WindowStart { get; set; }
    public DateTimeOffset WindowEnd { get; set; }
    public string Status { get; set; } = LogInsightStatus.Ok;
    public bool Manual { get; set; }
    public string Model { get; set; } = AssistantModels.Default;
    public string Summary { get; set; } = string.Empty;
    public string Content { get; set; } = "{}";
    public int EventCount { get; set; }
    public int GroupCount { get; set; }
    public int AgentCount { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public string? Error { get; set; }
}
