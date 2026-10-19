using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using ModelContextProtocol;
using Cybereyes.Api.Infrastructure;

namespace Cybereyes.Api.Mcp;

/// <summary>
/// Chama a propria API REST com a credencial de quem chamou o MCP. Cada ferramenta passa pelas mesmas regras das rotas:
/// permissoes do usuario da chave, escopo por cliente, validacao, auditoria e avisos em tempo real.
/// </summary>
public sealed class PlatformApi(IHttpClientFactory factory, IHttpContextAccessor accessor, IServer server, IConfiguration config)
{
    public const string HttpClientName = "cybereyes-mcp";

    private static readonly string[] CredentialHeaders = ["Authorization", ApiKeyAuthenticationHandler.HeaderName, "Cookie"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private Uri? baseAddress;

    public Task<string> GetAsync(string path, CancellationToken ct, params (string Name, object? Value)[] query) =>
        SendAsync(HttpMethod.Get, WithQuery(path, query), null, ct);

    public Task<string> PostAsync(string path, object? body, CancellationToken ct) => SendAsync(HttpMethod.Post, path, body, ct);

    public Task<string> PutAsync(string path, object? body, CancellationToken ct) => SendAsync(HttpMethod.Put, path, body, ct);

    public Task<string> PatchAsync(string path, object? body, CancellationToken ct) => SendAsync(HttpMethod.Patch, path, body, ct);

    public Task<string> DeleteAsync(string path, CancellationToken ct) => SendAsync(HttpMethod.Delete, path, null, ct);

    public static string Segment(string value) => Uri.EscapeDataString(value);

    private async Task<string> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var context = accessor.HttpContext ?? throw new McpException("Chamada sem requisicao HTTP de origem");
        using var request = new HttpRequestMessage(method, new Uri(BaseAddress(), path));
        foreach (var name in CredentialHeaders)
        {
            if (context.Request.Headers.TryGetValue(name, out var values) && values.Count > 0)
            {
                request.Headers.TryAddWithoutValidation(name, values.ToArray());
            }
        }
        // A auditoria das rotas registra o IP de quem chamou o MCP, nao o da propria API.
        if (context.Connection.RemoteIpAddress is { } ip)
        {
            request.Headers.TryAddWithoutValidation("X-Forwarded-For", ip.ToString());
        }
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, options: Json);
        }

        using var client = factory.CreateClient(HttpClientName);
        using var response = await client.SendAsync(request, ct);
        var mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
        if (!response.IsSuccessStatusCode)
        {
            throw new McpException(ErrorMessage(response.StatusCode, await response.Content.ReadAsStringAsync(ct)));
        }
        if (mediaType.Length > 0 && !mediaType.Contains("json", StringComparison.OrdinalIgnoreCase) && !mediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
        {
            return $"Conteudo binario ({mediaType}, {response.Content.Headers.ContentLength?.ToString(CultureInfo.InvariantCulture) ?? "?"} bytes) nao e devolvido pelo MCP";
        }
        var text = await response.Content.ReadAsStringAsync(ct);
        return text.Length > 0 ? text : $"{{\"status\":{(int)response.StatusCode}}}";
    }

    private Uri BaseAddress()
    {
        if (baseAddress is not null)
        {
            return baseAddress;
        }
        if (config["Mcp:ApiBaseUrl"] is { Length: > 0 } configured)
        {
            return baseAddress = new Uri(configured);
        }
        // Na mesma maquina: a porta HTTP em que o Kestrel escuta (8080 no conteiner). Sem endereco (testes), o handler decide.
        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses
            .FirstOrDefault(a => a.StartsWith("http://", StringComparison.OrdinalIgnoreCase));
        return baseAddress = address is null
            ? new Uri("http://localhost")
            : new Uri($"http://127.0.0.1:{BindingAddress.Parse(address).Port.ToString(CultureInfo.InvariantCulture)}");
    }

    private static string WithQuery(string path, (string Name, object? Value)[] query)
    {
        var builder = new StringBuilder(path);
        var separator = path.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        foreach (var (name, value) in query)
        {
            var text = value switch
            {
                null => null,
                bool b => b ? "true" : "false",
                DateTimeOffset d => d.ToString("O", CultureInfo.InvariantCulture),
                IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
                _ => value.ToString(),
            };
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }
            builder.Append(separator).Append(Uri.EscapeDataString(name)).Append('=').Append(Uri.EscapeDataString(text));
            separator = '&';
        }
        return builder.ToString();
    }

    private static string ErrorMessage(HttpStatusCode status, string body)
    {
        var code = (int)status;
        var detail = string.Empty;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                detail = root.TryGetProperty("title", out var title) ? title.GetString() ?? string.Empty : string.Empty;
                if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object)
                {
                    var fields = errors.EnumerateObject().Select(e => $"{e.Name}: {string.Join(", ", e.Value.EnumerateArray().Select(v => v.GetString()))}");
                    detail = $"{detail} ({string.Join("; ", fields)})";
                }
            }
            else if (root.ValueKind == JsonValueKind.String)
            {
                detail = root.GetString() ?? string.Empty;
            }
        }
        catch (JsonException)
        {
            detail = body.Length > 300 ? body[..300] : body;
        }
        return code switch
        {
            401 => "HTTP 401: chave de API ausente ou invalida",
            403 => $"HTTP 403: o usuario da chave nao tem permissao para esta acao{(detail.Length > 0 ? $" ({detail})" : string.Empty)}",
            _ => $"HTTP {code}: {(detail.Length > 0 ? detail : status.ToString())}",
        };
    }
}
