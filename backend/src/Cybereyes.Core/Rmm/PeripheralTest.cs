namespace Cybereyes.Core.Rmm;

/// <summary>
/// Teste de periferico (teclado, mouse e touchpad, USB, camera) aberto pelo tecnico no console e feito pelo usuario no app de
/// bandeja do EYES, normalmente com o tecnico ao telefone. O app manda o estado da tela a cada mudanca (<see cref="State"/>,
/// JSON do app): o texto digitado, as teclas pressionadas, o layout configurado e o resultado de cada secao.
/// </summary>
public sealed class AgentPeripheralTest
{
    public long Id { get; set; }
    public int AgentId { get; set; }

    /// <summary>Secao aberta no app; o tecnico troca durante o teste.</summary>
    public string Section { get; set; } = PeripheralTestSection.Keyboard;
    public string Status { get; set; } = PeripheralTestStatus.Pending;
    public string RequestedBy { get; set; } = string.Empty;

    /// <summary>Usuario da sessao em que o app respondeu (DOMINIO\usuario).</summary>
    public string? Username { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ConnectedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    /// <summary>Quem encerrou: o tecnico, o usuario pelo app ou o tempo esgotado.</summary>
    public string? EndedBy { get; set; }
    public string? State { get; set; }
}

public static class PeripheralTestSection
{
    public const string Keyboard = "keyboard";
    /// <summary>Mouse e touchpad.</summary>
    public const string Mouse = "pointer";
    public const string Usb = "usb";
    public const string Camera = "camera";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Keyboard, Mouse, Usb, Camera };
}

public static class PeripheralTestStatus
{
    /// <summary>Pedido enviado; o app ainda nao respondeu.</summary>
    public const string Pending = "pending";

    /// <summary>O app abriu o teste e esta mandando o estado.</summary>
    public const string Active = "active";
    public const string Ended = "ended";

    public static bool IsOpen(string status) => status is Pending or Active;
}
