using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Cybereyes.Api.Notifications;

namespace Cybereyes.Api.Tests;

/// <summary>Cifra do Web Push (RFC 8291) e assinatura VAPID (RFC 8292), sem servico de push.</summary>
public sealed class WebPushCryptoTests
{
    // Exemplo do apendice A da RFC 8291.
    private const string Plaintext = "When I grow up, I want to be a watermelon";
    private const string ServerPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private const string ServerPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private const string UserAgentPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private const string UserAgentPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    private const string Salt = "DGv6ra1nlYgDCS1FRnbzlw";
    private const string AuthSecret = "BTBZMqHH6r4Tts7J_aSIgg";
    private const string Expected =
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    [Fact]
    public void Encrypt_MatchesRfc8291Example()
    {
        using var server = Key(ServerPublic, ServerPrivate);
        var body = WebPushCrypto.Encrypt(Encoding.UTF8.GetBytes(Plaintext), Base64Url.DecodeFromChars(UserAgentPublic),
            Base64Url.DecodeFromChars(AuthSecret), Base64Url.DecodeFromChars(Salt), server);

        Assert.Equal(Expected, Base64Url.EncodeToString(body));
    }

    [Fact]
    public void Encrypt_DecryptsWithTheBrowserKeys()
    {
        using var browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var browserPublic = Uncompressed(browser.ExportParameters(false).Q);
        var auth = RandomNumberGenerator.GetBytes(16);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new PushMessage("Novo chamado #7", "Impressora parada · Maria", "/chamados/7", "chamado-7"),
            JsonSerializerOptions.Web);

        var body = WebPushCrypto.Encrypt(payload, browserPublic, auth);

        Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16)));
        Assert.Equal(payload, Decrypt(body, browser, browserPublic, auth));
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt(new byte[WebPushCrypto.MaxPayload + 1], browserPublic, auth));
    }

    [Fact]
    public void VapidAuthorization_IsSignedJwtForThePushServiceOrigin()
    {
        var keys = VapidKeys.Generate();
        var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var header = WebPushCrypto.VapidAuthorization(new Uri("https://fcm.googleapis.com/fcm/send/abc:def"), "https://rmm.exemplo.com", keys, now);

        var match = System.Text.RegularExpressions.Regex.Match(header, "^vapid t=([^.]+)\\.([^.]+)\\.([^,]+), k=(.+)$");
        Assert.True(match.Success, header);
        Assert.Equal(keys.PublicKey, match.Groups[4].Value);
        var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(match.Groups[2].Value)).RootElement;
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
        Assert.Equal(now.AddHours(12).ToUnixTimeSeconds(), claims.GetProperty("exp").GetInt64());
        Assert.Equal("https://rmm.exemplo.com", claims.GetProperty("sub").GetString());

        var publicKey = Base64Url.DecodeFromChars(keys.PublicKey);
        using var verifier = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = publicKey[1..33], Y = publicKey[33..] },
        });
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes($"{match.Groups[1].Value}.{match.Groups[2].Value}"),
            Base64Url.DecodeFromChars(match.Groups[3].Value), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/abc", true)]
    [InlineData("https://wns2-par02p.notify.windows.com/w/?token=abc", true)]
    [InlineData("https://web.push.apple.com/QGx", true)]
    [InlineData("http://fcm.googleapis.com/fcm/send/abc", false)]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/abc", false)]
    [InlineData("https://evil.example.com/fcm.googleapis.com", false)]
    [InlineData("https://fcm.googleapis.com.evil.example.com/x", false)]
    [InlineData("https://169.254.169.254/latest/meta-data", false)]
    [InlineData("nao e url", false)]
    public void AllowedEndpoint_OnlyBrowserPushServices(string endpoint, bool allowed) =>
        Assert.Equal(allowed, PushKeys.AllowedEndpoint(endpoint));

    private static ECDiffieHellman Key(string publicKey, string privateKey)
    {
        var q = Base64Url.DecodeFromChars(publicKey);
        return ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = q[1..33], Y = q[33..] },
            D = Base64Url.DecodeFromChars(privateKey),
        });
    }

    private static byte[] Uncompressed(ECPoint point) => [4, .. point.X!, .. point.Y!];

    /// <summary>O que o navegador faz ao receber: deriva as mesmas chaves com a chave privada dele e abre o registro.</summary>
    private static byte[] Decrypt(byte[] body, ECDiffieHellman browser, byte[] browserPublic, byte[] auth)
    {
        var salt = body[..16];
        var serverPublic = body[21..86];
        using var server = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = serverPublic[1..33], Y = serverPublic[33..] },
        });
        var secret = browser.DeriveRawSecretAgreement(server.PublicKey);
        byte[] info = [.. "WebPush: info\0"u8, .. browserPublic, .. serverPublic];
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, secret, 32, auth, info);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, "Content-Encoding: nonce\0"u8.ToArray());
        var record = body[86..];
        var plain = new byte[record.Length - 16];
        using var aes = new AesGcm(cek, 16);
        aes.Decrypt(nonce, record[..^16], record[^16..], plain);
        Assert.Equal(2, plain[^1]);
        return plain[..^1];
    }
}
