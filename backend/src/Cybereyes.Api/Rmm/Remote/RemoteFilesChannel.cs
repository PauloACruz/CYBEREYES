using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Threading.Channels;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Erro devolvido pelo agente no canal files (contrato, secao 7.2).</summary>
public sealed class RemoteFilesException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Credito de envio concedido pela outra ponta (contrato, secao 7.4).</summary>
public sealed class CreditPool
{
    private readonly object gate = new();
    private long available;
    private TaskCompletionSource signal = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Exception? failure;

    public void Add(long bytes)
    {
        TaskCompletionSource done;
        lock (gate)
        {
            available += bytes;
            done = signal;
            signal = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        done.TrySetResult();
    }

    public void Fail(Exception error)
    {
        TaskCompletionSource done;
        lock (gate)
        {
            failure = error;
            done = signal;
        }
        done.TrySetResult();
    }

    /// <summary>Espera credito e reserva ate <paramref name="wanted"/> bytes; devolve quanto foi reservado.</summary>
    public async Task<int> TakeAsync(int wanted, CancellationToken ct)
    {
        while (true)
        {
            Task wait;
            lock (gate)
            {
                if (failure is not null)
                {
                    throw failure;
                }
                if (available > 0)
                {
                    var n = (int)Math.Min(wanted, available);
                    available -= n;
                    return n;
                }
                wait = signal.Task;
            }
            await wait.WaitAsync(ct);
        }
    }
}

/// <summary>Envio em andamento (navegador para estacao). Vive na replica dona enquanto a sessao existir.</summary>
public sealed class UploadState : IDisposable
{
    public required uint TransferId { get; init; }
    public required string Path { get; init; }
    public required long Size { get; init; }
    public required long RecordId { get; init; }
    public long Received { get; set; }
    public IncrementalHash Hash { get; } = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    public CreditPool Credit { get; } = new();
    public SemaphoreSlim Gate { get; } = new(1, 1);

    public void Dispose()
    {
        Hash.Dispose();
        Gate.Dispose();
    }
}

/// <summary>
/// Canal files entre a API e o servico do EYES (contrato, secao 7): pedidos com id e respostas, blocos de dados e credito.
/// </summary>
public sealed class RemoteFilesChannel(RelayEnd agent, RemoteSessionHandle session, TimeProvider time)
{
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonNode?>> pending = new();
    private readonly ConcurrentDictionary<uint, Channel<byte[]>> downloads = new();
    private int nextId;
    private int nextTransfer;

    /// <summary>Envios desta sessao, por id (retomada dentro da mesma sessao).</summary>
    public ConcurrentDictionary<uint, UploadState> Uploads { get; } = new();

    public uint NewTransferId() => (uint)Interlocked.Increment(ref nextTransfer);

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
            var closed = new RemoteFilesException("io", "Conexao de arquivos encerrada");
            foreach (var p in pending.Values)
            {
                p.TrySetException(closed);
            }
            foreach (var d in downloads.Values)
            {
                d.Writer.TryComplete(closed);
            }
            foreach (var u in Uploads.Values)
            {
                u.Credit.Fail(closed);
            }
            if (ReferenceEquals(Session.Files, this))
            {
                Session.Files = null;
            }
        }
    }

    private async Task DispatchAsync(byte[] frame, CancellationToken ct)
    {
        switch (frame[0])
        {
            case RemoteFrames.FilesResponse:
                Complete(frame);
                break;
            case RemoteFrames.FilesChunk when frame.Length >= 13:
                var id = BinaryPrimitives.ReadUInt32BigEndian(frame.AsSpan(1));
                if (downloads.TryGetValue(id, out var target))
                {
                    // Bloqueia so ate o leitor consumir: o credito ja limita o que esta em transito.
                    await target.Writer.WriteAsync(frame[13..], ct);
                }
                break;
            case RemoteFrames.FilesCredit or RemoteFrames.FilesCancel:
                JsonNode? body;
                try
                {
                    body = JsonNode.Parse(frame.AsSpan(1));
                }
                catch (JsonException)
                {
                    break;
                }
                if (body?["transferId"]?.GetValue<uint>() is not { } transfer)
                {
                    break;
                }
                if (frame[0] == RemoteFrames.FilesCredit && Uploads.TryGetValue(transfer, out var up))
                {
                    up.Credit.Add(body["bytes"]?.GetValue<long>() ?? 0);
                }
                else if (frame[0] == RemoteFrames.FilesCancel)
                {
                    var cancelled = new RemoteFilesException("io", "O agente interrompeu a transferencia");
                    if (Uploads.TryGetValue(transfer, out var failed))
                    {
                        failed.Credit.Fail(cancelled);
                    }
                    if (downloads.TryGetValue(transfer, out var down))
                    {
                        down.Writer.TryComplete(cancelled);
                    }
                }
                break;
        }
    }

    /// <summary>Registra um download: os blocos do agente chegam no canal devolvido.</summary>
    public ChannelReader<byte[]> OpenDownload(uint transferId)
    {
        var channel = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(32) { SingleReader = true, SingleWriter = true });
        downloads[transferId] = channel;
        return channel.Reader;
    }

    public void CloseDownload(uint transferId, Exception? error = null)
    {
        if (downloads.TryRemove(transferId, out var channel))
        {
            channel.Writer.TryComplete(error);
        }
    }

    /// <summary>Monta um CHUNK: u32 transferencia, u64 posicao e os dados.</summary>
    public static byte[] ChunkFrame(uint transferId, long offset, ReadOnlySpan<byte> data)
    {
        var frame = new byte[13 + data.Length];
        frame[0] = RemoteFrames.FilesChunk;
        BinaryPrimitives.WriteUInt32BigEndian(frame.AsSpan(1), transferId);
        BinaryPrimitives.WriteUInt64BigEndian(frame.AsSpan(5), (ulong)offset);
        data.CopyTo(frame.AsSpan(13));
        return frame;
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

    /// <summary>Envia um pedido e devolve a espera da resposta, sem prazo (download: a resposta vem no fim).</summary>
    public async Task<Task<JsonNode?>> BeginRequestAsync(string op, JsonObject fields, CancellationToken ct)
    {
        var id = Interlocked.Increment(ref nextId);
        var tcs = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = tcs;
        fields["id"] = id;
        fields["op"] = op;
        try
        {
            await SendJsonAsync(RemoteFrames.FilesRequest, fields, ct);
        }
        catch
        {
            pending.TryRemove(id, out _);
            throw;
        }
        return tcs.Task;
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
