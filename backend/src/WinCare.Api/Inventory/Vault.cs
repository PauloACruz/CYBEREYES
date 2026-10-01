using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace WinCare.Api.Inventory;

public sealed class VaultSettings
{
    public const string Section = "Vault";

    /// <summary>Chave AES-256 em base64 (32 bytes). Fica fora do banco, em variavel de ambiente.</summary>
    public string? Key { get; set; }
}

/// <summary>Cifra os segredos do cofre com AES-256-GCM: "v1:" + base64(nonce 12 + tag 16 + texto cifrado).</summary>
public sealed class Vault(IOptions<VaultSettings> options)
{
    private const string Prefix = "v1:";

    public bool Enabled => KeyBytes() is not null;

    private byte[]? KeyBytes()
    {
        try
        {
            var key = string.IsNullOrWhiteSpace(options.Value.Key) ? null : Convert.FromBase64String(options.Value.Key.Trim());
            return key is { Length: 32 } ? key : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public string Encrypt(string secret)
    {
        var key = KeyBytes() ?? throw new InvalidOperationException("Cofre sem chave");
        var plain = Encoding.UTF8.GetBytes(secret);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var cipher = new byte[plain.Length];
        using (var aes = new AesGcm(key, 16))
        {
            aes.Encrypt(nonce, plain, cipher, tag);
        }
        return Prefix + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string Decrypt(string stored)
    {
        var key = KeyBytes() ?? throw new InvalidOperationException("Cofre sem chave");
        if (!stored.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new CryptographicException("Formato de segredo desconhecido");
        }
        var data = Convert.FromBase64String(stored[Prefix.Length..]);
        var plain = new byte[data.Length - 28];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(data.AsSpan(0, 12), data.AsSpan(28), data.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }
}
