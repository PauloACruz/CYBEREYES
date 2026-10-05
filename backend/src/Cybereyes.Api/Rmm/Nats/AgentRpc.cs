using NATS.Client.Core;

namespace Cybereyes.Api.Rmm.Nats;

public interface IAgentRpc
{
    Task<object?> RequestAsync(string agentId, IReadOnlyDictionary<string, object?> message, TimeSpan timeout, CancellationToken ct = default);

    Task PublishAsync(string agentId, IReadOnlyDictionary<string, object?> message, CancellationToken ct = default);
}

public sealed class AgentRpcTimeoutException(string agentId) : Exception($"O agente {agentId} nao respondeu a tempo");

/// <summary>Envia comandos ao agente pelo NATS no assunto igual ao agent_id, em msgpack, como o agente espera.</summary>
public sealed class AgentRpc(INatsConnection nats) : IAgentRpc
{
    public async Task<object?> RequestAsync(string agentId, IReadOnlyDictionary<string, object?> message, TimeSpan timeout, CancellationToken ct = default)
    {
        try
        {
            var reply = await nats.RequestAsync(agentId, MsgPack.Serialize(message),
                requestSerializer: NatsRawSerializer<byte[]>.Default,
                replySerializer: NatsRawSerializer<byte[]>.Default,
                replyOpts: new NatsSubOpts { Timeout = timeout },
                cancellationToken: ct);
            return reply.Data is null ? null : MsgPack.Deserialize(reply.Data);
        }
        catch (NatsNoReplyException)
        {
            throw new AgentRpcTimeoutException(agentId);
        }
        catch (NatsNoRespondersException)
        {
            throw new AgentRpcTimeoutException(agentId);
        }
    }

    public async Task PublishAsync(string agentId, IReadOnlyDictionary<string, object?> message, CancellationToken ct = default) =>
        await nats.PublishAsync(agentId, MsgPack.Serialize(message), serializer: NatsRawSerializer<byte[]>.Default, cancellationToken: ct);
}

public sealed class DisabledAgentRpc : IAgentRpc
{
    public Task<object?> RequestAsync(string agentId, IReadOnlyDictionary<string, object?> message, TimeSpan timeout, CancellationToken ct = default) =>
        throw new AgentRpcTimeoutException(agentId);

    public Task PublishAsync(string agentId, IReadOnlyDictionary<string, object?> message, CancellationToken ct = default) => Task.CompletedTask;
}
