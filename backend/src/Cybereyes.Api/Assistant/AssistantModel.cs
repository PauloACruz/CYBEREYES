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

/// <summary>
/// Bloco de uma conversa com ferramentas, no formato da Messages API: <c>text</c>, <c>tool_use</c> (<see cref="Id"/>,
/// <see cref="Name"/>, <see cref="Input"/>), <c>tool_result</c> (<see cref="ToolUseId"/>, <see cref="Text"/>, <see cref="IsError"/>),
/// <c>thinking</c> (<see cref="Text"/>, <see cref="Signature"/>) ou <c>redacted_thinking</c> (<see cref="Signature"/> com os dados).
/// </summary>
public sealed record AgentBlock(string Type, string? Text = null, string? Id = null, string? Name = null, JsonElement? Input = null,
    string? ToolUseId = null, bool? IsError = null, string? Signature = null)
{
    public static AgentBlock FromText(string text) => new("text", text);

    public static AgentBlock Result(string toolUseId, string text, bool isError) => new("tool_result", text, ToolUseId: toolUseId, IsError: isError);
}

public sealed record AgentMessage(string Role, IReadOnlyList<AgentBlock> Content, DateTimeOffset? At = null);

public sealed record AgentToolSpec(string Name, string Description, JsonElement InputSchema);

public sealed record AgentConversation(string ApiKey, string Model, string System, IReadOnlyList<AgentMessage> Messages,
    IReadOnlyList<AgentToolSpec> Tools, string Effort, int MaxTokens);

/// <summary>Resposta de uma rodada: o conteudo do modelo e o motivo da parada (<c>tool_use</c> quando ele pede ferramentas).</summary>
public sealed record AgentTurn(IReadOnlyList<AgentBlock> Content, string StopReason);

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

    /// <summary>Uma rodada da conversa com ferramentas: o modelo responde com texto e pedidos de ferramenta.</summary>
    Task<AgentTurn> ConverseAsync(AgentConversation request, CancellationToken ct);
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

    public async Task<AgentTurn> ConverseAsync(AgentConversation request, CancellationToken ct)
    {
        var parameters = new MessageCreateParams
        {
            Model = request.Model,
            MaxTokens = request.MaxTokens,
            System = new List<BetaTextBlockParam> { new() { Text = request.System, CacheControl = new BetaCacheControlEphemeral() } },
            Messages = request.Messages.Select(ToParam).ToList(),
            Tools = request.Tools.Select(t => (BetaToolUnion)new BetaTool
            {
                Name = t.Name,
                Description = t.Description,
                InputSchema = ToSchema(t.InputSchema),
            }).ToList(),
            OutputConfig = new BetaOutputConfig { Effort = request.Effort },
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
        var content = new List<AgentBlock>();
        foreach (var block in response.Content)
        {
            if (block.TryPickText(out var text))
            {
                content.Add(AgentBlock.FromText(text.Text));
            }
            else if (block.TryPickToolUse(out var use))
            {
                content.Add(new AgentBlock("tool_use", Id: use.ID, Name: use.Name, Input: JsonSerializer.SerializeToElement(use.Input)));
            }
            else if (block.TryPickThinking(out var thinking))
            {
                content.Add(new AgentBlock("thinking", thinking.Thinking, Signature: thinking.Signature));
            }
            else if (block.TryPickRedactedThinking(out var redacted))
            {
                content.Add(new AgentBlock("redacted_thinking", Signature: redacted.Data));
            }
        }
        return new AgentTurn(content, response.StopReason == "tool_use" ? "tool_use" : response.StopReason == "max_tokens" ? "max_tokens" : "end_turn");
    }

    private static BetaMessageParam ToParam(AgentMessage message)
    {
        var blocks = new List<BetaContentBlockParam>();
        foreach (var b in message.Content)
        {
            switch (b.Type)
            {
                case "text":
                    blocks.Add(new BetaTextBlockParam { Text = b.Text ?? string.Empty });
                    break;
                case "tool_use":
                    blocks.Add(new BetaToolUseBlockParam
                    {
                        ID = b.Id!,
                        Name = b.Name!,
                        Input = b.Input is { ValueKind: JsonValueKind.Object } input
                            ? input.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone())
                            : new Dictionary<string, JsonElement>(),
                    });
                    break;
                case "tool_result":
                    blocks.Add(new BetaToolResultBlockParam { ToolUseID = b.ToolUseId!, Content = b.Text ?? string.Empty, IsError = b.IsError ?? false });
                    break;
                case "thinking":
                    blocks.Add(new BetaThinkingBlockParam { Thinking = b.Text ?? string.Empty, Signature = b.Signature ?? string.Empty });
                    break;
                case "redacted_thinking":
                    blocks.Add(new BetaRedactedThinkingBlockParam { Data = b.Signature ?? string.Empty });
                    break;
            }
        }
        return new BetaMessageParam { Role = message.Role == "assistant" ? Role.Assistant : Role.User, Content = blocks };
    }

    /// <summary>Esquema JSON da ferramenta (vindo do MCP) no formato do SDK: propriedades, obrigatorios e o resto como veio.</summary>
    private static InputSchema ToSchema(JsonElement schema)
    {
        var properties = schema.TryGetProperty("properties", out var p) && p.ValueKind == JsonValueKind.Object
            ? p.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone())
            : new Dictionary<string, JsonElement>();
        var required = schema.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.Array
            ? r.EnumerateArray().Select(x => x.GetString()!).ToList()
            : [];
        return new InputSchema { Properties = properties, Required = required };
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
