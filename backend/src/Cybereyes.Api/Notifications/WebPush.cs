using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Cybereyes.Api.Notifications;

/// <summary>Par de chaves VAPID (RFC 8292) em base64url: publica P-256 sem compressao (65 bytes) e privada (32 bytes).</summary>
public sealed record VapidKeys(string PublicKey, string PrivateKey)
{
    public static VapidKeys Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(includePrivateParameters: true);
        return new VapidKeys(Base64Url.EncodeToString(WebPushCrypto.Uncompressed(parameters.Q)), Base64Url.EncodeToString(parameters.D!));
    }
}

/// <summary>
/// Cifra e assinatura do Web Push sem biblioteca externa: conteudo "aes128gcm" (RFC 8188/8291) e cabecalho
/// "Authorization: vapid" com JWT ES256 (RFC 8292).
/// </summary>
public static class WebPushCrypto
{
    private const int RecordSize = 4096;
    private static readonly byte[] KeyInfo = "WebPush: info\0"u8.ToArray();
    private static readonly byte[] CekInfo = "Content-Encoding: aes128gcm\0"u8.ToArray();
    private static readonly byte[] NonceInfo = "Content-Encoding: nonce\0"u8.ToArray();

    /// <summary>Maior mensagem que cabe num registro de 4096 bytes (menos tag de 16 e delimitador de 1).</summary>
    public const int MaxPayload = RecordSize - 16 - 1;

    /// <summary>
    /// Cifra a mensagem para a assinatura do navegador. Saida: sal (16), tamanho do registro (4), tamanho da chave (1),
    /// chave publica efemera do servidor (65) e o registro cifrado. Sal e chave do servidor so sao informados nos testes.
    /// </summary>
    public static byte[] Encrypt(ReadOnlySpan<byte> payload, ReadOnlySpan<byte> userAgentPublicKey, ReadOnlySpan<byte> authSecret,
        byte[]? salt = null, ECDiffieHellman? serverKey = null)
    {
        if (payload.Length > MaxPayload)
        {
            throw new ArgumentException("Mensagem grande demais para o Web Push", nameof(payload));
        }
        salt ??= RandomNumberGenerator.GetBytes(16);
        var ownsKey = serverKey is null;
        var server = serverKey ?? ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        try
        {
            var serverPublic = Uncompressed(server.ExportParameters(includePrivateParameters: false).Q);
            using var userAgent = ECDiffieHellman.Create(PublicParameters(userAgentPublicKey));
            var sharedSecret = server.DeriveRawSecretAgreement(userAgent.PublicKey);

            // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0 || ua_public || as_public, 32)
            var info = new byte[KeyInfo.Length + 65 + 65];
            KeyInfo.CopyTo(info, 0);
            userAgentPublicKey.CopyTo(info.AsSpan(KeyInfo.Length));
            serverPublic.CopyTo(info, KeyInfo.Length + 65);
            var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, authSecret.ToArray(), info);

            var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, CekInfo);
            var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, NonceInfo);

            // Registro unico: a mensagem seguida do delimitador 0x02 (ultimo registro), sem preenchimento.
            var plain = new byte[payload.Length + 1];
            payload.CopyTo(plain);
            plain[^1] = 2;
            var cipher = new byte[plain.Length];
            var tag = new byte[16];
            using (var aes = new AesGcm(cek, tag.Length))
            {
                aes.Encrypt(nonce, plain, cipher, tag);
            }

            var body = new byte[16 + 4 + 1 + 65 + cipher.Length + tag.Length];
            salt.CopyTo(body, 0);
            BinaryPrimitives.WriteUInt32BigEndian(body.AsSpan(16), RecordSize);
            body[20] = 65;
            serverPublic.CopyTo(body, 21);
            cipher.CopyTo(body, 86);
            tag.CopyTo(body, 86 + cipher.Length);
            return body;
        }
        finally
        {
            if (ownsKey)
            {
                server.Dispose();
            }
        }
    }

    /// <summary>Valor do cabecalho Authorization: "vapid t=&lt;JWT&gt;, k=&lt;chave publica&gt;" para a origem do servico de push.</summary>
    public static string VapidAuthorization(Uri endpoint, string subject, VapidKeys keys, DateTimeOffset now)
    {
        var audience = endpoint.GetLeftPart(UriPartial.Authority);
        var header = Base64Url.EncodeToString("{\"typ\":\"JWT\",\"alg\":\"ES256\"}"u8);
        var claims = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["aud"] = audience,
            ["exp"] = now.AddHours(12).ToUnixTimeSeconds(),
            ["sub"] = subject,
        }));
        var unsigned = $"{header}.{claims}";
        using var key = ECDsa.Create(PrivateParameters(keys));
        var signature = key.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"vapid t={unsigned}.{Base64Url.EncodeToString(signature)}, k={keys.PublicKey}";
    }

    /// <summary>Chave publica P-256 valida em formato sem compressao (0x04 || X || Y)?</summary>
    public static bool IsValidPublicKey(ReadOnlySpan<byte> key)
    {
        if (key.Length != 65 || key[0] != 4)
        {
            return false;
        }
        try
        {
            using var ecdh = ECDiffieHellman.Create(PublicParameters(key));
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    internal static byte[] Uncompressed(ECPoint point)
    {
        var key = new byte[65];
        key[0] = 4;
        point.X!.CopyTo(key, 1);
        point.Y!.CopyTo(key, 33);
        return key;
    }

    private static ECParameters PublicParameters(ReadOnlySpan<byte> key) => new()
    {
        Curve = ECCurve.NamedCurves.nistP256,
        Q = new ECPoint { X = key[1..33].ToArray(), Y = key[33..65].ToArray() },
    };

    private static ECParameters PrivateParameters(VapidKeys keys)
    {
        var parameters = PublicParameters(Base64Url.DecodeFromChars(keys.PublicKey));
        parameters.D = Base64Url.DecodeFromChars(keys.PrivateKey);
        return parameters;
    }
}
