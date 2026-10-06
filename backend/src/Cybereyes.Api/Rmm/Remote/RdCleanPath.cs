using System.Formats.Asn1;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>
/// O minimo do RDCleanPath (protocolo do cliente RDP do navegador, IronRDP) que o relay precisa no canal rdp: ler o
/// token do visualizador no pedido (campo proxy_auth) e responder erro HTTP antes de fechar. O resto do protocolo e
/// tratado pelo EYES (contrato, secao 5.4). DER: SEQUENCE com campos de tag de contexto EXPLICIT.
/// </summary>
public static class RdCleanPath
{
    public const int Version1 = 3390;

    private static readonly Asn1Tag Version = new(TagClass.ContextSpecific, 0, isConstructed: true);
    private static readonly Asn1Tag Error = new(TagClass.ContextSpecific, 1, isConstructed: true);
    private static readonly Asn1Tag Destination = new(TagClass.ContextSpecific, 2, isConstructed: true);
    private static readonly Asn1Tag ProxyAuth = new(TagClass.ContextSpecific, 3, isConstructed: true);
    private static readonly Asn1Tag X224 = new(TagClass.ContextSpecific, 6, isConstructed: true);

    /// <summary>Le o pedido do navegador: devolve o proxy_auth quando a mensagem e um pedido valido (com destino e X.224).</summary>
    public static string? ReadProxyAuth(ReadOnlyMemory<byte> der)
    {
        try
        {
            var outer = new AsnReader(der, AsnEncodingRules.DER);
            var seq = outer.ReadSequence();
            outer.ThrowIfNotEmpty();
            if (!seq.ReadSequence(Version).TryReadInt32(out var version) || version != Version1)
            {
                return null;
            }
            string? destination = null, proxyAuth = null;
            var hasX224 = false;
            while (seq.HasData)
            {
                var tag = seq.PeekTag();
                if (tag == Destination)
                {
                    destination = seq.ReadSequence(Destination).ReadCharacterString(UniversalTagNumber.UTF8String);
                }
                else if (tag == ProxyAuth)
                {
                    proxyAuth = seq.ReadSequence(ProxyAuth).ReadCharacterString(UniversalTagNumber.UTF8String);
                }
                else if (tag == X224)
                {
                    hasX224 = seq.ReadSequence(X224).ReadOctetString().Length > 0;
                }
                else
                {
                    seq.ReadEncodedValue();
                }
            }
            return destination is { Length: > 0 } && hasX224 && proxyAuth is { Length: > 0 } ? proxyAuth : null;
        }
        catch (AsnContentException)
        {
            return null;
        }
    }

    /// <summary>Resposta de erro geral com codigo HTTP (o navegador mostra o codigo).</summary>
    public static byte[] HttpError(int status)
    {
        var w = new AsnWriter(AsnEncodingRules.DER);
        using (w.PushSequence())
        {
            using (w.PushSequence(Version))
            {
                w.WriteInteger(Version1);
            }
            using (w.PushSequence(Error))
            {
                using (w.PushSequence())
                {
                    using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 0, isConstructed: true)))
                    {
                        w.WriteInteger(1);
                    }
                    using (w.PushSequence(new Asn1Tag(TagClass.ContextSpecific, 1, isConstructed: true)))
                    {
                        w.WriteInteger(status);
                    }
                }
            }
        }
        return w.Encode();
    }
}
