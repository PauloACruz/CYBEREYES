using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Linq.Expressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Apps;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Apps;

public sealed record SaveAppServerRequest(
    [property: Range(1, int.MaxValue)] int ClientId,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required, StringLength(255, MinimumLength = 1)] string Host,
    [property: Range(1, 65535)] int? Port,
    [property: Required, StringLength(100, MinimumLength = 1)] string Username,
    [property: Required] string AuthMethod,
    [property: StringLength(1000)] string? Password,
    [property: StringLength(16000)] string? PrivateKey,
    [property: StringLength(1000)] string? Passphrase,
    [property: StringLength(100)] string? Provider,
    [property: StringLength(5000)] string? Notes,
    [property: StringLength(100)] string? HostKeyFingerprint = null,
    int? Id = null);

public sealed record SaveWebAppRequest(
    [property: Range(1, int.MaxValue)] int ClientId,
    int? ServerId,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(50)] string? Environment,
    [property: StringLength(100)] string? Stack,
    [property: StringLength(2000)] string? Url,
    [property: StringLength(5000)] string? Notes,
    bool MonitorEnabled,
    string? CheckType,
    [property: StringLength(2000)] string? CheckTarget,
    string? Method,
    [property: StringLength(100)] string? ExpectedStatus,
    [property: StringLength(500)] string? Keyword,
    [property: Range(30, 86400)] int? IntervalSeconds,
    [property: Range(1, 60)] int? TimeoutSeconds,
    [property: Range(1, 20)] int? FailuresBeforeAlert,
    string? AlertSeverity,
    bool IgnoreTlsErrors,
    [property: Range(0, 365)] int? SslWarnDays,
    [property: StringLength(1000)] string? DeployPath,
    [property: StringLength(2000)] string? RepoUrl,
    [property: StringLength(200)] string? Branch,
    [property: StringLength(RemoteScript.MaxScriptLength)] string? DeployScript,
    [property: Range(1, 240)] int? DeployTimeoutMinutes);

