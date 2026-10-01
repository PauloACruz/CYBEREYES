using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Numerics;

namespace WinCare.Api.Inventory;

public sealed record ParsedCidr(IPAddress Network, int Prefix)
{
    public override string ToString() => $"{Network}/{Prefix.ToString(CultureInfo.InvariantCulture)}";

    public bool Contains(IPAddress address)
    {
        if (address.AddressFamily != Network.AddressFamily)
        {
            return false;
        }
        return NetUtil.Mask(address, Prefix).Equals(Network);
    }

    /// <summary>Quantidade de enderecos utilizaveis (IPv4 sem rede e broadcast, exceto /31 e /32); IPv6 limitado a long.</summary>
    public long TotalHosts
    {
        get
        {
            var bits = (Network.AddressFamily == AddressFamily.InterNetwork ? 32 : 128) - Prefix;
            if (bits >= 62)
            {
                return long.MaxValue;
            }
            var total = 1L << bits;
            return Network.AddressFamily == AddressFamily.InterNetwork && bits >= 2 ? total - 2 : total;
        }
    }
}

public static class NetUtil
{
    public static IPAddress? ParseIp(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text) || text.Contains('/', StringComparison.Ordinal))
        {
            return null;
        }
        return IPAddress.TryParse(text, out var ip) && (ip.AddressFamily is AddressFamily.InterNetwork or AddressFamily.InterNetworkV6) ? ip : null;
    }

    /// <summary>Aceita "192.168.1.10/24" e normaliza para a rede "192.168.1.0/24".</summary>
    public static ParsedCidr? ParseCidr(string? value)
    {
        var parts = value?.Trim().Split('/');
        if (parts is not { Length: 2 } || ParseIp(parts[0]) is not { } ip ||
            !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var prefix))
        {
            return null;
        }
        var max = ip.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
        return prefix is < 0 || prefix > max ? null : new ParsedCidr(Mask(ip, prefix), prefix);
    }

    public static IPAddress Mask(IPAddress address, int prefix)
    {
        var bytes = address.GetAddressBytes();
        for (var i = 0; i < bytes.Length; i++)
        {
            var keep = Math.Clamp(prefix - (i * 8), 0, 8);
            bytes[i] &= (byte)(0xFF << (8 - keep));
        }
        return new IPAddress(bytes);
    }

    /// <summary>Endereco de um IP local informado pelo agente, que pode vir como "10.0.0.5/24".</summary>
    public static IPAddress? ParseHostAddress(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }
        var slash = text.IndexOf('/', StringComparison.Ordinal);
        return ParseIp(slash >= 0 ? text[..slash] : text);
    }

    public static string? NormalizeMac(string? value)
    {
        var hex = new string((value ?? string.Empty).Where(Uri.IsHexDigit).ToArray());
        var separators = (value ?? string.Empty).Where(c => !Uri.IsHexDigit(c)).Distinct().ToArray();
        if (hex.Length != 12 || separators.Any(c => c is not (':' or '-' or '.')))
        {
            return null;
        }
        return string.Join(':', Enumerable.Range(0, 6).Select(i => hex.Substring(i * 2, 2))).ToUpperInvariant();
    }

    public static BigInteger ToNumber(IPAddress address) => new(address.GetAddressBytes(), isUnsigned: true, isBigEndian: true);
}
