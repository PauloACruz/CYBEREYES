using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WinCare.Api.Rmm.Monitoring;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Logs;

/// <summary>Rotas /api/v3 de logs usadas pelo agente: configuracao da coleta e recebimento dos lotes.</summary>
public static class LogIngest
{
    public const int MaxEntries = 1000;
    public const long MaxBytes = 2 * 1024 * 1024;

    private static int AgentPk(ClaimsPrincipal principal) => int.Parse(principal.FindFirstValue(WinCareClaims.AgentPk)!, CultureInfo.InvariantCulture);

    private static IResult Error(string message) => Results.Json(message, statusCode: StatusCodes.Status400BadRequest);

    public static async Task<IResult> ConfigAsync(WinCareDbContext db, CancellationToken ct)
    {
        var s = await SettingsStore.GetAsync(db, ct);
        return Results.Json(new Dictionary<string, object>
        {
            ["enabled"] = s.LogsEnabled,
            ["min_level"] = s.LogMinLevel,
            ["windows_logs"] = s.LogWindowsLogs,
            ["max_per_cycle"] = s.LogMaxPerCycle,
        });
    }

    public static async Task<IResult> ReceiveAsync(HttpRequest request, ClaimsPrincipal principal, WinCareDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (request.ContentLength > MaxBytes)
        {
            return Error("Batch too large");
        }
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, ct)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxBytes)
            {
                return Error("Batch too large");
            }
        }

        JsonElement entries;
        try
        {
            using var doc = JsonDocument.Parse(buffer.ToArray());
            if (!doc.RootElement.TryGetProperty("entries", out var list) || list.ValueKind != JsonValueKind.Array)
            {
                return Error("Invalid data");
            }
            entries = list.Clone();
        }
        catch (JsonException)
        {
            return Error("Invalid data");
        }
        if (entries.GetArrayLength() > MaxEntries)
        {
            return Error("Batch too large");
        }

        var pk = AgentPk(principal);
        var clientId = await db.Agents.AsNoTracking().Where(a => a.Id == pk).Select(a => a.Site!.ClientId).FirstAsync(ct);
        var settings = await SettingsStore.GetAsync(db, ct);
        if (!settings.LogsEnabled)
        {
            return Results.Json("ok");
        }

        var now = time.GetUtcNow();
        var oldest = now.AddDays(-settings.LogRetentionDays);
        var accepted = LogLevels.AtLeast(settings.LogMinLevel);
        foreach (var e in entries.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.Object)
            {
                continue;
            }
            var level = Str(e, "level")?.ToLowerInvariant();
            level = LogLevels.IsValid(level) ? level! : LogLevels.Info;
            // A entrada do proprio agente avisando descarte sempre passa, mesmo abaixo do nivel minimo.
            if (!accepted.Contains(level) && Str(e, "source") != "wincare-agent")
            {
                continue;
            }
            var when = DateTimeOffset.TryParse(Str(e, "time"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t.ToUniversalTime() : now;
            if (when < oldest)
            {
                continue;
            }
            db.SystemLogs.Add(new SystemLog
            {
                Time = when > now.AddMinutes(5) ? now : when,
                ReceivedAt = now,
                AgentId = pk,
                ClientId = clientId,
                Level = level,
                Source = Clean(Str(e, "source"), 200),
                Log = Clean(Str(e, "log"), 64),
                EventId = e.TryGetProperty("event_id", out var id) && id.ValueKind == JsonValueKind.Number && id.TryGetInt64(out var n) ? n : null,
                Message = Clean(Str(e, "message"), 8000),
                Host = Str(e, "host") is { Length: > 0 } host ? Clean(host, 255) : null,
            });
        }
        await db.SaveChangesAsync(ct);
        return Results.Json("ok");
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) ? v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        } : null;

    /// <summary>O PostgreSQL recusa o caractere nulo em texto; mensagens de log as vezes trazem.</summary>
    public static string Clean(string? text, int max)
    {
        var value = (text ?? string.Empty).Replace("\0", string.Empty, StringComparison.Ordinal);
        return value.Length <= max ? value : value[..max];
    }
}
