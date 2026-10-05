namespace Cybereyes.Api.Rmm;

/// <summary>
/// Distribuicao do EYES. Os binarios sao compilados junto com a imagem da API (pasta BundledPath)
/// a partir da pasta agent/ do repositorio; BinariesPath permite sobrepor com binarios proprios.
/// </summary>
public sealed class AgentSettings
{
    public const string Section = "Agent";

    /// <summary>
    /// Versao distribuida e versao minima aceita no registro. Vazio: usa a versao dos binarios
    /// embutidos (arquivo VERSION em BundledPath).
    /// </summary>
    public string? LatestVersion { get; set; }

    /// <summary>Versao minima aceita no registro (instalador). Independente da versao distribuida.</summary>
    public string MinimumVersion { get; set; } = "3.0.0";

    /// <summary>Atualiza sozinho os agentes EYES online com versao menor que a distribuida.</summary>
    public bool AutoUpdate { get; set; } = true;

    /// <summary>Pasta com binarios que tem prioridade sobre os embutidos (eyes-v{versao}-{plat}-{arch}[.exe]).</summary>
    public string? BinariesPath { get; set; }

    /// <summary>Pasta dos binarios compilados na imagem da API.</summary>
    public string BundledPath { get; set; } = Path.Combine(AppContext.BaseDirectory, "agents");

    /// <summary>Endereco base opcional para buscar binarios que nao estao no servidor (desligado por padrao).</summary>
    public string? DownloadBaseUrl { get; set; }

    private string? bundledVersion;

    /// <summary>Versao efetiva do EYES distribuida por este servidor.</summary>
    public string Version
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(LatestVersion))
            {
                return LatestVersion.Trim();
            }
            if (bundledVersion is null)
            {
                var file = Path.Combine(BundledPath, "VERSION");
                bundledVersion = File.Exists(file) ? File.ReadAllText(file).Trim() : "3.0.0";
            }
            return bundledVersion;
        }
    }

    public string FileName(string plat, string goarch, string component = "eyes") =>
        $"{component}-v{Version}-{plat}-{goarch}" + (plat == "windows" ? ".exe" : string.Empty);

    /// <summary>
    /// Caminho do binario para a plataforma, procurando primeiro em BinariesPath e depois nos embutidos.
    /// component: "eyes" (agente) ou "eyes-tray" (app de bandeja).
    /// </summary>
    public string? FindBinary(string plat, string goarch, string component = "eyes")
    {
        var name = FileName(plat, goarch, component);
        foreach (var dir in new[] { BinariesPath, BundledPath })
        {
            if (string.IsNullOrWhiteSpace(dir))
            {
                continue;
            }
            var path = Path.Combine(dir, name);
            if (File.Exists(path))
            {
                return path;
            }
        }
        return null;
    }
}
