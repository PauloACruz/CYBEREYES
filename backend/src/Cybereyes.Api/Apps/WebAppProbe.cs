using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Cybereyes.Core.Apps;

namespace Cybereyes.Api.Apps;

/// <summary>Parametros de uma verificacao, copiados da aplicacao.</summary>
public sealed record ProbeRequest(string CheckType, string Target, string Method, string ExpectedStatus, string? Keyword, int TimeoutSeconds,
    bool IgnoreTlsErrors)
{
    public static ProbeRequest From(WebApp app) => new(app.CheckType, app.CheckTarget, app.Method, app.ExpectedStatus, app.Keyword,
        app.TimeoutSeconds, app.IgnoreTlsErrors);
}

public sealed record ProbeResult(bool Up, int? LatencyMs, int? StatusCode, string? Error, DateTimeOffset? CertificateExpiresAt);

/// <summary>Verificacao de disponibilidade: HTTP(S) com codigo esperado e palavra-chave, ou conexao TCP.</summary>
public static class WebAppProbe
{
    private const int MaxBodyBytes = 1024 * 1024;

    public static Task<ProbeResult> RunAsync(ProbeRequest request, CancellationToken ct) =>
        request.CheckType == WebAppCheckType.Tcp ? TcpAsync(request, ct) : HttpAsync(request, ct);

    private static async Task<ProbeResult> HttpAsync(ProbeRequest request, CancellationToken ct)
    {
        var timeout = TimeSpan.FromSeconds(request.TimeoutSeconds);
        DateTimeOffset? certificateExpires = null;
        SslPolicyErrors tlsErrors = SslPolicyErrors.None;
        // Conexao nova a cada verificacao: detecta falha de DNS/TLS e sempre recebe o certificado para ler o vencimento.
        using var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
            UseCookies = false,
            ConnectTimeout = timeout,
            PooledConnectionLifetime = TimeSpan.Zero,
            AutomaticDecompression = DecompressionMethods.All,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (_, certificate, _, errors) =>
                {
                    if (certificateExpires is null && certificate is X509Certificate2 x509)
                    {
                        certificateExpires = new DateTimeOffset(x509.NotAfter.ToUniversalTime());
                        tlsErrors = errors;
                    }
                    return request.IgnoreTlsErrors || errors == SslPolicyErrors.None;
                },
            },
        };
        using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        using var message = new HttpRequestMessage(request.Method == "HEAD" ? HttpMethod.Head : HttpMethod.Get, request.Target);
        message.Headers.UserAgent.Add(new ProductInfoHeaderValue("Cybereyes-Monitor", "1.0"));
        message.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        var watch = Stopwatch.StartNew();
        try
        {
            using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            var latency = (int)watch.ElapsedMilliseconds;
            var status = (int)response.StatusCode;
            if (!StatusMatcher.Matches(request.ExpectedStatus, status))
            {
                return new ProbeResult(false, latency, status, $"Resposta HTTP {status} {response.ReasonPhrase} (esperado {request.ExpectedStatus})",
                    certificateExpires);
            }
            if (!string.IsNullOrEmpty(request.Keyword) && request.Method != "HEAD")
            {
                var body = await ReadBodyAsync(response, cts.Token);
                if (!body.Contains(request.Keyword, StringComparison.OrdinalIgnoreCase))
                {
                    return new ProbeResult(false, latency, status, $"A pagina nao contem o texto esperado \"{request.Keyword}\"", certificateExpires);
                }
            }
            return new ProbeResult(true, latency, status, null, certificateExpires);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ProbeResult(false, null, null, $"Tempo esgotado ({request.TimeoutSeconds} s) sem resposta", certificateExpires);
        }
        catch (HttpRequestException ex)
        {
            return new ProbeResult(false, null, null, Describe(ex, tlsErrors), certificateExpires);
        }
    }

    private static async Task<string> ReadBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var buffer = new byte[MaxBodyBytes];
        var total = 0;
        int read;
        while (total < buffer.Length && (read = await stream.ReadAsync(buffer.AsMemory(total), ct)) > 0)
        {
            total += read;
        }
        return Encoding.UTF8.GetString(buffer, 0, total);
    }

    private static string Describe(HttpRequestException ex, SslPolicyErrors tlsErrors)
    {
        var detail = ex.InnerException?.Message ?? ex.Message;
        return ex.HttpRequestError switch
        {
            HttpRequestError.NameResolutionError => "Nome nao encontrado no DNS",
            HttpRequestError.ConnectionError when ex.InnerException is SocketException { SocketErrorCode: SocketError.ConnectionRefused } =>
                "Conexao recusada: nada escutando na porta",
            HttpRequestError.ConnectionError => $"Falha de conexao: {detail}",
            HttpRequestError.SecureConnectionError when tlsErrors != SslPolicyErrors.None => $"Certificado TLS invalido ({TlsReason(tlsErrors)})",
            HttpRequestError.SecureConnectionError => $"Falha na negociacao TLS: {detail}",
            _ when ex.InnerException is AuthenticationException => $"Falha na negociacao TLS: {detail}",
            _ => $"Falha na requisicao: {detail}",
        };
    }

    private static string TlsReason(SslPolicyErrors errors)
    {
        var reasons = new List<string>();
        if (errors.HasFlag(SslPolicyErrors.RemoteCertificateNameMismatch))
        {
            reasons.Add("nome do certificado nao confere");
        }
        if (errors.HasFlag(SslPolicyErrors.RemoteCertificateChainErrors))
        {
            reasons.Add("cadeia invalida, vencido ou autoassinado");
        }
        if (errors.HasFlag(SslPolicyErrors.RemoteCertificateNotAvailable))
        {
            reasons.Add("sem certificado");
        }
        return string.Join(", ", reasons);
    }

    private static async Task<ProbeResult> TcpAsync(ProbeRequest request, CancellationToken ct)
    {
        if (!TcpTarget.TryParse(request.Target, out var host, out var port))
        {
            return new ProbeResult(false, null, null, "Destino TCP invalido: use host:porta", null);
        }
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(request.TimeoutSeconds));
        using var tcp = new TcpClient();
        var watch = Stopwatch.StartNew();
        try
        {
            await tcp.ConnectAsync(host, port, cts.Token);
            return new ProbeResult(true, (int)watch.ElapsedMilliseconds, null, null, null);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new ProbeResult(false, null, null, $"Tempo esgotado ({request.TimeoutSeconds} s) ao conectar a {host}:{port}", null);
        }
        catch (SocketException ex)
        {
            var reason = ex.SocketErrorCode switch
            {
                SocketError.ConnectionRefused => "conexao recusada",
                SocketError.HostNotFound or SocketError.NoData or SocketError.TryAgain => "nome nao encontrado no DNS",
                SocketError.HostUnreachable or SocketError.NetworkUnreachable => "rede inalcancavel",
                _ => ex.SocketErrorCode.ToString(),
            };
            return new ProbeResult(false, null, null, $"Porta {port} de {host}: {reason}", null);
        }
    }
}

