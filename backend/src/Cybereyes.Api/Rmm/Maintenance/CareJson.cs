using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cybereyes.Api.Rmm.Maintenance;

/// <summary>Leitura tolerante de JSON vindo do agente: valores com tipo inesperado viram nulo em vez de excecao.</summary>
internal static class CareJson
{
    public static string? Str(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    public static int? Int(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<double>(out var d) && double.IsFinite(d)
        ? (int)Math.Round(d)
        : null;
}
