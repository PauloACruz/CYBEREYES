using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.Data.Sqlite;

namespace Cybereyes.Api.Tests;

/// <summary>Chocolatey e winget falsos para o catalogo de pacotes (os testes nao saem para a internet).</summary>
public static class PackageFeeds
{
    public const string ChocoXml = """
        <?xml version="1.0" encoding="utf-8" standalone="yes"?>
        <feed xml:base="https://community.chocolatey.org/api/v2/" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns="http://www.w3.org/2005/Atom">
          <title type="text">Search</title>
          <entry>
            <title type="text">GoogleChrome</title>
            <m:properties><d:Title>Google Chrome</d:Title><d:Version>155.0.8059.12</d:Version><d:Summary>Navegador da Google</d:Summary><d:DownloadCount m:type="Edm.Int32">393971326</d:DownloadCount></m:properties>
          </entry>
          <entry>
            <title type="text">intel-dsa</title>
            <m:properties><d:Title>Intel® Driver &amp; Support Assistant</d:Title><d:Version>26.2.0.7</d:Version><d:Summary m:null="true" /><d:Description>Assistente</d:Description><d:DownloadCount m:type="Edm.Int32">2964490</d:DownloadCount></m:properties>
          </entry>
        </feed>
        """;

    private static readonly Lazy<byte[]> Msix = new(() => BuildWingetMsix(
        ("Google.Chrome", "Google Chrome", "chrome", "154.0.8037.98"),
        ("Google.Chrome.Beta", "Google Chrome Beta", "chrome-beta", "156.0.8078.4"),
        ("Notepad++.Notepad++", "Notepad++", "notepad++", "8.9.1"),
        ("7zip.7zip", "7-Zip", "7zip", "25.01")));

    /// <summary>Monta um source2.msix (zip com Public/index.db) com a tabela packages do winget.</summary>
    public static byte[] BuildWingetMsix(params (string Id, string Name, string? Moniker, string Version)[] packages)
    {
        var db = Path.Combine(Path.GetTempPath(), $"winget-teste-{Guid.NewGuid():N}.db");
        try
        {
            using (var conn = new SqliteConnection($"Data Source={db};Pooling=False"))
            {
                conn.Open();
                using var create = conn.CreateCommand();
                create.CommandText = "CREATE TABLE [packages](rowid INTEGER PRIMARY KEY, [id] TEXT NOT NULL, [name] TEXT NOT NULL, [moniker] TEXT, [latest_version] TEXT NOT NULL, [arp_min_version] TEXT, [arp_max_version] TEXT, [hash] BLOB)";
                create.ExecuteNonQuery();
                foreach (var p in packages)
                {
                    using var insert = conn.CreateCommand();
                    insert.CommandText = "INSERT INTO packages(id, name, moniker, latest_version) VALUES ($i, $n, $m, $v)";
                    insert.Parameters.AddWithValue("$i", p.Id);
                    insert.Parameters.AddWithValue("$n", p.Name);
                    insert.Parameters.AddWithValue("$m", (object?)p.Moniker ?? DBNull.Value);
                    insert.Parameters.AddWithValue("$v", p.Version);
                    insert.ExecuteNonQuery();
                }
            }
            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                zip.CreateEntryFromFile(db, "Public/index.db");
                zip.CreateEntry("AppxManifest.xml");
            }
            return ms.ToArray();
        }
        finally
        {
            File.Delete(db);
        }
    }

    private static int chocoRequests;

    public static int ChocoRequests => Volatile.Read(ref chocoRequests);

    public sealed class Handler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            if (url.Contains("/api/v2/Search()", StringComparison.Ordinal))
            {
                Interlocked.Increment(ref chocoRequests);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(ChocoXml, Encoding.UTF8, "application/atom+xml") });
            }
            if (url.EndsWith("source2.msix", StringComparison.Ordinal))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Msix.Value) });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
