using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace Cybereyes.Api.Rmm.Monitoring;

public sealed record UninstallSoftwareRequest(
    [property: Required, StringLength(500, MinimumLength = 1)] string Name,
    [property: StringLength(200)] string? Version,
    [property: StringLength(500)] string? Publisher,
    [property: StringLength(1000)] string? Location,
    [property: StringLength(1000)] string? Key,
    string? Mode,
    bool RunUninstaller = true,
    bool RestorePoint = false);

public sealed record LeftoverItem(string Kind, string Path, string? Name);

public sealed record CleanupSoftwareRequest(long ActionId, List<LeftoverItem>? Items);

/// <summary>
/// Desinstalacao avancada (EYES 3.3.0+): o agente roda o desinstalador do programa, procura sobras e devolve a lista em
/// <c>PATCH /api/v4/{agent_id}/{pk}/softwareresult/</c>; a limpeza so aceita itens dessa lista. A saida gravada na acao
/// pendente e um JSON normalizado aqui, lido pelo console.
/// </summary>
public static class SoftwareUninstall
{
    public const string UninstallType = "softwareuninstall";
    public const string CleanupType = "softwarecleanup";
    public const int MaxItems = 500;

    public static readonly Version MinimumAgent = new(3, 3, 0);
    public static readonly HashSet<string> Modes = new(StringComparer.Ordinal) { "safe", "moderate", "advanced" };
    private static readonly HashSet<string> Kinds = new(StringComparer.Ordinal) { "key", "value", "dir", "file", "service", "task" };
    private static readonly HashSet<string> Levels = new(StringComparer.Ordinal) { "high", "medium", "low" };
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static bool Supports(string version) => System.Version.TryParse(version, out var v) && v >= MinimumAgent;

    public static bool IsResultType(string type) => type is UninstallType or CleanupType;

    /// <summary>Saida gravada na acao pendente: so os campos conhecidos, com limites de tamanho.</summary>
    public sealed record Result(
        bool Ok, string Results, List<Leftover> Leftovers, bool Scanned, bool RanUninstaller, bool StillInstalled,
        int Removed, int Failed, string? Backup, bool Reboot);

    public sealed record Leftover(string Kind, string Path, string? Name, string? Detail, string Level, bool User);

    public static Result Normalize(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            return new Result(false, "Resposta invalida do agente", [], false, false, false, 0, 0, null, false);
        }
        var leftovers = new List<Leftover>();
        if (body.TryGetProperty("leftovers", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in list.EnumerateArray().Take(MaxItems))
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }
                var kind = Str(item, "kind", 20);
                var path = Str(item, "path", 2000);
                if (!Kinds.Contains(kind) || path.Length == 0)
                {
                    continue;
                }
                var level = Str(item, "level", 10);
                leftovers.Add(new Leftover(kind, path, NullIfEmpty(Str(item, "name", 1000)), NullIfEmpty(Str(item, "detail", 500)),
                    Levels.Contains(level) ? level : "low", Bool(item, "user")));
            }
        }
        return new Result(Bool(body, "ok"), Str(body, "results", 64 * 1024), leftovers, Bool(body, "scanned"), Bool(body, "ran_uninstaller"),
            Bool(body, "still_installed"), Int(body, "removed"), Int(body, "failed"), NullIfEmpty(Str(body, "backup", 1000)), Bool(body, "reboot"));
    }

    public static string Serialize(Result result) => JsonSerializer.Serialize(result, Web);

    /// <summary>Sobras gravadas por uma desinstalacao concluida (vazio se a saida nao for o JSON normalizado).</summary>
    public static List<Leftover> Leftovers(string? output)
    {
        if (string.IsNullOrEmpty(output))
        {
            return [];
        }
        try
        {
            return JsonSerializer.Deserialize<Result>(output, Web)?.Leftovers ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static string ItemKey(string kind, string path, string? name) => $"{kind}\0{path}\0{name ?? string.Empty}";

    private static string Str(JsonElement e, string name, int max)
    {
        var s = e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;
        return s.Length > max ? s[..max] : s;
    }

    private static string? NullIfEmpty(string s) => s.Length == 0 ? null : s;

    private static bool Bool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static int Int(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
}
