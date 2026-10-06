using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace Cybereyes.Api.Rmm.Software;

/// <summary>Onde o catalogo busca os pacotes. Os enderecos padrao sao os publicos do Chocolatey e do winget.</summary>
public sealed class SoftwareCatalogSettings
{
    public const string Section = "Software";

    /// <summary>Busca OData v2 do repositorio da comunidade do Chocolatey.</summary>
    public string ChocolateySearchUrl { get; set; } = "https://community.chocolatey.org/api/v2/Search()";

    /// <summary>Indice oficial do winget (source2.msix: zip com o SQLite Public/index.db).</summary>
    public string WingetIndexUrl { get; set; } = "https://cdn.winget.microsoft.com/cache/source2.msix";

    /// <summary>Intervalo para baixar o indice do winget de novo.</summary>
    public TimeSpan WingetRefresh { get; set; } = TimeSpan.FromHours(12);
}

/// <summary>Pacote encontrado no catalogo. Downloads so existe no Chocolatey.</summary>
public sealed record CatalogPackage(string Id, string Name, string Version, string? Summary, long? Downloads);

public sealed class CatalogUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Pesquisa de pacotes para instalar pelo console: Chocolatey pela busca publica (resultado guardado por 10 minutos) e
/// winget pelo indice oficial, baixado e mantido em memoria (renovado a cada 12 h; se a renovacao falhar, segue o
/// anterior).
/// </summary>
public sealed partial class PackageCatalog(IHttpClientFactory http, IOptions<SoftwareCatalogSettings> options, TimeProvider time, ILogger<PackageCatalog> log) : IDisposable
{
    public const string HttpClientName = "pacotes";
    public const int MaxResults = 30;
    private static readonly TimeSpan ChocoCacheTtl = TimeSpan.FromMinutes(10);
    private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
    private static readonly XNamespace D = "http://schemas.microsoft.com/ado/2007/08/dataservices";
    private static readonly XNamespace M = "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata";

    private readonly ConcurrentDictionary<string, (DateTimeOffset At, IReadOnlyList<CatalogPackage> Items)> chocoCache = new();
    private readonly SemaphoreSlim wingetLock = new(1, 1);
    private WingetIndex? winget;

    /// <summary>Termo aceito: letras, digitos, espaco e . _ + - (2 a 60 caracteres).</summary>
    [GeneratedRegex(@"^[\p{L}\p{N} ._+\-]{2,60}$")]
    public static partial Regex TermPattern();

