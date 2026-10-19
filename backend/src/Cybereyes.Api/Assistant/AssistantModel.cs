using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Agents;
using Anthropic.Models.Beta.Messages;

namespace Cybereyes.Api.Assistant;

/// <summary>Pedido ao modelo: instrucoes fixas (vao para o cache), conteudo variavel e o esquema JSON da resposta.</summary>
public sealed record AssistantCall(string ApiKey, string Model, string System, string Prompt, JsonElement Schema, string Effort, int MaxTokens);

public sealed record AssistantAnswer(JsonElement Output, long InputTokens, long OutputTokens);

/// <summary>Agente da conta da Anthropic (Managed Agents): o assistente usa o prompt de sistema e o modelo dele.</summary>
public sealed record AssistantAgent(string Id, string Name, string? Description, string Model, string? System, long Version);

/// <summary>Falha ao falar com o modelo, com a mensagem pronta para a tela ou para o registro do relatorio.</summary>
public sealed class AssistantException(string message, Exception? inner = null) : Exception(message, inner);

public interface IAssistantModel
{
    /// <summary>Gera uma resposta no formato do esquema; o JSON vem validado pelo proprio modelo (structured outputs).</summary>
    Task<AssistantAnswer> GenerateAsync(AssistantCall request, CancellationToken ct);

    /// <summary>Confere a chave e o modelo pela API de modelos, sem gastar tokens.</summary>
    Task VerifyAsync(string apiKey, string model, CancellationToken ct);

    /// <summary>Agentes nao arquivados da conta da chave.</summary>
    Task<IReadOnlyList<AssistantAgent>> ListAgentsAsync(string apiKey, CancellationToken ct);

    Task<AssistantAgent> GetAgentAsync(string apiKey, string agentId, CancellationToken ct);

    Task<AssistantAgent> CreateAgentAsync(string apiKey, string name, string description, string model, string system, CancellationToken ct);
}

/// <summary>Claude pela API da Anthropic (SDK oficial). Um cliente por chave, reaproveitado entre as chamadas.</summary>
public sealed class AnthropicAssistantModel : IAssistantModel, IDisposable
{
    // Recusa de um classificador volta como stop_reason "refusal"; o modo "default" reenvia ao modelo recomendado.
    private const string FallbackBeta = "server-side-fallback-2026-07-01";

    // Modelos com fallback no servidor; o agente vinculado pode usar outro, que vai sem ele.
    private static readonly HashSet<string> FallbackModels = new(StringComparer.Ordinal)
    {
        "claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5",
    };

    private readonly Lock gate = new();
    private (string Key, AnthropicClient Client)? cached;

    public async Task<AssistantAnswer> GenerateAsync(AssistantCall request, CancellationToken ct)
    {
        var parameters = new MessageCreateParams
        {
            Model = request.Model,
            MaxTokens = request.MaxTokens,
            System = new List<BetaTextBlockParam> { new() { Text = request.System, CacheControl = new BetaCacheControlEphemeral() } },
            Messages = [new() { Role = Role.User, Content = request.Prompt }],
            OutputConfig = new BetaOutputConfig
            {
                Effort = request.Effort,
                Format = new BetaJsonOutputFormat { Schema = request.Schema.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()) },
            },
        };
        if (FallbackModels.Contains(request.Model))
        {
            parameters = parameters with { Betas = [FallbackBeta], Fallbacks = new Default() };
        }

        BetaMessage response;
        try
        {
            response = await Client(request.ApiKey).Beta.Messages.Create(parameters, ct);
        }
        catch (Exception ex) when (Translate(ex) is { } friendly)
        {
            throw friendly;
        }

