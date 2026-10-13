using System.Collections.Concurrent;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Renci.SshNet;
using Cybereyes.Api.Rmm;

namespace Cybereyes.Api.Apps;

/// <summary>
/// Terminais SSH interativos (estilo Termius) abertos pelo console. A API conecta ao servidor com PTY xterm-256color e
/// repassa os bytes crus em base64 pelos mesmos eventos do terminal do agente (terminalOutput / terminalClosed).
/// Cada sessao vive na replica que atende a conexao WebSocket do navegador.
/// </summary>
public sealed partial class SshTerminalSessions(IHubContext<ConsoleHub> hub, ILogger<SshTerminalSessions> logger)
{
    private sealed class Session(string connectionId, string username, SshSession ssh, ShellStream shell, string? startup)
    {
        public string ConnectionId { get; } = connectionId;
        public string Username { get; } = username;
        public SshSession Ssh { get; } = ssh;
        public ShellStream Shell { get; } = shell;
        public Lock Gate { get; } = new();

        /// <summary>cd ainda nao digitado; enquanto existir, a entrada do tecnico espera em <see cref="Pending"/>.</summary>
        public string? Startup { get; set; } = startup;
        public StringBuilder Pending { get; } = new();
    }

    /// <summary>Espera depois da primeira saida do shell antes de digitar o cd.</summary>
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMilliseconds(400);

    /// <summary>Servidor que nao manda banner nem prompt: o cd vai mesmo assim.</summary>
    private static readonly TimeSpan StartupFallback = TimeSpan.FromSeconds(3);

    private readonly ConcurrentDictionary<string, Session> sessions = new(StringComparer.Ordinal);

    public bool Owns(string sessionId) => sessions.ContainsKey(sessionId);

    public int CountFor(string connectionId) => sessions.Values.Count(s => s.ConnectionId == connectionId);

    /// <summary>Conecta e abre o shell; devolve o id da sessao e a conexao (para fixar a chave do servidor).</summary>
    public async Task<(string SessionId, SshSession Ssh)> StartAsync(string connectionId, string username, SshTarget target, string? directory,
        int cols, int rows, CancellationToken ct)
    {
        var ssh = await SshConnector.ConnectAsync(target, ct, keepAlive: TimeSpan.FromSeconds(30));
        ShellStream shell;
        try
        {
            shell = ssh.Client.CreateShellStream("xterm-256color", (uint)Math.Clamp(cols, 10, 500), (uint)Math.Clamp(rows, 5, 300), 0, 0, 65536);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            ssh.Dispose();
            throw SshConnector.Translate(ex, target);
        }

        var sessionId = Guid.NewGuid().ToString("N");
        var session = new Session(connectionId, username, ssh, shell, string.IsNullOrWhiteSpace(directory) ? null : RemoteScript.ChangeDirectory(directory));
        sessions[sessionId] = session;
        _ = Task.Factory.StartNew(() => Pump(sessionId, session), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        if (session.Startup is not null)
        {
            _ = Task.Delay(StartupFallback, CancellationToken.None).ContinueWith(_ => FlushStartup(session), TaskScheduler.Default);
        }
        return (sessionId, ssh);
    }

    public void Input(string connectionId, string sessionId, string data)
    {
        if (Owned(connectionId, sessionId) is not { } session || data.Length == 0)
        {
            return;
        }
        lock (session.Gate)
        {
            if (session.Startup is not null)
            {
                session.Pending.Append(data);
                return;
            }
        }
        Write(session, data);
    }

    public void Resize(string connectionId, string sessionId, int cols, int rows)
    {
        if (Owned(connectionId, sessionId) is { } session && cols > 0 && rows > 0)
        {
            try
            {
                session.Shell.ChangeWindowSize((uint)Math.Min(cols, 500), (uint)Math.Min(rows, 300), 0, 0);
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }

    public void Stop(string connectionId, string sessionId)
    {
        if (Owned(connectionId, sessionId) is { } session && sessions.TryRemove(sessionId, out _))
        {
            Close(session);
        }
    }

    public void StopAll(string connectionId)
    {
        foreach (var (id, _) in sessions.Where(kv => kv.Value.ConnectionId == connectionId).ToList())
        {
            Stop(connectionId, id);
        }
    }

    public string? UsernameOf(string sessionId) => sessions.TryGetValue(sessionId, out var s) ? s.Username : null;

    private Session? Owned(string connectionId, string sessionId) =>
        sessions.TryGetValue(sessionId, out var s) && s.ConnectionId == connectionId ? s : null;

    /// <summary>Digita o cd e, depois dele, o que o tecnico ja tinha digitado. So vale na primeira chamada.</summary>
    private static void FlushStartup(Session session)
    {
        string text;
        lock (session.Gate)
        {
            if (session.Startup is null)
            {
                return;
            }
            text = session.Startup + session.Pending;
            session.Startup = null;
            session.Pending.Clear();
        }
        Write(session, text);
    }

    private static void Write(Session session, string data)
    {
        try
        {
            session.Shell.Write(Encoding.UTF8.GetBytes(data));
            session.Shell.Flush();
        }
        catch (Exception ex) when (ex is ObjectDisposedException or Renci.SshNet.Common.SshException or IOException)
        {
        }
    }

    private static void Close(Session session)
    {
        try
        {
            session.Shell.Dispose();
        }
        catch (Exception ex) when (ex is ObjectDisposedException or Renci.SshNet.Common.SshException or IOException)
        {
        }
        session.Ssh.Dispose();
    }

    /// <summary>
    /// Le o shell numa thread propria (a leitura do ShellStream bloqueia) e envia na ordem. O cd para a pasta da aplicacao
    /// vai pouco depois da primeira saida (banner ou prompt): digitado antes, o terminal o ecoaria duas vezes.
    /// </summary>
    private void Pump(string sessionId, Session session)
    {
        var first = true;
        var client = hub.Clients.Client(session.ConnectionId);
        var buffer = new byte[16384];
        string? reason = "Sessao SSH encerrada pelo servidor";
        try
        {
            int read;
            while ((read = session.Shell.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (first && session.Startup is not null)
                {
                    _ = Task.Delay(StartupDelay, CancellationToken.None).ContinueWith(_ => FlushStartup(session), TaskScheduler.Default);
                }
                first = false;
                client.SendAsync("terminalOutput", sessionId, Convert.ToBase64String(buffer, 0, read)).GetAwaiter().GetResult();
            }
        }
        catch (Exception ex) when (ex is ObjectDisposedException or Renci.SshNet.Common.SshException or IOException or InvalidOperationException)
        {
            reason = "A conexao SSH caiu";
            LogPumpEnded(logger, ex, sessionId);
        }

        // Encerrada pelo tecnico: Stop ja tirou a sessao da lista e o navegador nao espera aviso.
        if (sessions.TryRemove(sessionId, out _))
        {
            Close(session);
            try
            {
                client.SendAsync("terminalClosed", sessionId, 0, reason).GetAwaiter().GetResult();
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException)
            {
                LogPumpEnded(logger, ex, sessionId);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Debug, Message = "Terminal SSH {SessionId} encerrado")]
    private static partial void LogPumpEnded(ILogger logger, Exception ex, string sessionId);
}