    public async Task<IReadOnlyList<CatalogPackage>> SearchChocolateyAsync(string term, CancellationToken ct)
    {
        term = term.Trim();
        var key = term.ToLowerInvariant();
        var now = time.GetUtcNow();
        if (chocoCache.TryGetValue(key, out var hit) && now - hit.At < ChocoCacheTtl)
        {
            return hit.Items;
        }
        // searchTerm vai entre aspas simples no OData: aspas do termo sao dobradas (o padrao do termo ja as recusa).
        var quoted = Uri.EscapeDataString("'" + term.Replace("'", "''", StringComparison.Ordinal) + "'");
        var url = $"{options.Value.ChocolateySearchUrl}?$filter=IsLatestVersion&$orderby=DownloadCount%20desc&searchTerm={quoted}" +
            $"&targetFramework=%27%27&includePrerelease=false&$top={MaxResults}";
        string xml;
        try
        {
            using var client = http.CreateClient(HttpClientName);
            xml = await client.GetStringAsync(new Uri(url), ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            LogChocoFailed(log, ex);
            throw new CatalogUnavailableException("A busca do Chocolatey nao respondeu. Tente de novo em instantes.", ex);
        }
        var items = ParseChocolatey(xml);
        if (chocoCache.Count > 500)
        {
            chocoCache.Clear();
        }
        chocoCache[key] = (now, items);
        return items;
    }

    /// <summary>Le o feed Atom/OData da busca do Chocolatey.</summary>
    public static IReadOnlyList<CatalogPackage> ParseChocolatey(string xml)
    {
        var doc = XDocument.Parse(xml);
        var list = new List<CatalogPackage>();
        foreach (var entry in doc.Root?.Elements(Atom + "entry") ?? [])
        {
            var props = entry.Element(M + "properties");
            var id = entry.Element(Atom + "title")?.Value.Trim();
            if (props is null || string.IsNullOrEmpty(id))
            {
                continue;
            }
            string? P(string name) => props.Element(D + name)?.Value is { Length: > 0 } v ? v.Trim() : null;
            var title = P("Title") ?? id;
            var summary = P("Summary") ?? P("Description");
            if (summary is { Length: > 300 })
            {
                summary = summary[..297].TrimEnd() + "...";
            }
            long? downloads = long.TryParse(P("DownloadCount"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;
            list.Add(new CatalogPackage(id, title, P("Version") ?? string.Empty, summary, downloads));
        }
        return list;
    }

    public void Dispose() => wingetLock.Dispose();

    [LoggerMessage(Level = LogLevel.Warning, Message = "Busca do Chocolatey falhou")]
    private static partial void LogChocoFailed(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Information, Message = "Indice do winget carregado: {Count} pacotes")]
    private static partial void LogWingetLoaded(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Indice do winget indisponivel")]
    private static partial void LogWingetFailed(ILogger logger, Exception ex);

    public async Task<IReadOnlyList<CatalogPackage>> SearchWingetAsync(string term, CancellationToken ct)
    {
        var index = await WingetAsync(ct);
        return index.Search(term, MaxResults);
    }

    private async Task<WingetIndex> WingetAsync(CancellationToken ct)
    {
        var current = winget;
        var now = time.GetUtcNow();
        if (current is not null && now - current.LoadedAt < options.Value.WingetRefresh)
        {
            return current;
        }
        await wingetLock.WaitAsync(ct);
        try
        {
            if (winget is not null && now - winget.LoadedAt < options.Value.WingetRefresh)
            {
                return winget;
            }
            try
            {
                using var client = http.CreateClient(HttpClientName);
                var bytes = await client.GetByteArrayAsync(new Uri(options.Value.WingetIndexUrl), ct);
                winget = WingetIndex.Load(bytes, now);
                LogWingetLoaded(log, winget.Count);
                return winget;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException or SqliteException && !ct.IsCancellationRequested)
            {
                LogWingetFailed(log, ex);
                if (winget is not null)
                {
                    // Segue com o indice antigo e tenta de novo em 10 minutos.
                    winget = winget with { LoadedAt = now - options.Value.WingetRefresh + TimeSpan.FromMinutes(10) };
                    return winget;
                }
                throw new CatalogUnavailableException("O indice do winget nao pode ser baixado agora. Tente de novo em instantes.", ex);
            }
        }
        finally
        {
            wingetLock.Release();
        }
    }
}

/// <summary>Pacotes do indice do winget em memoria (id, nome, apelido e versao mais nova).</summary>
public sealed record WingetIndex(IReadOnlyList<WingetIndex.Entry> Entries, DateTimeOffset LoadedAt)
{
    public sealed record Entry(string Id, string Name, string? Moniker, string Version, string Haystack);

    public int Count => Entries.Count;

    /// <summary>Abre o source2.msix (zip) e le a tabela packages do Public/index.db.</summary>
    public static WingetIndex Load(byte[] msix, DateTimeOffset now)
    {
        using var zip = new ZipArchive(new MemoryStream(msix), ZipArchiveMode.Read);
        var db = zip.GetEntry("Public/index.db") ?? throw new InvalidDataException("index.db ausente no indice do winget");
        var path = Path.Combine(Path.GetTempPath(), $"winget-index-{Guid.NewGuid():N}.db");
        try
        {
            using (var file = File.Create(path))
            using (var src = db.Open())
            {
                src.CopyTo(file);
            }
            var entries = new List<Entry>();
            using (var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
            {
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "select id, name, moniker, latest_version from packages";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    var id = r.GetString(0);
                    var name = r.GetString(1);
                    var moniker = r.IsDBNull(2) ? null : r.GetString(2);
                    entries.Add(new Entry(id, name, moniker, r.GetString(3), Normalize($"{id} {name} {moniker}")));
                }
            }
            return new WingetIndex(entries, now);
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>Todas as palavras do termo precisam aparecer; id ou apelido iguais ao termo vem primeiro.</summary>
    public IReadOnlyList<CatalogPackage> Search(string term, int max)
    {
        var norm = Normalize(term);
        var words = norm.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0)
        {
            return [];
        }
        return Entries
            .Where(e => words.All(w => e.Haystack.Contains(w, StringComparison.Ordinal)))
            .Select(e => (e, rank: Rank(e, norm)))
            .OrderBy(x => x.rank).ThenBy(x => x.e.Name.Length).ThenBy(x => x.e.Id, StringComparer.OrdinalIgnoreCase)
            .Take(max)
            .Select(x => new CatalogPackage(x.e.Id, x.e.Name, x.e.Version, x.e.Moniker is null ? null : $"Apelido: {x.e.Moniker}", null))
            .ToList();
    }

    private static int Rank(Entry e, string norm)
    {
        if (Normalize(e.Id) == norm || (e.Moniker is not null && Normalize(e.Moniker) == norm) || Normalize(e.Name) == norm)
        {
            return 0;
        }
        if (Normalize(e.Name).StartsWith(norm, StringComparison.Ordinal) || Normalize(e.Id).StartsWith(norm, StringComparison.Ordinal))
        {
            return 1;
        }
        return 2;
    }

    /// <summary>Minusculas sem acento, com . _ - virando espaco (Google.Chrome casa com "google chrome").</summary>
    public static string Normalize(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }
            sb.Append(c is '.' or '_' or '-' ? ' ' : char.ToLowerInvariant(c));
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