public static class AppEndpoints
{
    public static void MapAppEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AppsView);
        var manage = Policies.Permission(Permissions.AppsManage);
        var run = Policies.Permission(Permissions.AppsRun);
        var group = app.MapGroup("/api/webapps").WithTags("Aplicacoes");

        group.MapGet("/overview", OverviewAsync).RequireAuthorization(view);

        group.MapGet("/servers/{id:int}", async (int id, CybereyesDbContext db, CancellationToken ct) =>
            await ServerQuery(db, s => s.Id == id).FirstOrDefaultAsync(ct) is { } server ? Results.Ok(server) : Problems.NotFound("Servidor"))
            .RequireAuthorization(view);
        group.MapPost("/servers", (SaveAppServerRequest r, CybereyesDbContext db, Vault vault, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SaveServerAsync(null, r, db, vault, audit, t, ct)).RequireAuthorization(manage);
        group.MapPut("/servers/{id:int}", (int id, SaveAppServerRequest r, CybereyesDbContext db, Vault vault, IAuditService audit, TimeProvider t,
            CancellationToken ct) => SaveServerAsync(id, r, db, vault, audit, t, ct)).RequireAuthorization(manage);
        group.MapDelete("/servers/{id:int}", DeleteServerAsync).RequireAuthorization(manage);
        group.MapPost("/servers/test", TestDraftAsync).RequireAuthorization(manage);
        group.MapPost("/servers/{id:int}/test", TestSavedAsync).RequireAuthorization(run);
        group.MapPost("/servers/{id:int}/reset-host-key", ResetHostKeyAsync).RequireAuthorization(manage);
        group.MapPost("/servers/{id:int}/reveal", RevealServerAsync).RequireAuthorization(view)
            .RequireAuthorization(Policies.Permission(Permissions.CredentialsReveal));

        group.MapGet("/{id:int}", AppDetailAsync).RequireAuthorization(view);
        group.MapPost("/", (SaveWebAppRequest r, CybereyesDbContext db, AlertService alerts, IAuditService audit, IHubContext<ConsoleHub> hub, TimeProvider t,
            CancellationToken ct) => SaveAppAsync(null, r, db, alerts, audit, hub, t, ct)).RequireAuthorization(manage);
        group.MapPut("/{id:int}", (int id, SaveWebAppRequest r, CybereyesDbContext db, AlertService alerts, IAuditService audit, IHubContext<ConsoleHub> hub,
            TimeProvider t, CancellationToken ct) => SaveAppAsync(id, r, db, alerts, audit, hub, t, ct)).RequireAuthorization(manage);
        group.MapDelete("/{id:int}", DeleteAppAsync).RequireAuthorization(manage);
        group.MapPost("/{id:int}/check", CheckNowAsync).RequireAuthorization(view);
        group.MapGet("/{id:int}/checks", ChecksAsync).RequireAuthorization(view);

        AppRunEndpoints.Map(group, view, manage, run);
    }

    internal static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);

    internal static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    internal static IResult VaultDisabled() =>
        Problems.Create(StatusCodes.Status503ServiceUnavailable, "Cofre de credenciais sem chave configurada (VAULT_KEY)", "VAULT_DISABLED");

    internal static IResult SshProblem(SshFailureException failure) => TypedResults.Problem(title: failure.Message, statusCode: failure.Code switch
    {
        SshFailureException.NoSecret => StatusCodes.Status400BadRequest,
        SshFailureException.HostKeyMismatch => StatusCodes.Status409Conflict,
        SshFailureException.VaultKey => StatusCodes.Status500InternalServerError,
        _ => StatusCodes.Status502BadGateway,
    }, extensions: new Dictionary<string, object?> { ["code"] = failure.Code, ["presentedFingerprint"] = failure.PresentedFingerprint });

    // Visao geral

    private static IQueryable<ServerDto> ServerQuery(CybereyesDbContext db, Expression<Func<AppServer, bool>> filter) =>
        from s in db.AppServers.AsNoTracking().Where(filter)
        join c in db.Clients on s.ClientId equals c.Id
        orderby c.Name, s.Name
        select new ServerDto(s.Id, s.ClientId, c.Name, s.Name, s.Host, s.Port, s.Username, s.AuthMethod, s.PasswordEncrypted != null,
            s.PrivateKeyEncrypted != null, s.PassphraseEncrypted != null, s.HostKeyFingerprint, s.HostKeyAlgorithm, s.Provider, s.Notes, s.LastConnectedAt,
            s.CreatedAt, s.UpdatedAt);

    private static async Task<IResult> OverviewAsync(CybereyesDbContext db, TimeProvider time, CancellationToken ct, int? clientId = null, string? search = null)
    {
        var term = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";
        var servers = await ServerQuery(db, s => (clientId == null || s.ClientId == clientId) &&
                (term == null || EF.Functions.ILike(s.Name, term) || EF.Functions.ILike(s.Host, term) ||
                 db.WebApps.Any(w => w.ServerId == s.Id && (EF.Functions.ILike(w.Name, term) || (w.Url != null && EF.Functions.ILike(w.Url, term))))))
            .ToListAsync(ct);
        var serverIds = servers.Select(s => s.Id).ToList();
        var since = time.GetUtcNow().AddHours(-24);
        var apps = await (
            from w in db.WebApps.AsNoTracking()
            where (clientId == null || w.ClientId == clientId) &&
                  (term == null || EF.Functions.ILike(w.Name, term) || (w.Url != null && EF.Functions.ILike(w.Url, term)) ||
                   (w.ServerId != null && serverIds.Contains(w.ServerId.Value)))
            join c in db.Clients on w.ClientId equals c.Id
            orderby w.Name
            select new
            {
                w.Id, w.ClientId, ClientName = c.Name, w.ServerId, w.Name, w.Environment, w.Stack, w.Url, w.MonitorEnabled, w.CheckType, w.CheckTarget,
                w.IntervalSeconds, w.Status, w.StatusChangedAt, w.LastCheckedAt, w.LastLatencyMs, w.LastStatusCode, w.LastError, w.SslExpiresAt,
                HasDeploy = w.ServerId != null && w.DeployScript != null,
                Total = db.WebAppChecks.Count(x => x.WebAppId == w.Id && x.Time >= since),
                Up = db.WebAppChecks.Count(x => x.WebAppId == w.Id && x.Time >= since && x.Up),
            }).ToListAsync(ct);
        return TypedResults.Ok(new
        {
            servers,
            apps = apps.Select(a => new
            {
                a.Id, a.ClientId, a.ClientName, a.ServerId, a.Name, a.Environment, a.Stack, a.Url, a.MonitorEnabled, a.CheckType, a.CheckTarget,
                a.IntervalSeconds, a.Status, a.StatusChangedAt, a.LastCheckedAt, a.LastLatencyMs, a.LastStatusCode, a.LastError, a.SslExpiresAt, a.HasDeploy,
                uptime24h = a.Total == 0 ? (double?)null : Math.Round(100.0 * a.Up / a.Total, 2),
            }),
        });
    }

    // Servidores

    private static async Task<IResult?> ValidateServerAsync(SaveAppServerRequest r, CybereyesDbContext db, CancellationToken ct)
    {
        if (!await db.Clients.AnyAsync(c => c.Id == r.ClientId, ct))
        {
            return Problems.Validation("clientId", "Cliente nao encontrado");
        }
        if (!SshAuthMethod.All.Contains(r.AuthMethod))
        {
            return Problems.Validation("authMethod", "Use password ou key");
        }
        if (Uri.CheckHostName(r.Host.Trim()) == UriHostNameType.Unknown)
        {
            return Problems.Validation("host", "Informe um IP ou nome de host valido, sem protocolo nem porta");
        }
        return null;
    }

    private static async Task<IResult> SaveServerAsync(int? id, SaveAppServerRequest r, CybereyesDbContext db, Vault vault, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if (await ValidateServerAsync(r, db, ct) is { } invalid)
        {
            return invalid;
        }
        var hasNewSecret = !string.IsNullOrEmpty(r.Password) || !string.IsNullOrEmpty(r.PrivateKey) || !string.IsNullOrEmpty(r.Passphrase);
        if (hasNewSecret && !vault.Enabled)
        {
            return VaultDisabled();
        }
        if (r.AuthMethod == SshAuthMethod.Key && !string.IsNullOrEmpty(r.PrivateKey))
        {
            try
            {
                SshConnector.LoadKey(r.PrivateKey, r.Passphrase).Dispose();
            }
            catch (SshFailureException failure)
            {
                return Problems.Validation("privateKey", failure.Message);
            }
        }

        AppServer server;
        if (id is null)
        {
            server = new AppServer { Name = r.Name.Trim(), Host = r.Host.Trim(), Username = r.Username.Trim(), HostKeyFingerprint = Clean(r.HostKeyFingerprint) };
            db.AppServers.Add(server);
        }
        else
        {
            var found = await db.AppServers.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Servidor");
            }
            server = found;
            // Outro endereco e outra maquina: a chave fixada deixa de valer e a credencial salva nao vai para la sem ser
            // informada de novo (senao quem edita, sem poder revelar, mandaria a senha para um servidor qualquer).
            if (!SamePlace(server, r))
            {
                var newSecret = r.AuthMethod == SshAuthMethod.Key ? !string.IsNullOrEmpty(r.PrivateKey) : !string.IsNullOrEmpty(r.Password);
                if (!newSecret && (server.PasswordEncrypted ?? server.PrivateKeyEncrypted) is not null)
                {
                    return Problems.Validation(r.AuthMethod == SshAuthMethod.Key ? "privateKey" : "password",
                        "Ao mudar o endereco ou a porta, informe a credencial SSH de novo");
                }
                server.HostKeyFingerprint = null;
                server.HostKeyAlgorithm = null;
            }
        }
        if (id is not null && server.ClientId != r.ClientId && await db.WebApps.AnyAsync(w => w.ServerId == server.Id && w.ClientId != r.ClientId, ct))
        {
            return Problems.Validation("clientId", "O servidor tem aplicacoes de outro cliente: mova-as antes");
        }

        server.ClientId = r.ClientId;
        server.Name = r.Name.Trim();
        server.Host = r.Host.Trim();
        server.Port = r.Port ?? 22;
        server.Username = r.Username.Trim();
        server.Provider = Clean(r.Provider);
        server.Notes = Clean(r.Notes);
        if (server.AuthMethod != r.AuthMethod)
        {
            server.PasswordEncrypted = null;
            server.PrivateKeyEncrypted = null;
            server.PassphraseEncrypted = null;
            server.AuthMethod = r.AuthMethod;
        }
        if (r.AuthMethod == SshAuthMethod.Password)
        {
            if (!string.IsNullOrEmpty(r.Password))
            {
                server.PasswordEncrypted = vault.Encrypt(r.Password);
            }
        }
        else if (!string.IsNullOrEmpty(r.PrivateKey))
        {
            server.PrivateKeyEncrypted = vault.Encrypt(r.PrivateKey.Trim());
            server.PassphraseEncrypted = string.IsNullOrEmpty(r.Passphrase) ? null : vault.Encrypt(r.Passphrase);
        }
        else if (!string.IsNullOrEmpty(r.Passphrase))
        {
            server.PassphraseEncrypted = vault.Encrypt(r.Passphrase);
        }
        server.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "app-server.create" : "app-server.update", "app-server", Id(server.Id),
            $"Servidor {server.Name} ({server.Username}@{server.Host}:{server.Port})", cancellationToken: ct);
        var body = await ServerQuery(db, s => s.Id == server.Id).FirstAsync(ct);
        return id is null ? TypedResults.Created($"/api/webapps/servers/{server.Id}", body) : TypedResults.Ok(body);
    }

    private static async Task<IResult> DeleteServerAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var server = await db.AppServers.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (server is null)
        {
            return Problems.NotFound("Servidor");
        }
        db.AppServers.Remove(server);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("app-server.delete", "app-server", Id(id), $"Servidor {server.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> TestDraftAsync(SaveAppServerRequest r, CybereyesDbContext db, Vault vault, TimeProvider time, CancellationToken ct)
    {
        if (await ValidateServerAsync(r, db, ct) is { } invalid)
        {
            return invalid;
        }
        AppServer? saved = null;
        if (r.Id is { } savedId)
        {
            saved = await db.AppServers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == savedId, ct);
            if (saved is null)
            {
                return Problems.NotFound("Servidor");
            }
        }
        // Campos de segredo vazios na edicao: usa o que esta salvo, desde que o metodo e o endereco nao tenham mudado.
        var samePlace = saved is not null && SamePlace(saved, r);
        var reuse = samePlace && saved!.AuthMethod == r.AuthMethod;
        if (reuse && !vault.Enabled)
        {
            return VaultDisabled();
        }
        string? Stored(string? encrypted) => reuse && encrypted is not null ? vault.Decrypt(encrypted) : null;
        SshTarget target;
        try
        {
            target = new SshTarget(r.Host.Trim(), r.Port ?? 22, r.Username.Trim(), r.AuthMethod,
                string.IsNullOrEmpty(r.Password) ? Stored(saved?.PasswordEncrypted) : r.Password,
                string.IsNullOrEmpty(r.PrivateKey) ? Stored(saved?.PrivateKeyEncrypted) : r.PrivateKey,
                string.IsNullOrEmpty(r.Passphrase) && string.IsNullOrEmpty(r.PrivateKey) ? Stored(saved?.PassphraseEncrypted) : r.Passphrase,
                samePlace ? saved!.HostKeyFingerprint : null);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return Problems.Create(StatusCodes.Status500InternalServerError, "Nao foi possivel decifrar: a chave do cofre mudou?", "VAULT_KEY_MISMATCH");
        }
        return TypedResults.Ok(await ProbeServerAsync(target, null, db, time, ct));
    }

    private static bool SamePlace(AppServer saved, SaveAppServerRequest r) =>
        string.Equals(saved.Host, r.Host.Trim(), StringComparison.OrdinalIgnoreCase) && saved.Port == (r.Port ?? 22);

    private static async Task<IResult> TestSavedAsync(int id, CybereyesDbContext db, Vault vault, TimeProvider time, CancellationToken ct)
    {
        var server = await db.AppServers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
        if (server is null)
        {
            return Problems.NotFound("Servidor");
        }
        if (!vault.Enabled)
        {
            return VaultDisabled();
        }
        try
        {
            return TypedResults.Ok(await ProbeServerAsync(SshTarget.FromServer(server, vault), server.Id, db, time, ct));
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return Problems.Create(StatusCodes.Status500InternalServerError, "Nao foi possivel decifrar: a chave do cofre mudou?", "VAULT_KEY_MISMATCH");
        }
    }

    private const string SystemProbe =
        "uname -srm; (. /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\"); uptime; " +
        "(command -v docker >/dev/null && docker --version) 2>/dev/null; true";

    /// <summary>Conecta, roda um comando de leitura do sistema e devolve o resultado sem lancar (o formulario mostra o erro).</summary>
    private static async Task<object> ProbeServerAsync(SshTarget target, int? serverId, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        try
        {
            using var session = await SshConnector.ConnectAsync(target, ct);
            if (serverId is { } id)
            {
                await SshConnector.RecordConnectionAsync(db, id, session, time, ct);
            }
            using var command = session.Client.CreateCommand(SystemProbe);
            command.CommandTimeout = TimeSpan.FromSeconds(15);
            await command.ExecuteAsync(ct);
            var system = command.Result.Trim();
            return new
            {
                ok = true, error = (string?)null, code = (string?)null, fingerprint = session.Fingerprint, algorithm = session.Algorithm,
                system = system.Length > 2000 ? system[..2000] : system, pinned = target.PinnedFingerprint is not null,
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            var failure = SshConnector.Translate(ex, target);
            return new
            {
                ok = false, error = (string?)failure.Message, code = (string?)failure.Code, fingerprint = failure.PresentedFingerprint,
                algorithm = (string?)null, system = (string?)null, pinned = target.PinnedFingerprint is not null,
            };
        }
    }

    private static async Task<IResult> ResetHostKeyAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var server = await db.AppServers.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (server is null)
        {
            return Problems.NotFound("Servidor");
        }
        var previous = server.HostKeyFingerprint;
        server.HostKeyFingerprint = null;
        server.HostKeyAlgorithm = null;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("app-server.host-key-reset", "app-server", Id(id),
            $"Chave SSH de {server.Name} liberada para nova fixacao (anterior SHA256:{previous ?? "nenhuma"})", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> RevealServerAsync(int id, CybereyesDbContext db, Vault vault, IAuditService audit, CancellationToken ct)
    {
        if (!vault.Enabled)
        {
            return VaultDisabled();
        }
        var server = await db.AppServers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
        if (server is null)
        {
            return Problems.NotFound("Servidor");
        }
        try
        {
            var target = SshTarget.FromServer(server, vault);
            await audit.LogAsync("app-server.secret-reveal", "app-server", Id(id), $"Credencial SSH revelada: {server.Name}", cancellationToken: ct);
            return TypedResults.Ok(new { password = target.Password, privateKey = target.PrivateKey, passphrase = target.Passphrase });
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return Problems.Create(StatusCodes.Status500InternalServerError, "Nao foi possivel decifrar: a chave do cofre mudou?", "VAULT_KEY_MISMATCH");
        }
    }

    // Aplicacoes

    private static async Task<IResult> AppDetailAsync(int id, CybereyesDbContext db, CancellationToken ct)
    {
        var row = await (
            from w in db.WebApps.AsNoTracking()
            where w.Id == id
            join c in db.Clients on w.ClientId equals c.Id
            join s in db.AppServers on w.ServerId equals s.Id into sg
            from s in sg.DefaultIfEmpty()
            select new
            {
                App = w, ClientName = c.Name,
                Server = s == null ? null : new { s.Id, s.Name, s.Host, s.Port, s.Username },
                LastDeploy = db.AppRuns.Where(r => r.WebAppId == w.Id && r.Kind == AppRunKind.Deploy).OrderByDescending(r => r.StartedAt)
                    .Select(r => new { r.Id, r.Status, r.ExitCode, r.StartedAt, r.FinishedAt, r.StartedBy }).FirstOrDefault(),
            }).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return Problems.NotFound("Aplicacao");
        }
        var a = row.App;
        return TypedResults.Ok(new
        {
            a.Id, a.ClientId, row.ClientName, a.ServerId, server = row.Server, a.Name, a.Environment, a.Stack, a.Url, a.Notes, a.MonitorEnabled, a.CheckType,
            a.CheckTarget, a.Method, a.ExpectedStatus, a.Keyword, a.IntervalSeconds, a.TimeoutSeconds, a.FailuresBeforeAlert, a.AlertSeverity,
            a.IgnoreTlsErrors, a.SslWarnDays, a.Status, a.StatusChangedAt, a.LastCheckedAt, a.LastLatencyMs, a.LastStatusCode, a.LastError,
            a.ConsecutiveFailures, a.SslExpiresAt, a.DeployPath, a.RepoUrl, a.Branch, a.DeployScript, a.DeployTimeoutMinutes, a.CreatedAt, a.UpdatedAt,
            hasDeploy = a.ServerId != null && a.DeployScript != null, lastDeploy = row.LastDeploy,
        });
    }

    private static async Task<IResult?> ValidateAppAsync(SaveWebAppRequest r, CybereyesDbContext db, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (!await db.Clients.AnyAsync(c => c.Id == r.ClientId, ct))
        {
            errors["clientId"] = ["Cliente nao encontrado"];
        }
        if (r.ServerId is { } serverId && !await db.AppServers.AnyAsync(s => s.Id == serverId && s.ClientId == r.ClientId, ct))
        {
            errors["serverId"] = ["O servidor precisa ser do mesmo cliente"];
        }
        if (Clean(r.Url) is { } url && !IsHttpUrl(url))
        {
            errors["url"] = ["Use uma URL http:// ou https://"];
        }
        var type = r.CheckType ?? WebAppCheckType.Http;
        var target = Clean(r.CheckTarget) ?? (type == WebAppCheckType.Http ? Clean(r.Url) : null);
        if (!WebAppCheckType.All.Contains(type))
        {
            errors["checkType"] = ["Use http ou tcp"];
        }
        else if (target is null)
        {
            errors["checkTarget"] = [type == WebAppCheckType.Http ? "Informe a URL a verificar" : "Informe host:porta"];
        }
        else if (type == WebAppCheckType.Http && !IsHttpUrl(target))
        {
            errors["checkTarget"] = ["Use uma URL http:// ou https://"];
        }
        else if (type == WebAppCheckType.Tcp && !TcpTarget.TryParse(target, out _, out _))
        {
            errors["checkTarget"] = ["Use host:porta, por exemplo 10.0.0.5:5432"];
        }
        if (r.Method is not (null or "GET" or "HEAD"))
        {
            errors["method"] = ["Use GET ou HEAD"];
        }
        if (Clean(r.ExpectedStatus) is { } expected && !StatusMatcher.IsValid(expected))
        {
            errors["expectedStatus"] = ["Use codigos e faixas entre 100 e 599, como 200-399 ou 200,301"];
        }
        if (r.AlertSeverity is { } severity && !Severity.All.Contains(severity))
        {
            errors["alertSeverity"] = ["Use info, warning ou error"];
        }
        if (Clean(r.DeployScript) is not null && r.ServerId is null)
        {
            errors["deployScript"] = ["O deploy precisa de um servidor SSH"];
        }
        if (Clean(r.DeployPath) is { } path && !(path.StartsWith('/') || path == "~" || path.StartsWith("~/", StringComparison.Ordinal)))
        {
            errors["deployPath"] = ["Use um caminho absoluto (/srv/app) ou a partir da pasta do usuario (~/app)"];
        }
        if ((r.TimeoutSeconds ?? 10) >= (r.IntervalSeconds ?? 60))
        {
            errors["timeoutSeconds"] = ["O tempo limite precisa ser menor que o intervalo"];
        }
        return errors.Count == 0 ? null : Problems.Validation(errors);
    }

    private static bool IsHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && !string.IsNullOrEmpty(uri.Host);

    private static async Task<IResult> SaveAppAsync(int? id, SaveWebAppRequest r, CybereyesDbContext db, AlertService alerts, IAuditService audit,
        IHubContext<ConsoleHub> hub, TimeProvider time, CancellationToken ct)
    {
        if (await ValidateAppAsync(r, db, ct) is { } invalid)
        {
            return invalid;
        }
        var type = r.CheckType ?? WebAppCheckType.Http;
        var target = Clean(r.CheckTarget) ?? Clean(r.Url)!;
        WebApp webApp;
        if (id is null)
        {
            webApp = new WebApp { Name = r.Name.Trim(), CheckTarget = target };
            db.WebApps.Add(webApp);
        }
        else
        {
            var found = await db.WebApps.FirstOrDefaultAsync(w => w.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Aplicacao");
            }
            webApp = found;
        }
        var monitorChanged = id is null || webApp.MonitorEnabled != r.MonitorEnabled || webApp.CheckType != type || webApp.CheckTarget != target;
        webApp.ClientId = r.ClientId;
        webApp.ServerId = r.ServerId;
        webApp.Name = r.Name.Trim();
        webApp.Environment = Clean(r.Environment);
        webApp.Stack = Clean(r.Stack);
        webApp.Url = Clean(r.Url);
        webApp.Notes = Clean(r.Notes);
        webApp.MonitorEnabled = r.MonitorEnabled;
        webApp.CheckType = type;
        webApp.CheckTarget = target;
        webApp.Method = r.Method ?? "GET";
        webApp.ExpectedStatus = Clean(r.ExpectedStatus) ?? "200-399";
        webApp.Keyword = Clean(r.Keyword);
        webApp.IntervalSeconds = r.IntervalSeconds ?? 60;
        webApp.TimeoutSeconds = r.TimeoutSeconds ?? 10;
        webApp.FailuresBeforeAlert = r.FailuresBeforeAlert ?? 2;
        webApp.AlertSeverity = r.AlertSeverity ?? Severity.Error;
        webApp.IgnoreTlsErrors = r.IgnoreTlsErrors;
        webApp.SslWarnDays = r.SslWarnDays ?? 14;
        webApp.DeployPath = Clean(r.DeployPath);
        webApp.RepoUrl = Clean(r.RepoUrl);
        webApp.Branch = Clean(r.Branch);
        webApp.DeployScript = string.IsNullOrWhiteSpace(r.DeployScript) ? null : r.DeployScript.Replace("\r\n", "\n", StringComparison.Ordinal);
        webApp.DeployTimeoutMinutes = r.DeployTimeoutMinutes ?? 30;
        var now = time.GetUtcNow();
        webApp.UpdatedAt = now;
        // A proxima verificacao sai ja; o estado recomeca quando o alvo ou o monitoramento mudam.
        webApp.NextCheckAt = now;
        if (monitorChanged)
        {
            webApp.Status = r.MonitorEnabled ? WebAppStatus.Pending : WebAppStatus.Paused;
            webApp.StatusChangedAt = now;
            webApp.ConsecutiveFailures = 0;
            if (!r.MonitorEnabled || id is not null)
            {
                webApp.LastError = null;
            }
        }
        await db.SaveChangesAsync(ct);
        if (id is not null && monitorChanged)
        {
            await alerts.ResolveWebAppAsync(webApp.Id, null, ct);
        }
        await audit.LogAsync(id is null ? "webapp.create" : "webapp.update", "webapp", Id(webApp.Id), $"Aplicacao {webApp.Name}", cancellationToken: ct);
        await hub.Clients.ForClient(webApp.ClientId).SendAsync("webAppChanged", new { id = webApp.Id, status = webApp.Status, previous = (string?)null }, ct);
        return id is null ? TypedResults.Created($"/api/webapps/{webApp.Id}", await AppDetailBody(webApp.Id, db, ct)) : TypedResults.Ok(await AppDetailBody(webApp.Id, db, ct));
    }

    private static async Task<object?> AppDetailBody(int id, CybereyesDbContext db, CancellationToken ct) =>
        await AppDetailAsync(id, db, ct) is IValueHttpResult { Value: { } value } ? value : null;

    private static async Task<IResult> DeleteAppAsync(int id, CybereyesDbContext db, AlertService alerts, IAuditService audit, CancellationToken ct)
    {
        var webApp = await db.WebApps.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (webApp is null)
        {
            return Problems.NotFound("Aplicacao");
        }
        db.WebApps.Remove(webApp);
        await db.SaveChangesAsync(ct);
        await alerts.BroadcastAsync(ct);
        await audit.LogAsync("webapp.delete", "webapp", Id(id), $"Aplicacao {webApp.Name} excluida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> CheckNowAsync(int id, CybereyesDbContext db, WebAppMonitor monitor, CancellationToken ct)
    {
        if (!await db.WebApps.AnyAsync(w => w.Id == id, ct))
        {
            return Problems.NotFound("Aplicacao");
        }
        var result = await monitor.CheckNowAsync(id, ct);
        return TypedResults.Ok(result);
    }

    private static async Task<IResult> ChecksAsync(int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct, int? hours = null)
    {
        if (!await db.WebApps.AnyAsync(w => w.Id == id, ct))
        {
            return Problems.NotFound("Aplicacao");
        }
        var span = Math.Clamp(hours ?? 24, 1, 24 * WebAppMonitor.RetentionDays);
        var now = time.GetUtcNow();
        var from = now.AddHours(-span);
        var raw = await db.WebAppChecks.AsNoTracking().Where(c => c.WebAppId == id && c.Time >= from).OrderBy(c => c.Time)
            .Select(c => new { c.Time, c.Up, c.LatencyMs, c.StatusCode, c.Error }).ToListAsync(ct);

        // Ate ~300 pontos: cada balde guarda a latencia media e se houve falha nele.
        var bucket = TimeSpan.FromSeconds(Math.Max(60, span * 3600 / 300));
        var points = raw.GroupBy(c => c.Time.UtcTicks / bucket.Ticks).Select(g =>
        {
            var latencies = g.Where(c => c.LatencyMs is not null).Select(c => c.LatencyMs!.Value).ToList();
            var failure = g.LastOrDefault(c => !c.Up);
            return new
            {
                time = new DateTimeOffset(g.Key * bucket.Ticks, TimeSpan.Zero),
                up = failure is null,
                latencyMs = latencies.Count == 0 ? (int?)null : (int)Math.Round(latencies.Average()),
                failures = g.Count(c => !c.Up),
                checks = g.Count(),
                error = failure?.Error,
            };
        }).ToList();

        async Task<double?> UptimeAsync(TimeSpan window)
        {
            var start = now - window;
            var checks = db.WebAppChecks.AsNoTracking().Where(c => c.WebAppId == id && c.Time >= start);
            var total = await checks.CountAsync(ct);
            return total == 0 ? null : Math.Round(100.0 * await checks.CountAsync(c => c.Up, ct) / total, 2);
        }

        var outages = await db.Alerts.AsNoTracking().Where(a => a.WebAppId == id && a.AlertType == AlertTypes.WebAppDown)
            .OrderByDescending(a => a.CreatedAt).Take(20)
            .Select(a => new { a.Id, start = a.CreatedAt, end = a.ResolvedAt, a.Resolved, a.Message }).ToListAsync(ct);

        return TypedResults.Ok(new
        {
            hours = span, points,
            uptime = new { h24 = await UptimeAsync(TimeSpan.FromHours(24)), d7 = await UptimeAsync(TimeSpan.FromDays(7)), d30 = await UptimeAsync(TimeSpan.FromDays(30)) },
            outages,
        });
    }
}

public sealed record ServerDto(int Id, int ClientId, string ClientName, string Name, string Host, int Port, string Username, string AuthMethod, bool HasPassword,
    bool HasPrivateKey, bool HasPassphrase, string? HostKeyFingerprint, string? HostKeyAlgorithm, string? Provider, string? Notes,
    DateTimeOffset? LastConnectedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
