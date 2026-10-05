namespace Cybereyes.Api.Rmm;

public sealed class AgentSettings
{
    public const string Section = "Agent";

    /// <summary>Versao do agente distribuida pelo servidor e versao minima aceita no registro.</summary>
    public string LatestVersion { get; set; } = "2.11.0";

    /// <summary>Pasta local com os binarios do agente (tacticalagent-v{versao}-{plat}-{arch}[.exe]).</summary>
    public string? BinariesPath { get; set; }

    /// <summary>Endereco base de download quando o binario nao esta na pasta local, por exemplo os releases do GitHub.</summary>
    public string DownloadBaseUrl { get; set; } = "https://github.com/PauloACruz/rmmagentwincare/releases/download";

    public string FileName(string plat, string goarch) =>
        $"tacticalagent-v{LatestVersion}-{plat}-{goarch}" + (plat == "windows" ? ".exe" : string.Empty);
}
