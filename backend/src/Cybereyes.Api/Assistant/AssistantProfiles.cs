using System.Collections.Concurrent;
using System.Text;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Assistant;

/// <summary>
/// Modelo e instrucoes que valem para uma chamada: <see cref="NativeInstructions"/> sao as do agente nativo, escritas no console, e
/// <see cref="Instructions"/> as do agente vinculado da Anthropic. <see cref="AgentName"/> e nulo quando o agente vinculado nao participa.
/// </summary>
public sealed record AssistantProfile(string Model, string? AgentName, string? Instructions, string? NativeInstructions = null)
{
    /// <summary>Bloco com as instrucoes dos agentes ativos para o prompt de sistema, ou vazio sem instrucoes.</summary>
    public string InstructionsBlock(string purpose)
    {
        if (Instructions is null && NativeInstructions is null)
        {
            return string.Empty;
        }
        var text = new StringBuilder();
        if (NativeInstructions is not null)
        {
            text.Append("<instrucoes_da_empresa>\n").Append(NativeInstructions.Trim()).Append("\n</instrucoes_da_empresa>\n");
        }
        if (Instructions is not null)
        {
            text.Append("<instrucoes_do_agente nome=\"").Append(AgentName).Append("\">\n").Append(Instructions.Trim()).Append("\n</instrucoes_do_agente>\n");
        }
        if (NativeInstructions is not null && Instructions is not null)
        {
            text.Append("Quando as instrucoes da empresa e as do agente conflitarem, valem as da empresa.\n");
        }
        return text
            .Append("Siga as instrucoes acima sobre tom, linguagem e regras da empresa ao ").Append(purpose)
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

    /// <summary>Agente vinculado que participa do atendimento: escolhido e ligado.</summary>
    public static string? LinkedAgentId(CoreSettings settings) =>
        settings.AssistantAgentEnabled && settings.AssistantAgentId is { Length: > 0 } id ? id : null;

    /// <summary>Sem o agente nativo e sem o vinculado, o assistente nao atende nem analisa os logs.</summary>
    public static bool AnyAgentEnabled(CoreSettings settings) => settings.AssistantNativeEnabled || LinkedAgentId(settings) is not null;

    public async Task<AssistantProfile> ResolveAsync(CoreSettings settings, string apiKey, CancellationToken ct)
    {
        var chosen = settings.AssistantModel == AssistantModels.FromAgent ? null : settings.AssistantModel;
        var native = settings.AssistantNativeEnabled && !string.IsNullOrWhiteSpace(settings.AssistantInstructions) ? settings.AssistantInstructions : null;
        var agent = LinkedAgentId(settings) is { } agentId ? await AgentAsync(apiKey, agentId, ct) : null;
        if (agent is null)
        {
            return new AssistantProfile(chosen ?? AssistantModels.Default, null, null, native);
        }
        return new AssistantProfile(chosen ?? agent.Model, agent.Name, string.IsNullOrWhiteSpace(agent.System) ? null : agent.System, native);
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
