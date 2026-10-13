using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Renci.SshNet;
using Renci.SshNet.Common;
using Cybereyes.Api.Inventory;
using Cybereyes.Core.Apps;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Apps;

/// <summary>Dados para abrir uma conexao SSH, com os segredos ja decifrados.</summary>
public sealed record SshTarget(string Host, int Port, string Username, string AuthMethod, string? Password, string? PrivateKey, string? Passphrase,
    string? PinnedFingerprint)
{
    public static SshTarget FromServer(AppServer server, Vault vault) => new(server.Host, server.Port, server.Username, server.AuthMethod,
        Decrypt(vault, server.PasswordEncrypted), Decrypt(vault, server.PrivateKeyEncrypted), Decrypt(vault, server.PassphraseEncrypted),
        server.HostKeyFingerprint);

    private static string? Decrypt(Vault vault, string? stored) => stored is null ? null : vault.Decrypt(stored);

    public bool HasSecret => AuthMethod == SshAuthMethod.Key ? !string.IsNullOrEmpty(PrivateKey) : !string.IsNullOrEmpty(Password);
}

/// <summary>Falha de SSH com mensagem pronta para o tecnico.</summary>
public sealed class SshFailureException(string message, string code, Exception? inner = null) : Exception(message, inner)
{
    public const string HostKeyMismatch = "HOST_KEY_MISMATCH";
    public const string AuthFailed = "SSH_AUTH_FAILED";
    public const string Unreachable = "SSH_UNREACHABLE";
    public const string NoSecret = "SSH_NO_SECRET";
    public const string VaultKey = "VAULT_KEY_MISMATCH";
    public const string Generic = "SSH_ERROR";

    public string Code { get; } = code;

    /// <summary>Chave apresentada pelo servidor quando ela nao confere com a fixada.</summary>
    public string? PresentedFingerprint { get; init; }
}

/// <summary>Conexao aberta e a chave que o servidor apresentou.</summary>
public sealed record SshSession(SshClient Client, string Fingerprint, string Algorithm) : IDisposable
{
    public void Dispose() => Client.Dispose();
}

public static class SshConnector
{
    public static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);

    /// <summary>Abre a conexao conferindo a chave do servidor com a fixada (se houver).</summary>
    public static async Task<SshSession> ConnectAsync(SshTarget target, CancellationToken ct, TimeSpan? keepAlive = null)
    {
        if (!target.HasSecret)
        {
            throw new SshFailureException("Servidor sem senha ou chave SSH cadastrada", SshFailureException.NoSecret);
        }
        var methods = new List<AuthenticationMethod>();
        PrivateKeyFile? keyFile = null;
        if (target.AuthMethod == SshAuthMethod.Key)
        {
            keyFile = LoadKey(target.PrivateKey!, target.Passphrase);
            methods.Add(new PrivateKeyAuthenticationMethod(target.Username, keyFile));
        }
        else
        {
            var password = target.Password!;
            methods.Add(new PasswordAuthenticationMethod(target.Username, password));
            // Servidores com PasswordAuthentication desligado e so keyboard-interactive (PAM) ainda aceitam a senha.
            var interactive = new KeyboardInteractiveAuthenticationMethod(target.Username);
            interactive.AuthenticationPrompt += (_, e) =>
            {
                foreach (var prompt in e.Prompts)
                {
                    prompt.Response = password;
                }
            };
            methods.Add(interactive);
        }

        var info = new Renci.SshNet.ConnectionInfo(target.Host, target.Port, target.Username, [.. methods]) { Timeout = ConnectTimeout };
        var client = new SshClient(info);
        if (keepAlive is { } interval)
        {
            client.KeepAliveInterval = interval;
        }
        string? presented = null;
        var algorithm = string.Empty;
        client.HostKeyReceived += (_, e) =>
        {
            presented = e.FingerPrintSHA256;
            algorithm = e.HostKeyName;
            e.CanTrust = target.PinnedFingerprint is null || string.Equals(target.PinnedFingerprint, presented, StringComparison.Ordinal);
        };
        try
        {
            await client.ConnectAsync(ct);
            return new SshSession(client, presented ?? string.Empty, algorithm);
        }
        catch (Exception ex)
        {
            client.Dispose();
            if (ex is OperationCanceledException && ct.IsCancellationRequested)
            {
                throw;
            }
            if (presented is not null && target.PinnedFingerprint is not null && !string.Equals(target.PinnedFingerprint, presented, StringComparison.Ordinal))
            {
                throw new SshFailureException(
                    $"A chave do servidor mudou (esperada SHA256:{target.PinnedFingerprint}, recebida SHA256:{presented}). " +
                    "Se o servidor foi reinstalado, aceite a nova chave no cadastro; senao, pode ser uma interceptacao.",
                    SshFailureException.HostKeyMismatch, ex) { PresentedFingerprint = presented };
            }
            throw Translate(ex, target);
        }
        finally
        {
            keyFile?.Dispose();
        }
    }

    /// <summary>Le a chave privada (OpenSSH, PEM ou PuTTY) para validar no cadastro e conectar.</summary>
    public static PrivateKeyFile LoadKey(string privateKey, string? passphrase)
    {
        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(privateKey.Trim() + "\n"));
            return string.IsNullOrEmpty(passphrase) ? new PrivateKeyFile(stream) : new PrivateKeyFile(stream, passphrase);
        }
        catch (Exception ex) when (ex is SshException or SshPassPhraseNullOrEmptyException or InvalidOperationException or ArgumentException
            or FormatException or CryptographicException or NotSupportedException)
        {
            throw new SshFailureException(ex is SshPassPhraseNullOrEmptyException
                ? "A chave privada esta protegida por senha: informe a senha da chave"
                : "Chave privada invalida ou senha da chave incorreta", SshFailureException.Generic, ex);
        }
    }

    public static SshFailureException Translate(Exception ex, SshTarget target) => ex switch
    {
        SshFailureException failure => failure,
        SshAuthenticationException => new SshFailureException($"O servidor recusou o usuario {target.Username} com a senha ou chave informada",
            SshFailureException.AuthFailed, ex),
        SocketException socket => new SshFailureException($"Nao foi possivel conectar a {target.Host}:{target.Port} ({SocketReason(socket)})",
            SshFailureException.Unreachable, ex),
        SshOperationTimeoutException or TimeoutException or OperationCanceledException =>
            new SshFailureException($"Tempo esgotado ao conectar a {target.Host}:{target.Port}", SshFailureException.Unreachable, ex),
        SshConnectionException => new SshFailureException($"Conexao SSH encerrada pelo servidor: {ex.Message}", SshFailureException.Generic, ex),
        CryptographicException => new SshFailureException("Nao foi possivel decifrar a credencial: a chave do cofre mudou?", SshFailureException.VaultKey, ex),
        _ => new SshFailureException($"Falha no SSH: {ex.Message}", SshFailureException.Generic, ex),
    };

    private static string SocketReason(SocketException ex) => ex.SocketErrorCode switch
    {
        SocketError.HostNotFound or SocketError.NoData or SocketError.TryAgain => "nome nao encontrado no DNS",
        SocketError.ConnectionRefused => "conexao recusada: a porta esta fechada",
        SocketError.TimedOut => "sem resposta",
        SocketError.HostUnreachable or SocketError.NetworkUnreachable => "rede inalcancavel",
        _ => ex.SocketErrorCode.ToString(),
    };

    /// <summary>Fixa a chave no primeiro acesso (TOFU) e marca a ultima conexao.</summary>
    public static Task RecordConnectionAsync(CybereyesDbContext db, int serverId, SshSession session, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        return db.AppServers.IgnoreQueryFilters().Where(s => s.Id == serverId).ExecuteUpdateAsync(s => s
            .SetProperty(x => x.LastConnectedAt, now)
            .SetProperty(x => x.HostKeyFingerprint, x => x.HostKeyFingerprint ?? session.Fingerprint)
            .SetProperty(x => x.HostKeyAlgorithm, x => x.HostKeyFingerprint == null ? session.Algorithm : x.HostKeyAlgorithm), ct);
    }
}

