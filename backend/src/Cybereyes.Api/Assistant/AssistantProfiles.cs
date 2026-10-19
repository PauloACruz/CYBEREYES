using System.Collections.Concurrent;
using System.Text;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Assistant;

/// <summary>Modelo e instrucoes que valem para uma chamada; <see cref="AgentName"/> e nulo quando nao ha agente vinculado.</summary>
public sealed record AssistantProfile(string Model, string? AgentName, string? Instructions)
{
    /// <summary>Bloco com as instrucoes do agente para o prompt de sistema, ou vazio sem agente.</summary>
    public string InstructionsBlock(string purpose)
    {
        if (Instructions is null)
        {
            return string.Empty;
        }
        return new StringBuilder()
            .Append("<instrucoes_do_agente nome=\"").Append(AgentName).Append("\">\n")
            .Append(Instructions.Trim())
            .Append("\n</instrucoes_do_agente>\n")
            .Append("Siga as instrucoes do agente acima sobre tom, linguagem e regras da empresa ao ").Append(purpose)
            .Append(". Quando elas conflitarem com as regras de formato, de acao e de FAQ deste prompt, valem as deste prompt.\n\n")
            .ToString();
    }
}

/// <summary>
/// Resolve o agente vinculado da conta da Anthropic: o prompt de sistema dele entra junto com as regras do Cybereyes e o
/// modelo dele vale quando a configuracao manda usar o do agente. Guarda o agente por 5 minutos; se a Anthropic nao responder,
/// o assistente segue com as instrucoes e o modelo padrao em vez de parar.
/// </summary>
public sealed partial class AssistantProfiles(IAssistantModel model, TimeProvider time, ILogger<AssistantProfiles> logger)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (AssistantAgent Agent, DateTimeOffset At)> cache = new(StringComparer.Ordinal);

    public static string Effort(string? value, string fallback) => value is not null && AssistantModels.Efforts.Contains(value) ? value : fallback;

    public async Task<AssistantProfile> ResolveAsync(CoreSettings settings, string apiKey, CancellationToken ct)
    {
        var chosen = settings.AssistantModel == AssistantModels.FromAgent ? null : settings.AssistantModel;
        if (settings.AssistantAgentId is not { Length: > 0 } agentId)
        {
            return new AssistantProfile(chosen ?? AssistantModels.Default, null, null);
        }
        var agent = await AgentAsync(apiKey, agentId, ct);
        if (agent is null)
        {
            return new AssistantProfile(chosen ?? AssistantModels.Default, null, null);
        }
        return new AssistantProfile(chosen ?? agent.Model, agent.Name, string.IsNullOrWhiteSpace(agent.System) ? null : agent.System);
    }

    private async Task<AssistantAgent?> AgentAsync(string apiKey, string agentId, CancellationToken ct)
    {
        if (cache.TryGetValue(agentId, out var hit) && time.GetUtcNow() - hit.At < Ttl)
        {
            return hit.Agent;
        }
        try
        {
            var agent = await model.GetAgentAsync(apiKey, agentId, ct);
            cache[agentId] = (agent, time.GetUtcNow());
            return agent;
        }
        catch (AssistantException ex)
        {
            LogAgentFailed(logger, ex, agentId);
            return null;
        }
    }

    /// <summary>Configuracao salva (chave ou agente trocados): a proxima chamada busca o agente de novo.</summary>
    public void Forget() => cache.Clear();

    [LoggerMessage(Level = LogLevel.Warning, Message = "Nao foi possivel ler o agente vinculado {AgentId}; o assistente segue com as instrucoes padrao")]
    private static partial void LogAgentFailed(ILogger logger, Exception ex, string agentId);
}