public static class TcpTarget
{
    public static bool TryParse(string value, out string host, out int port)
    {
        host = string.Empty;
        port = 0;
        var text = value.Trim();
        var colon = text.LastIndexOf(':');
        if (colon <= 0 || !int.TryParse(text[(colon + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out port) || port is < 1 or > 65535)
        {
            return false;
        }
        host = text[..colon].Trim('[', ']');
        return host.Length > 0 && Uri.CheckHostName(host) != UriHostNameType.Unknown;
    }
}

/// <summary>Codigos HTTP aceitos: faixas e listas separadas por virgula ("200-399", "200,204,301-302").</summary>
public static class StatusMatcher
{
    public static bool IsValid(string spec) => Parse(spec) is { Count: > 0 };

    public static bool Matches(string spec, int status) => Parse(spec)?.Any(r => status >= r.From && status <= r.To) ?? false;

    private static List<(int From, int To)>? Parse(string spec)
    {
        var ranges = new List<(int, int)>();
        foreach (var part in spec.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var bounds = part.Split('-', StringSplitOptions.TrimEntries);
            if (bounds.Length is < 1 or > 2 || !TryCode(bounds[0], out var from))
            {
                return null;
            }
            var to = from;
            if (bounds.Length == 2 && (!TryCode(bounds[1], out to) || to < from))
            {
                return null;
            }
            ranges.Add((from, to));
        }
        return ranges;
    }

    private static bool TryCode(string text, out int code) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out code) && code is >= 100 and <= 599;
}