/// <summary>Monta o comando enviado ao servidor sem depender das aspas do shell de login do usuario.</summary>
public static class RemoteScript
{
    public const int MaxScriptLength = 32768;

    /// <summary>Contexto da aplicacao exportado para o script.</summary>
    public sealed record AppContext(string Name, string? Url, string? DeployPath, string? RepoUrl, string? Branch);

    /// <summary>
    /// Script final: variaveis da aplicacao, cd para a pasta dela e, no deploy, set -e (a primeira falha interrompe).
    /// O texto vai em base64 dentro de bash -c, entao aspas, $ e quebras de linha do script chegam intactos; a entrada
    /// vem de /dev/null para nenhum comando ficar parado esperando teclado.
    /// </summary>
    public static string Build(string script, AppContext? app, bool deploy)
    {
        var body = new StringBuilder();
        if (app is not null)
        {
            body.Append("export CYBEREYES_APP=").Append(Quote(app.Name)).Append('\n');
            Export(body, "CYBEREYES_APP_URL", app.Url);
            Export(body, "DEPLOY_PATH", app.DeployPath);
            Export(body, "DEPLOY_REPO", app.RepoUrl);
            Export(body, "DEPLOY_BRANCH", app.Branch);
            if (!string.IsNullOrWhiteSpace(app.DeployPath))
            {
                body.Append(Cd(app.DeployPath)).Append(" || exit 97\n");
            }
        }
        if (deploy)
        {
            body.Append("set -e\n");
        }
        body.Append(script.Replace("\r\n", "\n", StringComparison.Ordinal));
        if (!script.EndsWith('\n'))
        {
            body.Append('\n');
        }
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(body.ToString()));
        return $"bash -lc \"$(printf '%s' '{encoded}' | base64 -d)\" cybereyes </dev/null 2>&1";
    }

    /// <summary>Linha digitada no terminal para abrir na pasta da aplicacao.</summary>
    public static string ChangeDirectory(string path) => Cd(path) + "\n";

    /// <summary>cd com aspas; "~" e "~/..." viram $HOME, que as aspas nao expandiriam.</summary>
    public static string Cd(string path) => path switch
    {
        "~" => "cd -- \"$HOME\"",
        _ when path.StartsWith("~/", StringComparison.Ordinal) => "cd -- \"$HOME\"/" + Quote(path[2..]),
        _ => "cd -- " + Quote(path),
    };

    /// <summary>Aspas simples do bash: ' vira '\''.</summary>
    public static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";

    private static void Export(StringBuilder body, string name, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            body.Append("export ").Append(name).Append('=').Append(Quote(value)).Append('\n');
        }
    }
}
