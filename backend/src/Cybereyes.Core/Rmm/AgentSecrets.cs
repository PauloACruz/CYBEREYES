using System.Security.Cryptography;
using System.Text;

namespace Cybereyes.Core.Rmm;

public static class AgentSecrets
{
    public static string NewAgentToken() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(20));

    public static string NewInstallerToken() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string NatsPasswordHash(string token) => BCrypt.Net.BCrypt.HashPassword(token, workFactor: 10);
}
