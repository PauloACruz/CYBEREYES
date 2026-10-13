using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Rmm;
using Cybereyes.Core.Apps;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Apps;

/// <summary>Execucao ja gravada em app_runs (status running), pronta para rodar no servidor.</summary>
public sealed record AppRunLaunch(long RunId, int ServerId, int? WebAppId, int ClientId, SshTarget Target, string RemoteCommand, TimeSpan Timeout);

/// <summary>
/// Roda comandos e deploys por SSH fora da requisicao. A saida vai ao vivo ao grupo SignalR da execucao (com o deslocamento de
/// cada trecho, para o navegador juntar com o que ja leu) e e gravada a cada 2 s; nesse mesmo passo o pedido de cancelamento
/// e lido do banco, entao cancelar funciona de qualquer replica.
/// </summary>
public sealed partial class AppRunner(IServiceScopeFactory scopes, IHubContext<ConsoleHub> hub, TimeProvider time, IHostApplicationLifetime lifetime,
    ILogger<AppRunner> logger)
{
    public const int MaxOutputChars = 2 * 1024 * 1024;
    private static readonly TimeSpan SendInterval = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan PersistInterval = TimeSpan.FromSeconds(2);

    private readonly ConcurrentDictionary<long, Task> running = new();

    public static string Group(long runId) => "apprun:" + runId.ToString(CultureInfo.InvariantCulture);

    public void Launch(AppRunLaunch launch)
    {
        running[launch.RunId] = Task.Run(async () =>
        {
            try
            {
                await ExecuteAsync(launch);
            }
            finally
            {
                running.TryRemove(launch.RunId, out _);
            }
        });
    }

    /// <summary>Aguarda as execucoes desta replica (testes).</summary>
    public Task WhenIdleAsync() => Task.WhenAll(running.Values);

    private async Task ExecuteAsync(AppRunLaunch launch)
    {
        var output = new RunOutput(MaxOutputChars);
        using var timeout = new CancellationTokenSource(launch.Timeout);
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token, lifetime.ApplicationStopping);
        using var stopPump = new CancellationTokenSource();
        var userCancelled = false;
        string status;
        int? exitCode = null;
        string? error = null;
        var pump = PumpAsync(launch, output, cancel, () => userCancelled = true, stopPump.Token);
        try
        {
            using var session = await SshConnector.ConnectAsync(launch.Target, cancel.Token);
            await using (var scope = scopes.CreateAsyncScope())
            {
                await SshConnector.RecordConnectionAsync(scope.ServiceProvider.GetRequiredService<CybereyesDbContext>(), launch.ServerId, session, time,
                    CancellationToken.None);
            }
            using var command = session.Client.CreateCommand(launch.RemoteCommand);
            var execution = command.ExecuteAsync(cancel.Token);
            var stdout = ReadAsync(command.OutputStream, output);
            var stderr = ReadAsync(command.ExtendedOutputStream, output);
            try
            {
                await execution;
            }
            catch (OperationCanceledException)
            {
            }
            await Task.WhenAny(Task.WhenAll(stdout, stderr), Task.Delay(TimeSpan.FromSeconds(5), CancellationToken.None));
            exitCode = command.ExitStatus;
            (status, error) = userCancelled ? (AppRunStatus.Cancelled, "Cancelado pelo tecnico")
                : timeout.IsCancellationRequested ? (AppRunStatus.Timeout, $"Tempo limite de {launch.Timeout.TotalMinutes:0} min esgotado")
                : lifetime.ApplicationStopping.IsCancellationRequested ? (AppRunStatus.Failed, "Execucao interrompida: o servidor do Cybereyes reiniciou")
                : exitCode == 0 ? (AppRunStatus.Success, null)
                : (AppRunStatus.Failed, exitCode is null ? $"Encerrado por sinal {command.ExitSignal}" : null);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            status = userCancelled ? AppRunStatus.Cancelled : timeout.IsCancellationRequested ? AppRunStatus.Timeout : AppRunStatus.Failed;
            error = ex is OperationCanceledException ? "Cancelado antes de conectar" : SshConnector.Translate(ex, launch.Target).Message;
            if (ex is not SshFailureException and not OperationCanceledException)
            {
                LogRunFailed(logger, ex, launch.RunId);
            }
        }

        await stopPump.CancelAsync();
        await pump;
        await FinishAsync(launch, output, status, exitCode, error);
    }

    private static async Task ReadAsync(Stream stream, RunOutput output)
    {
        var decoder = Encoding.UTF8.GetDecoder();
        var bytes = new byte[16384];
        var chars = new char[Encoding.UTF8.GetMaxCharCount(bytes.Length)];
        try
        {
            int read;
            while ((read = await stream.ReadAsync(bytes)) > 0)
            {
                var count = decoder.GetChars(bytes, 0, read, chars, 0, flush: false);
                output.Append(chars.AsSpan(0, count));
            }
        }
        catch (ObjectDisposedException)
        {
        }
    }

    /// <summary>Envia a saida nova ao grupo, grava no banco e le o pedido de cancelamento.</summary>
    private async Task PumpAsync(AppRunLaunch launch, RunOutput output, CancellationTokenSource cancel, Action onUserCancel, CancellationToken stop)
    {
        var group = hub.Clients.Group(Group(launch.RunId));
        var lastPersist = time.GetUtcNow();
        var persistedLength = 0;
        while (true)
        {
            try
            {
                await Task.Delay(SendInterval, stop);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            if (output.TakePending() is { } chunk)
            {
                await TrySendAsync(() => group.SendAsync("appRunOutput", launch.RunId, chunk.Offset, chunk.Text, CancellationToken.None));
            }
            if (time.GetUtcNow() - lastPersist < PersistInterval)
            {
                continue;
            }
            lastPersist = time.GetUtcNow();
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
                var snapshot = output.Snapshot();
                var now = time.GetUtcNow();
                if (snapshot.Text.Length != persistedLength)
                {
                    await db.AppRuns.Where(r => r.Id == launch.RunId).ExecuteUpdateAsync(s => s
                        .SetProperty(r => r.Output, snapshot.Text).SetProperty(r => r.OutputTruncated, snapshot.Truncated).SetProperty(r => r.UpdatedAt, now),
                        CancellationToken.None);
                    persistedLength = snapshot.Text.Length;
                }
                else
                {
                    await db.AppRuns.Where(r => r.Id == launch.RunId).ExecuteUpdateAsync(s => s.SetProperty(r => r.UpdatedAt, now), CancellationToken.None);
                }
                if (await db.AppRuns.AnyAsync(r => r.Id == launch.RunId && r.CancelRequested, CancellationToken.None) && !cancel.IsCancellationRequested)
                {
                    onUserCancel();
                    await cancel.CancelAsync();
                }
            }
            catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or Npgsql.NpgsqlException)
            {
                LogPersistFailed(logger, ex, launch.RunId);
            }
        }
        if (output.TakePending() is { } last)
        {
            await TrySendAsync(() => group.SendAsync("appRunOutput", launch.RunId, last.Offset, last.Text, CancellationToken.None));
        }
    }

    private async Task FinishAsync(AppRunLaunch launch, RunOutput output, string status, int? exitCode, string? error)
    {
        var snapshot = output.Snapshot();
        var now = time.GetUtcNow();
        var message = error is { Length: > 1000 } ? error[..1000] : error;
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            await db.AppRuns.Where(r => r.Id == launch.RunId).ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Output, snapshot.Text).SetProperty(r => r.OutputTruncated, snapshot.Truncated)
                .SetProperty(r => r.Status, status).SetProperty(r => r.ExitCode, exitCode).SetProperty(r => r.Error, message)
                .SetProperty(r => r.FinishedAt, now).SetProperty(r => r.UpdatedAt, now), CancellationToken.None);
        }
        catch (Exception ex) when (ex is DbUpdateException or InvalidOperationException or Npgsql.NpgsqlException)
        {
            LogPersistFailed(logger, ex, launch.RunId);
        }
        await TrySendAsync(() => hub.Clients.Group(Group(launch.RunId)).SendAsync("appRunFinished", launch.RunId, status, exitCode, message,
            CancellationToken.None));
        await TrySendAsync(() => NotifyRunsChangedAsync(hub, launch.ClientId, launch.RunId, launch.ServerId, launch.WebAppId, status));
    }

    public static Task NotifyRunsChangedAsync(IHubContext<ConsoleHub> hub, int clientId, long runId, int serverId, int? webAppId, string status) =>
        hub.Clients.ForClient(clientId).SendAsync("appRunsChanged", new { runId, serverId, webAppId, status }, CancellationToken.None);

    private async Task TrySendAsync(Func<Task> send)
    {
        try
        {
            await send();
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or StackExchange.Redis.RedisConnectionException or TimeoutException)
        {
            LogSendFailed(logger, ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Execucao SSH {RunId} falhou")]
    private static partial void LogRunFailed(ILogger logger, Exception ex, long runId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Nao foi possivel gravar a saida da execucao SSH {RunId}")]
    private static partial void LogPersistFailed(ILogger logger, Exception ex, long runId);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Falha ao enviar a saida da execucao ao console")]
    private static partial void LogSendFailed(ILogger logger, Exception ex);
}

/// <summary>Saida acumulada (limite em caracteres; o excedente e descartado) e o trecho ainda nao enviado.</summary>
public sealed class RunOutput(int limit)
{
    private readonly StringBuilder text = new();
    private readonly Lock gate = new();
    private int sent;
    private bool truncated;

    public void Append(ReadOnlySpan<char> chunk)
    {
        lock (gate)
        {
            var room = limit - text.Length;
            if (room <= 0)
            {
                truncated |= chunk.Length > 0;
                return;
            }
            if (chunk.Length > room)
            {
                truncated = true;
                chunk = chunk[..room];
            }
            text.Append(chunk);
        }
    }

    public (int Offset, string Text)? TakePending()
    {
        lock (gate)
        {
            if (sent == text.Length)
            {
                return null;
            }
            var chunk = (sent, text.ToString(sent, text.Length - sent));
            sent = text.Length;
            return chunk;
        }
    }

    public (string Text, bool Truncated) Snapshot()
    {
        lock (gate)
        {
            return (text.ToString(), truncated);
        }
    }
}
