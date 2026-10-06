using System.Buffers.Text;
using System.Security.Cryptography;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Configuracao do acesso remoto (secao "Remote"; contrato docs/remoto/contrato-remoto.md, secao 11).</summary>
public sealed class RemoteSettings
{
    public const string Section = "Remote";

    /// <summary>Liga ou desliga o modulo inteiro.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Versao minima do EYES com acesso remoto (comparada com System.Version).</summary>
    public string MinimumAgentVersion { get; set; } = "3.1.0";

    /// <summary>Endereco interno desta replica para o encaminhamento entre replicas. Vazio: IP do conteiner e porta 8080.</summary>
    public string? AdvertiseUrl { get; set; }

    /// <summary>Sessoes simultaneas na mesma estacao (varios tecnicos podem ver e usar a tela ao mesmo tempo).</summary>
    public int MaxSessionsPerAgent { get; set; } = 4;

    public int MaxSessionsPerUser { get; set; } = 5;

    public int MaxCreatePerMinute { get; set; } = 10;

    /// <summary>
    /// Validade do registro da sessao no diretorio entre replicas. A replica dona renova a cada 15 s; se ela cair ou
    /// reiniciar, o registro expira e a sessao que ficou aberta no banco e fechada em seguida (nao bloqueia a estacao).
    /// </summary>
    public static readonly TimeSpan DirectoryTtl = TimeSpan.FromMinutes(1);

    /// <summary>Prazo para as pontas conectarem ao relay depois da criacao da sessao.</summary>
    public int ConnectSeconds { get; set; } = 60;
}

/// <summary>Tipos de quadro e codigos de fechamento do relay (contrato, secoes 4 a 7).</summary>
public static class RemoteFrames
{
    public const byte Auth = 0x01;
    public const byte AuthOk = 0x02;
    public const byte Paired = 0x03;
    public const byte PeerGone = 0x04;

    public const byte Hello = 0x10;
    public const byte FrameEnd = 0x12;
    public const byte Clipboard = 0x14;
    public const byte Consent = 0x16;
    public const byte Bye = 0x18;

    public const byte FirstInput = 0x20;
    public const byte LastInput = 0x27;

    public const byte FilesRequest = 0x40;
    public const byte FilesResponse = 0x41;
    public const byte FilesChunk = 0x42;
    public const byte FilesCredit = 0x43;
    public const byte FilesCancel = 0x44;

    public const byte RdpData = 0x50;

    public const int MaxDesktopFrame = 2 << 20;
    public const int MaxRdpFrame = 1 << 20;
    public const int MaxFilesFrame = (256 << 10) + 64;
    public const int MaxViewerFramesPerSecond = 200;

    public const int CloseAuth = 4401;
    public const int CloseForbidden = 4403;
    public const int ClosePeerTimeout = 4408;
    public const int CloseDuplicate = 4409;
    public const int CloseEnded = 4410;
    public const int CloseTooLarge = 4413;
    public const int CloseRate = 4429;

    public const string Desktop = "desktop";
    public const string Files = "files";
    public const string Rdp = "rdp";

    /// <summary>Canais de tela: a Tela propria (desktop) ou o RDP do GNOME (rdp); uma sessao tem no maximo um.</summary>
    public static bool IsScreen(string channel) => channel is Desktop or Rdp;
}

/// <summary>Tokens das pontas: 32 bytes aleatorios em base64url; so o SHA-256 fica guardado.</summary>
public static class RemoteTokens
{
    public static string New() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

    public static byte[] Hash(string token) => SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));

    public static bool Matches(byte[] hash, string? token) =>
        token is { Length: > 0 } && CryptographicOperations.FixedTimeEquals(hash, Hash(token));

    public static string NewSessionId() => Guid.NewGuid().ToString("N");
}
