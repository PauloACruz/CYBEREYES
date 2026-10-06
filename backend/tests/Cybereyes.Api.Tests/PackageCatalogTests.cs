using Cybereyes.Api.Rmm.Software;

namespace Cybereyes.Api.Tests;

public sealed class PackageCatalogTests
{
    [Fact]
    public void ParseChocolatey_ReadsIdTitleVersionSummaryAndDownloads()
    {
        var items = PackageCatalog.ParseChocolatey(PackageFeeds.ChocoXml);

        Assert.Equal(2, items.Count);
        Assert.Equal(new CatalogPackage("GoogleChrome", "Google Chrome", "155.0.8059.12", "Navegador da Google", 393971326), items[0]);
        Assert.Equal("Intel® Driver & Support Assistant", items[1].Name);
        Assert.Equal("Assistente", items[1].Summary);
    }

    [Fact]
    public void WingetIndex_SearchesAllWordsAndRanksExactMatchesFirst()
    {
        var index = WingetIndex.Load(PackageFeeds.BuildWingetMsix(
            ("Google.Chrome.Beta", "Google Chrome Beta", "chrome-beta", "156.0"),
            ("Google.Chrome", "Google Chrome", "chrome", "154.0"),
            ("Notepad++.Notepad++", "Notepad++", "notepad++", "8.9.1"),
            ("Acme.ChromeTools", "Ferramentas", null, "1.0")), DateTimeOffset.UtcNow);

        Assert.Equal(4, index.Count);
        var chrome = index.Search("chrome", 30);
        Assert.Equal("Google.Chrome", chrome[0].Id);
        Assert.Equal(3, chrome.Count);
        Assert.Equal("Apelido: chrome", chrome[0].Summary);
        Assert.Equal(["Google.Chrome.Beta"], index.Search("google chrome beta", 30).Select(p => p.Id));
        Assert.Equal("Notepad++.Notepad++", index.Search("Notepad++", 30).Single().Id);
        Assert.Empty(index.Search("inexistente", 30));
    }

    [Fact]
    public void WingetIndex_RejectsArchiveWithoutDatabase()
    {
        using var ms = new MemoryStream();
        using (var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            zip.CreateEntry("AppxManifest.xml");
        }
        Assert.Throws<InvalidDataException>(() => WingetIndex.Load(ms.ToArray(), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void PlainText_RemovesMarkdown()
    {
        Assert.Equal("Firefox Features A powerful engine. Install given locale. See the official page for more.",
            PackageCatalog.PlainText("Firefox\n## Features\n- A powerful engine.\n- Install given `locale`. See the [official page](https://x/y) for **more**."));
        Assert.Null(PackageCatalog.PlainText("  "));
    }

    [Theory]
    [InlineData("chrome", true)]
    [InlineData("notepad++", true)]
    [InlineData("visual studio code", true)]
    [InlineData("é ótimo", true)]
    [InlineData("a", false)]
    [InlineData("chrome'or'1", false)]
    [InlineData("x&y", false)]
    public void TermPattern_AcceptsOnlySafeSearches(string term, bool ok) => Assert.Equal(ok, PackageCatalog.TermPattern().IsMatch(term));
}

/// <summary>Roda so com WINGET_MSIX apontando para um source2.msix baixado (confere o leitor no indice real).</summary>
public sealed class RealWingetIndexFactAttribute : FactAttribute
{
    public RealWingetIndexFactAttribute()
    {
        if (!File.Exists(Environment.GetEnvironmentVariable("WINGET_MSIX") ?? string.Empty))
        {
            Skip = "WINGET_MSIX nao informado";
        }
    }
}

public sealed class RealWingetIndexTests
{
    [RealWingetIndexFact]
    public void RealIndex_FindsWellKnownPackages()
    {
        var index = Cybereyes.Api.Rmm.Software.WingetIndex.Load(File.ReadAllBytes(Environment.GetEnvironmentVariable("WINGET_MSIX")!), DateTimeOffset.UtcNow);
        Assert.True(index.Count > 5000);
        Assert.Equal("Google.Chrome", index.Search("chrome", 30)[0].Id);
        Assert.Equal("7zip.7zip", index.Search("7zip", 30)[0].Id);
        Assert.Contains(index.Search("visual studio code", 30), p => p.Id == "Microsoft.VisualStudioCode");
    }
}
