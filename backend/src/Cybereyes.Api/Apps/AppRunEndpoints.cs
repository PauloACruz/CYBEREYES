using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Inventory;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Apps;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Apps;

public sealed record SaveAppCommandRequest(
    int? ServerId,
    int? WebAppId,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required, StringLength(RemoteScript.MaxScriptLength, MinimumLength = 1)] string Script,
    [property: StringLength(1000)] string? Description,
    bool Confirm,
    [property: Range(1, 240)] int? TimeoutMinutes,
    int? SortOrder);

public sealed record RunCommandRequest(
    [property: StringLength(RemoteScript.MaxScriptLength)] string? Script,
    int? CommandId,
    int? WebAppId,
    [property: Range(1, 240)] int? TimeoutMinutes);

public static class AppRunEndpoints
{
    private const int AdHocTimeoutMinutes = 10;

    internal static void Map(RouteGroupBuilder group, string view, string manage, string run)
    {
        group.MapGet("/commands", CommandsAsync).RequireAuthorization(view);
        group.MapPost("/commands", (SaveAppCommandRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t, CancellationToken ct) =>
            SaveCommandAsync(null, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        group.MapPut("/commands/{id:int}", (int id, SaveAppCommandRequest r, ClaimsPrincipal p, CybereyesDbContext db, IAuditService audit, TimeProvider t,
            CancellationToken ct) => SaveCommandAsync(id, r, p, db, audit, t, ct)).RequireAuthorization(manage);
        group.MapDelete("/commands/{id:int}", DeleteCommandAsync).RequireAuthorization(manage);

        group.MapPost("/servers/{id:int}/run", RunAsync).RequireAuthorization(run);
        group.MapPost("/{id:int}/deploy", DeployAsync).RequireAuthorization(run);
        group.MapGet("/runs", RunsAsync).RequireAuthorization(view);
        group.MapGet("/runs/{id:long}", RunDetailAsync).RequireAuthorization(view);
        group.MapPost("/runs/{id:long}/cancel", CancelAsync).RequireAuthorization(run);
    }

    // Comandos salvos

    private static async Task<IResult> CommandsAsync(CybereyesDbContext db, CancellationToken ct, int? serverId = null, int? webAppId = null)
    {
        var query = db.AppCommands.AsNoTracking();
        if (webAppId is { } appId)
        {
            // Na aplicacao aparecem os dela e os do servidor onde ela roda.
            var appServer = await db.WebApps.AsNoTracking().Where(w => w.Id == appId).Select(w => w.ServerId).FirstOrDefaultAsync(ct);
            query = query.Where(c => c.WebAppId == appId || (appServer != null && c.ServerId == appServer));
        }
        else if (serverId is { } sId)
        {
            query = query.Where(c => c.ServerId == sId);
        }
        return TypedResults.Ok(await query.OrderBy(c => c.WebAppId == null).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
            .Select(c => new { c.Id, c.ServerId, c.WebAppId, c.Name, c.Script, c.Description, c.Confirm, c.TimeoutMinutes, c.SortOrder, c.UpdatedAt, c.UpdatedBy })
            .ToListAsync(ct));
    }

    private static async Task<IResult> SaveCommandAsync(int? id, SaveAppCommandRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IAuditService audit,
        TimeProvider time, CancellationToken ct)
    {
        if ((r.ServerId is null) == (r.WebAppId is null))
        {
            return Problems.Validation("serverId", "Informe o servidor ou a aplicacao do comando (um dos dois)");
        }
        if (r.ServerId is { } serverId && !await db.AppServers.AnyAsync(s => s.Id == serverId, ct))
        {
            return Problems.Validation("serverId", "Servidor nao encontrado");
        }
        if (r.WebAppId is { } appId && !await db.WebApps.AnyAsync(w => w.Id == appId && w.ServerId != null, ct))
        {
            return Problems.Validation("webAppId", "Aplicacao nao encontrada ou sem servidor SSH");
        }
        AppCommand command;
        var actor = await TicketEndpoints.ActorNameAsync(principal, db, ct);
        if (id is null)
        {
            command = new AppCommand { Name = r.Name.Trim(), Script = r.Script, UpdatedBy = actor };
            db.AppCommands.Add(command);
        }
        else
        {
            var found = await db.AppCommands.FirstOrDefaultAsync(c => c.Id == id, ct);
            if (found is null)
            {
                return Problems.NotFound("Comando");
            }
            command = found;
        }
        command.ServerId = r.ServerId;
        command.WebAppId = r.WebAppId;
        command.Name = r.Name.Trim();
        command.Script = r.Script.Replace("\r\n", "\n", StringComparison.Ordinal);
        command.Description = AppEndpoints.Clean(r.Description);
        command.Confirm = r.Confirm;
        command.TimeoutMinutes = r.TimeoutMinutes ?? AdHocTimeoutMinutes;
        command.SortOrder = r.SortOrder ?? 0;
        command.UpdatedAt = time.GetUtcNow();
        command.UpdatedBy = actor;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(id is null ? "app-command.create" : "app-command.update", "app-command", AppEndpoints.Id(command.Id), $"Comando {command.Name}",
            cancellationToken: ct);
        var body = new
        {
            command.Id, command.ServerId, command.WebAppId, command.Name, command.Script, command.Description, command.Confirm, command.TimeoutMinutes,
            command.SortOrder, command.UpdatedAt, command.UpdatedBy,
        };
        return id is null ? TypedResults.Created($"/api/webapps/commands/{command.Id}", body) : TypedResults.Ok(body);
    }

    private static async Task<IResult> DeleteCommandAsync(int id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var command = await db.AppCommands.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (command is null)
        {
            return Problems.NotFound("Comando");
        }
        db.AppCommands.Remove(command);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("app-command.delete", "app-command", AppEndpoints.Id(id), $"Comando {command.Name} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    // Execucoes

    private static async Task<IResult> RunAsync(int id, RunCommandRequest r, ClaimsPrincipal principal, CybereyesDbContext db, Vault vault, AppRunner runner,
        IAuditService audit, IHubContext<ConsoleHub> hub, TimeProvider time, CancellationToken ct)
    {
        var server = await db.AppServers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
        if (server is null)
        {
            return Problems.NotFound("Servidor");
        }
        string script;
        string title;
        var webAppId = r.WebAppId;
        var timeout = r.TimeoutMinutes ?? AdHocTimeoutMinutes;
        int? commandId = null;
        if (r.CommandId is { } cid)
        {
            var saved = await db.AppCommands.AsNoTracking().FirstOrDefaultAsync(c => c.Id == cid, ct);
            var savedApp = saved?.WebAppId is { } savedAppId
                ? await db.WebApps.AsNoTracking().Where(w => w.Id == savedAppId).Select(w => w.ServerId).FirstOrDefaultAsync(ct)
                : null;
            if (saved is null || (saved.ServerId ?? savedApp) != id)
            {
                return Problems.NotFound("Comando");
            }
            script = saved.Script;
            title = saved.Name;
            webAppId = saved.WebAppId ?? webAppId;
            timeout = saved.TimeoutMinutes;
            commandId = saved.Id;
        }
        else if (!string.IsNullOrWhiteSpace(r.Script))
        {
            script = r.Script;
            var firstLine = r.Script.Trim().Split('\n')[0].Trim();
            title = firstLine.Length > 120 ? firstLine[..120] + "..." : firstLine;
        }
        else
        {
            return Problems.Validation("script", "Informe o comando ou escolha um comando salvo");
        }

        WebApp? webApp = null;
        if (webAppId is { } appId)
        {
            webApp = await db.WebApps.AsNoTracking().FirstOrDefaultAsync(w => w.Id == appId && w.ServerId == id, ct);
            if (webApp is null)
            {
                return Problems.Validation("webAppId", "A aplicacao nao roda neste servidor");
            }
        }
        return await LaunchAsync(server, webApp, AppRunKind.Command, title, script, commandId, TimeSpan.FromMinutes(timeout), principal, db, vault, runner,
            audit, hub, time, ct);
    }

    private static async Task<IResult> DeployAsync(int id, ClaimsPrincipal principal, CybereyesDbContext db, Vault vault, AppRunner runner, IAuditService audit,
        IHubContext<ConsoleHub> hub, TimeProvider time, CancellationToken ct)
    {
        var webApp = await db.WebApps.AsNoTracking().FirstOrDefaultAsync(w => w.Id == id, ct);
        if (webApp is null)
        {
            return Problems.NotFound("Aplicacao");
        }
        if (webApp.ServerId is not { } serverId || string.IsNullOrWhiteSpace(webApp.DeployScript))
        {
            return Problems.BadRequest("Configure o servidor e o script de deploy da aplicacao");
        }
        if (await db.AppRuns.AnyAsync(r => r.WebAppId == id && r.Kind == AppRunKind.Deploy && r.Status == AppRunStatus.Running, ct))
        {
            return Problems.Conflict("Ja ha um deploy desta aplicacao em andamento");
        }
        var server = await db.AppServers.AsNoTracking().FirstAsync(s => s.Id == serverId, ct);
        return await LaunchAsync(server, webApp, AppRunKind.Deploy, $"Deploy de {webApp.Name}", webApp.DeployScript, null,
            TimeSpan.FromMinutes(webApp.DeployTimeoutMinutes), principal, db, vault, runner, audit, hub, time, ct);
    }

    private static async Task<IResult> LaunchAsync(AppServer server, WebApp? webApp, string kind, string title, string script, int? commandId, TimeSpan timeout,
        ClaimsPrincipal principal, CybereyesDbContext db, Vault vault, AppRunner runner, IAuditService audit, IHubContext<ConsoleHub> hub, TimeProvider time,
        CancellationToken ct)
    {
        if (!vault.Enabled)
        {
            return AppEndpoints.VaultDisabled();
        }
        SshTarget target;
        try
        {
            target = SshTarget.FromServer(server, vault);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return Problems.Create(StatusCodes.Status500InternalServerError, "Nao foi possivel decifrar: a chave do cofre mudou?", "VAULT_KEY_MISMATCH");
        }
        if (!target.HasSecret)
        {
            return Problems.BadRequest("Servidor sem senha ou chave SSH cadastrada");
        }
        var context = webApp is null ? null : new RemoteScript.AppContext(webApp.Name, webApp.Url, webApp.DeployPath, webApp.RepoUrl, webApp.Branch);
        var remote = RemoteScript.Build(script, context, kind == AppRunKind.Deploy);
        var now = time.GetUtcNow();
        var entry = new AppRun
        {
            ServerId = server.Id, WebAppId = webApp?.Id, CommandId = commandId, Kind = kind, Title = title.Length > 200 ? title[..200] : title,
            Script = script, StartedBy = await TicketEndpoints.ActorNameAsync(principal, db, ct), StartedAt = now, UpdatedAt = now,
        };
        db.AppRuns.Add(entry);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(kind == AppRunKind.Deploy ? "webapp.deploy" : "app-server.command", webApp is null ? "app-server" : "webapp",
            AppEndpoints.Id(webApp?.Id ?? server.Id), $"{entry.Title} em {server.Name} ({server.Username}@{server.Host})", cancellationToken: ct);
        runner.Launch(new AppRunLaunch(entry.Id, server.Id, webApp?.Id, server.ClientId, target, remote, timeout));
        await AppRunner.NotifyRunsChangedAsync(hub, server.ClientId, entry.Id, server.Id, webApp?.Id, AppRunStatus.Running);
        return TypedResults.Accepted($"/api/webapps/runs/{entry.Id}", new { id = entry.Id, status = entry.Status });
    }

    private static async Task<IResult> RunsAsync(CybereyesDbContext db, CancellationToken ct, int? serverId = null, int? webAppId = null, string? kind = null,
        int? page = null, int? pageSize = null)
    {
        var (p, size) = Endpoints.Paging.Normalize(page, pageSize, 25);
        var query = db.AppRuns.AsNoTracking().Where(r => (serverId == null || r.ServerId == serverId) && (webAppId == null || r.WebAppId == webAppId) &&
            (kind == null || r.Kind == kind));
        var total = await query.CountAsync(ct);
        var items = await (
            from r in query.OrderByDescending(r => r.StartedAt).Skip((p - 1) * size).Take(size)
            join s in db.AppServers on r.ServerId equals s.Id
            join w in db.WebApps on r.WebAppId equals w.Id into wg
            from w in wg.DefaultIfEmpty()
            select new
            {
                r.Id, r.ServerId, ServerName = s.Name, r.WebAppId, WebAppName = w.Name, r.CommandId, r.Kind, r.Title, r.Status, r.ExitCode, r.Error,
                r.StartedBy, r.StartedAt, r.FinishedAt,
            }).ToListAsync(ct);
        return TypedResults.Ok(new { items, total, page = p, pageSize = size });
    }

    private static async Task<IResult> RunDetailAsync(long id, CybereyesDbContext db, CancellationToken ct)
    {
        var row = await (
            from r in db.AppRuns.AsNoTracking()
            where r.Id == id
            join s in db.AppServers on r.ServerId equals s.Id
            join w in db.WebApps on r.WebAppId equals w.Id into wg
            from w in wg.DefaultIfEmpty()
            select new
            {
                r.Id, r.ServerId, ServerName = s.Name, r.WebAppId, WebAppName = w.Name, r.CommandId, r.Kind, r.Title, r.Script, r.Status, r.ExitCode, r.Error,
                r.Output, r.OutputTruncated, r.CancelRequested, r.StartedBy, r.StartedAt, r.FinishedAt, r.UpdatedAt,
            }).FirstOrDefaultAsync(ct);
        return row is null ? Problems.NotFound("Execucao") : TypedResults.Ok(row);
    }

    private static async Task<IResult> CancelAsync(long id, CybereyesDbContext db, IAuditService audit, CancellationToken ct)
    {
        var run = await db.AppRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (run is null)
        {
            return Problems.NotFound("Execucao");
        }
        if (run.Status != AppRunStatus.Running)
        {
            return Problems.Conflict("A execucao ja terminou");
        }
        await db.AppRuns.Where(r => r.Id == id).ExecuteUpdateAsync(s => s.SetProperty(r => r.CancelRequested, true), ct);
        await audit.LogAsync("app-run.cancel", "app-run", id.ToString(CultureInfo.InvariantCulture), $"Cancelamento pedido: {run.Title}",
            cancellationToken: ct);
        return TypedResults.Accepted($"/api/webapps/runs/{id}");
    }
}
