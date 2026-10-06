using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Remote;

public sealed record RemotePathRequest(string Path);

public sealed record RemoteRenameRequest(string From, string To);

public sealed record RemoteDeleteRequest(string Path, bool Recursive);

public sealed record RemoteUploadRequest(string Path, long Size, bool Overwrite);

public sealed record RemoteClipboardFilesRequest(uint[] TransferIds);

/// <summary>Rotas de arquivos da sessao (contrato, secoes 2.1 e 7). Atendidas na replica dona da sessao.</summary>
public static class RemoteFileEndpoints
{
    private const int ChunkSize = 256 << 10;
    private const int MaxPutBytes = (1 << 20) + ChunkSize;
    private const int DownloadGrant = 4 << 20;
    private static readonly TimeSpan Quick = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Slow = TimeSpan.FromMinutes(10);

    public static void MapRemoteFileEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/remote/sessions/{sessionId}").WithTags("Acesso remoto")
            .RequireAuthorization(Policies.Permission(Permissions.AgentsFiles))
            .AddEndpointFilter(RemoteForwarder.Filter);
        group.MapGet("/files/home", (string sessionId, ClaimsPrincipal p, RemoteSessionManager m, CancellationToken ct) =>
            SimpleAsync(sessionId, p, m, "home", [], ct));
        group.MapGet("/files/list", (string sessionId, string path, ClaimsPrincipal p, RemoteSessionManager m, CancellationToken ct) =>
            SimpleAsync(sessionId, p, m, "list", new JsonObject { ["path"] = path }, ct));
        group.MapPost("/files/mkdir", (string sessionId, RemotePathRequest r, ClaimsPrincipal p, RemoteSessionManager m, IAuditService a, CancellationToken ct) =>
            ActionAsync(sessionId, p, m, a, "mkdir", new JsonObject { ["path"] = r.Path }, "remote.file-mkdir", $"Pasta criada: {r.Path}", ct));
        group.MapPost("/files/rename", (string sessionId, RemoteRenameRequest r, ClaimsPrincipal p, RemoteSessionManager m, IAuditService a, CancellationToken ct) =>
            ActionAsync(sessionId, p, m, a, "rename", new JsonObject { ["from"] = r.From, ["to"] = r.To }, "remote.file-rename", $"Renomeado: {r.From} para {r.To}", ct));
        group.MapPost("/files/delete", (string sessionId, RemoteDeleteRequest r, ClaimsPrincipal p, RemoteSessionManager m, IAuditService a, CancellationToken ct) =>
            ActionAsync(sessionId, p, m, a, "delete", new JsonObject { ["path"] = r.Path, ["recursive"] = r.Recursive }, "remote.file-delete", $"Apagado: {r.Path}", ct));
        group.MapPost("/files/clipboard", (string sessionId, RemoteClipboardFilesRequest r, ClaimsPrincipal p, RemoteSessionManager m, IAuditService a, CancellationToken ct) =>
            ActionAsync(sessionId, p, m, a, "clipboard-files", new JsonObject { ["transferIds"] = new JsonArray([.. r.TransferIds.Select(id => (JsonNode)id)]) },
                "remote.file-clipboard", $"{r.TransferIds.Length} arquivo(s) na area de transferencia da estacao", ct));
        group.MapPost("/uploads", BeginUploadAsync);
        group.MapPut("/uploads/{transferId}", PutChunkAsync);
        group.MapPost("/uploads/{transferId}/complete", CompleteUploadAsync);
        group.MapGet("/download", DownloadAsync);
    }

    /// <summary>Sessao do tecnico com o canal files conectado; ou o erro a devolver.</summary>
    private static async Task<(RemoteSessionHandle? Handle, RemoteFilesChannel? Files, IResult? Error)> ResolveAsync(
        string sessionId, ClaimsPrincipal principal, RemoteSessionManager manager, CancellationToken ct)
    {
        if (!manager.TryGet(sessionId, out var handle) || (handle.UserId != principal.UserId() && !principal.HasPermission(Permissions.SettingsManage)))
        {
            return (null, null, Problems.NotFound("Sessao"));
        }
        if (handle.State == RemoteSessionState.Ended)
        {
            return (null, null, Problems.Create(StatusCodes.Status409Conflict, "Sessao encerrada", RemoteErrors.SessionEnded));
        }
        if (!handle.HasChannel(RemoteFrames.Files))
        {
            return (null, null, Problems.Forbidden("Sessao sem o canal de arquivos"));
        }
        try
        {
            // O canal do agente conecta logo depois do remote_start.
            await handle.FilesReady.Task.WaitAsync(TimeSpan.FromSeconds(15), ct);
        }
        catch (TimeoutException)
        {
            return (null, null, Problems.AgentTimeout());
        }
        if (handle.Files is not { } files)
        {
            return (null, null, Problems.Create(StatusCodes.Status409Conflict, "Sessao encerrada", RemoteErrors.SessionEnded));
        }
        return (handle, files, null);
    }

    /// <summary>Traduz o erro do agente (contrato, secao 7.2) para a resposta HTTP (secao 2.3).</summary>
    public static IResult AgentError(RemoteFilesException ex) => ex.Code switch
    {
        "not-found" => Problems.NotFound("Arquivo ou pasta"),
        "exists" => Problems.Create(StatusCodes.Status409Conflict, "O destino ja existe", RemoteErrors.FileExists),
        "denied" => Problems.Forbidden("Acesso negado na estacao"),
        "invalid-path" => Problems.Create(StatusCodes.Status422UnprocessableEntity, "Caminho invalido", RemoteErrors.InvalidPath),
        "too-large" => Problems.Create(StatusCodes.Status413PayloadTooLarge, "Arquivo acima do limite", RemoteErrors.FileTooLarge),
        "timeout" => Problems.AgentTimeout(),
        _ => Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: "Erro no agente", detail: ex.Message,
            extensions: new Dictionary<string, object?> { ["code"] = RemoteErrors.AgentError, ["agentCode"] = ex.Code }),
    };

    private static async Task<IResult> SimpleAsync(string sessionId, ClaimsPrincipal principal, RemoteSessionManager manager, string op, JsonObject fields, CancellationToken ct)
    {
        var (_, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        try
        {
            return TypedResults.Ok(await files!.RequestAsync(op, fields, Quick, ct));
        }
        catch (RemoteFilesException ex)
        {
            return AgentError(ex);
        }
    }

    private static async Task<IResult> ActionAsync(string sessionId, ClaimsPrincipal principal, RemoteSessionManager manager, IAuditService audit,
        string op, JsonObject fields, string action, string message, CancellationToken ct)
    {
        var (handle, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        try
        {
            await files!.RequestAsync(op, fields, Quick, ct);
        }
        catch (RemoteFilesException ex)
        {
            return AgentError(ex);
        }
        await audit.LogAsync(action, "agent", handle!.AgentPk.ToString(CultureInfo.InvariantCulture), $"{handle.Hostname}: {message}", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> BeginUploadAsync(string sessionId, RemoteUploadRequest request, ClaimsPrincipal principal, RemoteSessionManager manager,
        CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var (handle, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        if (!handle!.Policy.FilesUpload)
        {
            return Problems.Forbidden("A politica nao permite enviar arquivos");
        }
        if (request.Size < 0 || request.Size > (long)handle.Policy.MaxFileMb << 20)
        {
            return Problems.Create(StatusCodes.Status413PayloadTooLarge, $"Arquivo acima de {handle.Policy.MaxFileMb} MB", RemoteErrors.FileTooLarge);
        }
        // Retomada dentro da sessao: mesmo destino e tamanho continuam de onde pararam (contrato, secao 7.4).
        var existing = files!.Uploads.Values.FirstOrDefault(u => u.Path == request.Path && u.Size == request.Size);
        if (existing is not null)
        {
            return TypedResults.Created($"/api/remote/sessions/{sessionId}/uploads/{existing.TransferId}", new { transferId = existing.TransferId, received = existing.Received });
        }
        var record = new RemoteTransfer
        {
            SessionId = handle.SessionId, AgentId = handle.AgentPk, UserId = handle.UserId, Username = handle.Username,
            Direction = "upload", RemotePath = request.Path, SizeBytes = request.Size, StartedAt = time.GetUtcNow(),
        };
        db.RemoteTransfers.Add(record);
        await db.SaveChangesAsync(ct);
        var state = new UploadState { TransferId = files.NewTransferId(), Path = request.Path, Size = request.Size, RecordId = record.Id };
        files.Uploads[state.TransferId] = state;
        try
        {
            // restart: a API calcula o SHA-256 do que repassa, entao comeca do zero quando nao tem o inicio.
            await files.RequestAsync("upload-begin", new JsonObject
            {
                ["transferId"] = state.TransferId, ["path"] = request.Path, ["size"] = request.Size, ["overwrite"] = request.Overwrite, ["restart"] = true,
            }, Quick, ct);
        }
        catch (RemoteFilesException ex)
        {
            files.Uploads.TryRemove(state.TransferId, out _);
            state.Dispose();
            await FinishRecordAsync(db, record.Id, "failed", null, ex.Code, time, ct);
            return AgentError(ex);
        }
        return TypedResults.Created($"/api/remote/sessions/{sessionId}/uploads/{state.TransferId}", new { transferId = state.TransferId, received = 0L });
    }

    private static async Task FinishRecordAsync(CybereyesDbContext db, long id, string status, string? sha, string? error, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        await db.RemoteTransfers.Where(t => t.Id == id).ExecuteUpdateAsync(s => s
            .SetProperty(t => t.Status, status).SetProperty(t => t.Sha256, sha).SetProperty(t => t.Error, error).SetProperty(t => t.FinishedAt, now), ct);
    }

    private static async Task<IResult> PutChunkAsync(string sessionId, uint transferId, HttpContext ctx, ClaimsPrincipal principal, RemoteSessionManager manager, CancellationToken ct)
    {
        var (handle, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        if (!files!.Uploads.TryGetValue(transferId, out var state))
        {
            return Problems.NotFound("Transferencia");
        }
        if (!ContentRangeHeaderValue.TryParse(ctx.Request.Headers.ContentRange.ToString(), out var range) || range.From is not { } from || range.To is not { } to
            || to < from || to - from + 1 > MaxPutBytes || range.Length != state.Size)
        {
            return Problems.BadRequest("Content-Range invalido");
        }
        await state.Gate.WaitAsync(ct);
        try
        {
            if (from != state.Received || to >= state.Size)
            {
                return Results.Json(new { received = state.Received }, statusCode: StatusCodes.Status416RangeNotSatisfiable);
            }
            var buffer = new byte[ChunkSize];
            var remaining = to - from + 1;
            while (remaining > 0)
            {
                var read = await ctx.Request.Body.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), ct);
                if (read == 0)
                {
                    break;
                }
                var sent = 0;
                while (sent < read)
                {
                    var n = await state.Credit.TakeAsync(read - sent, ct);
                    await files.SendAsync(RemoteFilesChannel.ChunkFrame(transferId, state.Received, buffer.AsSpan(sent, n)), ct);
                    state.Hash.AppendData(buffer, sent, n);
                    state.Received += n;
                    handle!.CountToAgent(n + 13, false);
                    sent += n;
                }
                remaining -= read;
            }
            handle!.LastActivity = DateTimeOffset.UtcNow;
            return TypedResults.Ok(new { received = state.Received });
        }
        catch (RemoteFilesException ex)
        {
            return AgentError(ex);
        }
        finally
        {
            state.Gate.Release();
        }
    }

    private static async Task<IResult> CompleteUploadAsync(string sessionId, uint transferId, ClaimsPrincipal principal, RemoteSessionManager manager,
        CybereyesDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var (handle, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        if (!files!.Uploads.TryGetValue(transferId, out var state))
        {
            return Problems.NotFound("Transferencia");
        }
        if (state.Received != state.Size)
        {
            return Results.Json(new { received = state.Received }, statusCode: StatusCodes.Status416RangeNotSatisfiable);
        }
        files.Uploads.TryRemove(transferId, out _);
        var sha = Convert.ToHexStringLower(state.Hash.GetHashAndReset());
        state.Dispose();
        JsonNode? result;
        try
        {
            result = await files.RequestAsync("upload-end", new JsonObject { ["transferId"] = transferId, ["sha256"] = sha }, Slow, ct);
        }
        catch (RemoteFilesException ex)
        {
            await FinishRecordAsync(db, state.RecordId, "failed", sha, ex.Code, time, ct);
            return AgentError(ex);
        }
        await FinishRecordAsync(db, state.RecordId, "done", sha, null, time, ct);
        await audit.LogAsync("remote.file-upload", "agent", handle!.AgentPk.ToString(CultureInfo.InvariantCulture),
            $"{handle.Hostname}: arquivo enviado para {state.Path} ({state.Size} bytes, SHA-256 {sha})", cancellationToken: ct);
        return TypedResults.Ok(new { transferId, sha256 = sha, path = result?["path"]?.GetValue<string>() ?? state.Path });
    }

    /// <summary>Nome do arquivo baixado: o ultimo segmento do caminho (separador do Windows ou do Unix).</summary>
    public static string FileName(string path)
    {
        var trimmed = path.TrimEnd('/', '\\');
        var i = trimmed.LastIndexOfAny(['/', '\\']);
        var name = i >= 0 ? trimmed[(i + 1)..] : trimmed;
        return name.Length == 0 ? "arquivo" : name;
    }

    private static async Task<IResult> DownloadAsync(string sessionId, string[] path, bool? zip, HttpContext ctx, ClaimsPrincipal principal,
        RemoteSessionManager manager, CybereyesDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var (handle, files, error) = await ResolveAsync(sessionId, principal, manager, ct);
        if (error is not null)
        {
            return error;
        }
        if (!handle!.Policy.FilesDownload)
        {
            return Problems.Forbidden("A politica nao permite baixar arquivos");
        }
        if (path.Length is 0 or > 1000)
        {
            return Problems.Validation("path", "Informe de 1 a 1000 caminhos");
        }
        var asZip = zip == true || path.Length > 1;
        long size = -1;
        long offset = 0;
        if (!asZip)
        {
            try
            {
                var stat = await files!.RequestAsync("stat", new JsonObject { ["path"] = path[0] }, Quick, ct);
                if (stat?["kind"]?.GetValue<string>() == "dir")
                {
                    asZip = true;
                }
                else
                {
                    size = stat?["size"]?.GetValue<long>() ?? -1;
                }
            }
            catch (RemoteFilesException ex)
            {
                return AgentError(ex);
            }
        }
        if (!asZip && RangeHeaderValue.TryParse(ctx.Request.Headers.Range.ToString(), out var range) && range.Ranges.Count == 1
            && range.Ranges.First() is { From: { } start } r && (r.To is null || r.To == size - 1))
        {
            if (start >= size)
            {
                ctx.Response.Headers.ContentRange = $"bytes */{size}";
                return Results.StatusCode(StatusCodes.Status416RangeNotSatisfiable);
            }
            offset = start;
        }

        var transferId = files!.NewTransferId();
        var record = new RemoteTransfer
        {
            SessionId = handle.SessionId, AgentId = handle.AgentPk, UserId = handle.UserId, Username = handle.Username,
            Direction = "download", RemotePath = string.Join("; ", path), SizeBytes = size, StartedAt = time.GetUtcNow(),
        };
        db.RemoteTransfers.Add(record);
        await db.SaveChangesAsync(ct);

        var reader = files.OpenDownload(transferId);
        var fields = new JsonObject { ["transferId"] = transferId, ["offset"] = offset, ["zip"] = asZip };
        if (path.Length == 1)
        {
            fields["path"] = path[0];
        }
        else
        {
            fields["paths"] = new JsonArray([.. path.Select(p => (JsonNode)p)]);
        }
        Task<JsonNode?> done;
        try
        {
            done = await files.BeginRequestAsync("download-begin", fields, ct);
            await files.SendJsonAsync(RemoteFrames.FilesCredit, new JsonObject { ["transferId"] = transferId, ["bytes"] = DownloadGrant }, ct);
        }
        catch (Exception ex) when (ex is RemoteFilesException or System.Net.WebSockets.WebSocketException)
        {
            files.CloseDownload(transferId);
            await FinishRecordAsync(db, record.Id, "failed", null, "io", time, CancellationToken.None);
            return Problems.AgentTimeout();
        }
        // Os blocos chegam antes da resposta: quando ela chega, nao vem mais nada.
        _ = done.ContinueWith(t => files.CloseDownload(transferId, t.Exception?.InnerException), TaskScheduler.Default);

        // Erro antes do primeiro bloco (arquivo sumiu, sem permissao): resposta de erro normal.
        var first = reader.WaitToReadAsync(ct).AsTask();
        await Task.WhenAny(first, done);
        if (!reader.TryPeek(out _) && (done.IsFaulted || first.IsFaulted))
        {
            var ex = (done.Exception ?? first.Exception)?.InnerException as RemoteFilesException ?? new RemoteFilesException("io", "Falha no download");
            await FinishRecordAsync(db, record.Id, "failed", null, ex.Code, time, CancellationToken.None);
            return AgentError(ex);
        }

        var name = FileName(path.Length == 1 ? path[0] : handle.Hostname) + (asZip ? ".zip" : string.Empty);
        ctx.Response.ContentType = asZip ? "application/zip" : "application/octet-stream";
        ctx.Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("attachment") { FileNameStar = name }.ToString();
        if (!asZip)
        {
            ctx.Response.Headers.AcceptRanges = "bytes";
            ctx.Response.ContentLength = size - offset;
            if (offset > 0)
            {
                ctx.Response.StatusCode = StatusCodes.Status206PartialContent;
                ctx.Response.Headers.ContentRange = $"bytes {offset}-{size - 1}/{size}";
            }
        }
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long sent = 0;
        try
        {
            await foreach (var chunk in reader.ReadAllAsync(ct))
            {
                await ctx.Response.Body.WriteAsync(chunk, ct);
                hash.AppendData(chunk);
                sent += chunk.Length;
                handle.CountToViewer(chunk.Length + 13, false);
                await files.SendJsonAsync(RemoteFrames.FilesCredit, new JsonObject { ["transferId"] = transferId, ["bytes"] = chunk.Length }, ct);
            }
            var result = await done;
            var sha = Convert.ToHexStringLower(hash.GetHashAndReset());
            if (!string.Equals(result?["sha256"]?.GetValue<string>(), sha, StringComparison.OrdinalIgnoreCase))
            {
                // Hash diferente: aborta para o navegador marcar o download como falho (contrato, secao 7.5).
                await FinishRecordAsync(db, record.Id, "failed", sha, "hash-mismatch", time, CancellationToken.None);
                ctx.Abort();
                return Results.Empty;
            }
            await FinishRecordAsync(db, record.Id, "done", sha, null, time, CancellationToken.None);
            await audit.LogAsync("remote.file-download", "agent", handle.AgentPk.ToString(CultureInfo.InvariantCulture),
                $"{handle.Hostname}: download de {string.Join("; ", path)} ({sent} bytes, SHA-256 {sha})", cancellationToken: CancellationToken.None);
            return Results.Empty;
        }
        catch (Exception ex) when (ex is OperationCanceledException or RemoteFilesException or IOException)
        {
            files.CloseDownload(transferId);
            try
            {
                await files.SendJsonAsync(RemoteFrames.FilesCancel, new JsonObject { ["transferId"] = transferId }, CancellationToken.None);
            }
            catch (Exception sendError) when (sendError is System.Net.WebSockets.WebSocketException or ObjectDisposedException)
            {
                // canal do agente ja fechado
            }
            await FinishRecordAsync(db, record.Id, "failed", null, (ex as RemoteFilesException)?.Code ?? "cancelled", time, CancellationToken.None);
            ctx.Abort();
            return Results.Empty;
        }
    }
}
