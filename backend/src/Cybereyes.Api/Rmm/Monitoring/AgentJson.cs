using System.Text.Json;

namespace Cybereyes.Api.Rmm.Monitoring;

/// <summary>Leitura tolerante de corpos JSON enviados pelo agente.</summary>
internal static class AgentJson
{
    /// <summary>Texto de um valor JSON qualquer (string como esta; numero, booleano ou objeto pelo texto bruto).</summary>
    public static string? AsText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText(),
    };
}
