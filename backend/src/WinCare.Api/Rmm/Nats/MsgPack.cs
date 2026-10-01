using System.Text.Json;
using MessagePack;
using MessagePack.Resolvers;

namespace WinCare.Api.Rmm.Nats;

/// <summary>Conversao entre msgpack (formato do agente Go) e tipos .NET simples.</summary>
public static class MsgPack
{
    private static readonly MessagePackSerializerOptions Options = ContractlessStandardResolver.Options
        .WithSecurity(MessagePackSecurity.UntrustedData);

    public static byte[] Serialize(object value) => MessagePackSerializer.Serialize(value, Options);

    public static object? Deserialize(ReadOnlyMemory<byte> data) => Normalize(MessagePackSerializer.Deserialize<object?>(data, Options));

    public static IReadOnlyDictionary<string, object?>? DeserializeMap(ReadOnlyMemory<byte> data) =>
        Deserialize(data) as IReadOnlyDictionary<string, object?>;

    public static string? GetString(this IReadOnlyDictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) ? value as string : null;

    public static bool GetBool(this IReadOnlyDictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) && value is true;

    public static double? GetNumber(this IReadOnlyDictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) ? value switch
        {
            null => null,
            double d => d,
            float f => f,
            IConvertible c when value is not string and not bool => c.ToDouble(System.Globalization.CultureInfo.InvariantCulture),
            _ => null,
        } : null;

    public static string ToJson(object? value) => JsonSerializer.Serialize(value);

    private static object? Normalize(object? value) => value switch
    {
        IDictionary<object, object?> map => map.ToDictionary(
            kv => kv.Key as string ?? Convert.ToString(kv.Key, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            kv => Normalize(kv.Value),
            StringComparer.Ordinal),
        byte[] bytes => System.Text.Encoding.UTF8.GetString(bytes),
        object[] items => items.Select(Normalize).ToList(),
        _ => value,
    };
}
