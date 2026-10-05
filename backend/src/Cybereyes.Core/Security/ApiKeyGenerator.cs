using System.Security.Cryptography;
using System.Text;

namespace Cybereyes.Core.Security;

public static class ApiKeyGenerator
{
    public const string KeyPrefix = "ce_";
    public const int PrefixLength = 8;

    public static (string Key, string Prefix, string Hash) Create()
    {
        var token = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var key = KeyPrefix + token;
        return (key, token[..PrefixLength], Hash(key));
    }

    public static string Hash(string key) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
