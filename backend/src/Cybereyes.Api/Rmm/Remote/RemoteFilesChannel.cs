using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Erro devolvido pelo agente no canal files (contrato, secao 7.2).</summary>
public sealed class RemoteFilesException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// Canal files entre a API e o servico do EYES (contrato, secao 7): pedidos com id e respostas, blocos de dados e credito.
/// </summary>
public sealed class RemoteFilesChannel(RelayEnd agent, RemoteSessionHandle session, TimeProvider time)
{
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonNode?>> pending = new();
    private int nextId;

    public RemoteSessionHandle Session { get; } = session;

    /// <summary>Recebe os quadros do agente ate o fim da sessao ou da conexao.</summary>
    public async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var frame = await RemoteRelay.ReceiveAsync(agent.Socket, RemoteFrames.MaxFilesFrame, ct);
                if (frame is null)
                {
                    return;
                }
                if (frame.Length == 0)
                {
                    continue;
                }
                Session.LastActivity = time.GetUtcNow();
                await DispatchAsync(frame, ct);
            }
        }
        finally
        {
            foreach (var p in pending.Values)
            {
                p.TrySetException(new RemoteFilesException("io", "Conexao de arquivos encerrada"));
            }
            if (ReferenceEquals(Session.Files, this))
            {
                Session.Files = null;
            }
        }
    }

    private Task DispatchAsync(byte[] frame, CancellationToken ct)
    {
        if (frame[0] == RemoteFrames.FilesResponse)
        {
            Complete(frame);
        }
        return Task.CompletedTask;
    }

    private void Complete(byte[] frame)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(frame.AsSpan(1));
        }
        catch (JsonException)
        {
            return;
        }
        if (node?["id"]?.GetValue<int>() is not { } id || !pending.TryRemove(id, out var tcs))
        {
            return;
        }
        if (node["ok"]?.GetValue<bool>() == true)
        {
            tcs.TrySetResult(node["result"]);
        }
        else
        {
            var error = node["error"];
            tcs.TrySetException(new RemoteFilesException(error?["code"]?.GetValue<string>() ?? "io", error?["message"]?.GetValue<string>() ?? "Erro no agente"));
        }
    }

    /// <summary>Envia um pedido (op e campos) e espera a resposta do agente.</summary>
    public async Task<JsonNode?> RequestAsync(string op, JsonObject fields, TimeSpan timeout, CancellationToken ct)
    {
        var id = Interlocked.Increment(ref nextId);
        var tcs = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = tcs;
        fields["id"] = id;
        fields["op"] = op;
        try
        {
            await SendJsonAsync(RemoteFrames.FilesRequest, fields, ct);
            return await tcs.Task.WaitAsync(timeout, ct);
        }
        catch (TimeoutException)
        {
            throw new RemoteFilesException("timeout", "O agente nao respondeu a tempo");
        }
        finally
        {
            pending.TryRemove(id, out _);
        }
    }

    public Task SendJsonAsync(byte type, JsonNode body, CancellationToken ct)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(body);
        var frame = new byte[json.Length + 1];
        frame[0] = type;
        json.CopyTo(frame, 1);
        return agent.SendAsync(frame, ct);
    }

    public Task SendAsync(ReadOnlyMemory<byte> frame, CancellationToken ct) => agent.SendAsync(frame, ct);

    public bool Connected => agent.Socket.State == WebSocketState.Open;

    public Task CloseAsync(int code, string reason) => agent.CloseAsync(code, reason);
}
