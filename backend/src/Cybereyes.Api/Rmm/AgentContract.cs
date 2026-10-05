namespace Cybereyes.Api.Rmm;

/// <summary>
/// Nomes do contrato com o agente EYES (agent/ neste repositorio, ver ADR-020).
/// Trocar um valor exige trocar o agente junto: mantidos desde o agente 2.12.0 (ver ADR-019).
/// </summary>
public static class AgentContract
{
    /// <summary>Func NATS que devolve o catalogo de modulos do agente.</summary>
    public const string CareCatalogFunc = "wincare_catalog";

    /// <summary>Func NATS que inicia uma execucao (payload run_id, module, tasks, params).</summary>
    public const string CareRunFunc = "wincare_run";

    /// <summary>Func NATS que cancela uma execucao (payload run_id).</summary>
    public const string CareCancelFunc = "wincare_cancel";

    /// <summary>Func NATS que gera o Health Check.</summary>
    public const string CareHealthFunc = "wincare_health";

    /// <summary>Prefixo do run_id ("wc-" + 32 hex). O agente valida o formato e publica os eventos em &lt;agent_id&gt;.cmdoutput.&lt;run_id&gt;.</summary>
    public const string CareRunIdPrefix = "wc-";

    /// <summary>Valor de "source" da entrada em que o proprio agente avisa que descartou eventos de log.</summary>
    public const string LogSourceAgent = "wincare-agent";

    /// <summary>Evento SignalR do hub /hubs/tray com o andamento do autoatendimento.</summary>
    public const string TraySelfServiceChangedEvent = "selfServiceChanged";
}