        if (response.StopReason == "refusal")
        {
            throw new AssistantException("O modelo recusou o pedido");
        }
        if (response.StopReason == "max_tokens")
        {
            throw new AssistantException("A resposta do modelo passou do limite de tamanho");
        }
        var text = string.Concat(response.Content.Select(b => b.TryPickText(out var t) ? t.Text : string.Empty));
        try
        {
            using var doc = JsonDocument.Parse(text);
            return new AssistantAnswer(doc.RootElement.Clone(), response.Usage.InputTokens + (response.Usage.CacheReadInputTokens ?? 0) +
                (response.Usage.CacheCreationInputTokens ?? 0), response.Usage.OutputTokens);
        }
        catch (JsonException ex)
        {
            throw new AssistantException("O modelo respondeu fora do formato esperado", ex);
        }
    }

    public async Task VerifyAsync(string apiKey, string model, CancellationToken ct)
    {
        try
        {
            await Client(apiKey).Models.Retrieve(model, cancellationToken: ct);
        }
        catch (Exception ex) when (Translate(ex) is { } friendly)
        {
            throw friendly;
        }
    }

    public async Task<IReadOnlyList<AssistantAgent>> ListAgentsAsync(string apiKey, CancellationToken ct)
    {
        try
        {
            var page = await Client(apiKey).Beta.Agents.List(new AgentListParams { Limit = 100 }, ct);
            return page.Items.Where(a => a.ArchivedAt is null).Select(ToAgent).OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
        catch (Exception ex) when (Translate(ex) is { } friendly)
        {
            throw friendly;
        }
    }

    public async Task<AssistantAgent> GetAgentAsync(string apiKey, string agentId, CancellationToken ct)
    {
        try
        {
            var agent = await Client(apiKey).Beta.Agents.Retrieve(agentId, cancellationToken: ct);
            return agent.ArchivedAt is null ? ToAgent(agent) : throw new AssistantException("O agente vinculado foi arquivado na Anthropic");
        }
        catch (Exception ex) when (Translate(ex) is { } friendly)
        {
            throw friendly;
        }
    }

    public async Task<AssistantAgent> CreateAgentAsync(string apiKey, string name, string description, string model, string system, CancellationToken ct)
    {
        try
        {
            var agent = await Client(apiKey).Beta.Agents.Create(new AgentCreateParams
            {
                Name = name,
                Description = description,
                Model = new BetaManagedAgentsModelConfigParams { ID = model },
                System = system,
            }, ct);
            return ToAgent(agent);
        }
        catch (Exception ex) when (Translate(ex) is { } friendly)
        {
            throw friendly;
        }
    }

    private static AssistantAgent ToAgent(BetaManagedAgentsAgent a) =>
        new(a.ID, a.Name, string.IsNullOrWhiteSpace(a.Description) ? null : a.Description, a.Model.ID, a.System, a.Version);

    private static AssistantException? Translate(Exception ex) => ex switch
    {
        AnthropicUnauthorizedException => new AssistantException("A Anthropic recusou a chave da API", ex),
        AnthropicForbiddenException => new AssistantException("A chave nao tem permissao para usar este modelo", ex),
        AnthropicNotFoundException => new AssistantException("Modelo ou agente nao encontrado na conta da Anthropic", ex),
        AnthropicRateLimitException => new AssistantException("Limite de uso da API da Anthropic atingido; tente mais tarde", ex),
        Anthropic5xxException => new AssistantException("A API da Anthropic esta indisponivel no momento", ex),
        AnthropicBadRequestException bad => new AssistantException($"Pedido recusado pela Anthropic: {bad.Message}", ex),
        AnthropicApiException api => new AssistantException($"Erro da API da Anthropic: {api.Message}", ex),
        AnthropicIOException => new AssistantException("Nao foi possivel conectar a API da Anthropic", ex),
        _ => null,
    };

    private AnthropicClient Client(string apiKey)
    {
        lock (gate)
        {
            if (cached is { } c && c.Key == apiKey)
            {
                return c.Client;
            }
            (cached?.Client as IDisposable)?.Dispose();
            var client = new AnthropicClient { ApiKey = apiKey, MaxRetries = 2, Timeout = TimeSpan.FromMinutes(10) };
            cached = (apiKey, client);
            return client;
        }
    }

    public void Dispose() => (cached?.Client as IDisposable)?.Dispose();
}
