using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Cybereyes.Api.Tests;

/// <summary>
/// Teste de ponta a ponta com o EYES de verdade (agent/): o binario e compilado com o Go da maquina
/// (ou vem de EYES_BIN) e fala com a API de teste por um proxy HTTP numa porta real e com o NATS do fixture.
/// </summary>
public sealed class EyesFactAttribute : FactAttribute
{
    public EyesFactAttribute()
    {
        if (EyesBinary.Path is null)
        {
            Skip = "EYES indisponivel: defina EYES_BIN ou instale o Go para compilar agent/";
        }
    }
}

public static class EyesBinary
{
    private static readonly Lazy<string?> Built = new(Build);

    public static string? Path => Built.Value;

    private static string? Build()
    {
        if (Environment.GetEnvironmentVariable("EYES_BIN") is { Length: > 0 } bin && File.Exists(bin))
        {
            return bin;
        }
        return BuildVersion(null, System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"eyes-test-{Environment.ProcessId}"));
    }

    /// <summary>Compila o EYES (versao opcional por -ldflags). Nulo quando nao ha Go nesta maquina.</summary>
    public static string? BuildVersion(string? version, string output)
    {
        if (!OperatingSystem.IsLinux())
        {
            return null;
        }
        var go = FindGo();
        if (go is null)
        {
            return null;
        }
        var root = RepoRoot();
        var args = new List<string> { "build", "-o", output };
        if (version is not null)
        {
            args.Add("-ldflags");
            args.Add($"-X github.com/pauloacruz/cybereyes/agent/internal/version.Version={version}");
        }
        args.Add("./cmd/eyes");
        var start = new ProcessStartInfo(go, args)
        {
            WorkingDirectory = System.IO.Path.Combine(root, "agent"),
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        start.Environment["CGO_ENABLED"] = "0";
        using var process = Process.Start(start)!;
        var err = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException("Falha ao compilar o EYES: " + err);
        }
        return output;
    }

    private static string? FindGo()
    {
        var home = Environment.GetEnvironmentVariable("HOME") ?? string.Empty;
        foreach (var candidate in new[] { System.IO.Path.Combine(home, ".local", "bin", "go"), "/usr/local/go/bin/go", "/usr/bin/go" })
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(':'))
        {
            var candidate = System.IO.Path.Combine(dir, "go");
            if (dir.Length > 0 && File.Exists(candidate))
            {
                return candidate;
            }
        }
        return null;
    }

    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(System.IO.Path.Combine(dir.FullName, "agent")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? throw new InvalidOperationException("Raiz do repositorio nao encontrada");
    }
}

/// <summary>Proxy HTTP numa porta local que repassa as requisicoes do EYES ao servidor de teste em memoria.</summary>
public sealed class ApiProxy : IAsyncDisposable
{
    private readonly WebApplication app;

    public string Url { get; }

    private ApiProxy(WebApplication app, string url)
    {
        this.app = app;
        Url = url;
    }

    public static async Task<ApiProxy> StartAsync(ApiFixture fixture)
    {
        var port = FreePort();
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        var app = builder.Build();
        var upstream = fixture.Server.CreateClient();
        app.Run(async ctx =>
        {
            using var request = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), "https://localhost" + ctx.Request.Path + ctx.Request.QueryString);
            if (ctx.Request.ContentLength is > 0 || ctx.Request.Headers.TransferEncoding.Count > 0)
            {
                var body = new MemoryStream();
                await ctx.Request.Body.CopyToAsync(body);
                body.Position = 0;
                request.Content = new StreamContent(body);
                if (ctx.Request.ContentType is { } type)
                {
                    request.Content.Headers.TryAddWithoutValidation("Content-Type", type);
                }
            }
            foreach (var header in ctx.Request.Headers)
            {
                if (header.Key is "Host" or "Content-Type" or "Content-Length" or "Transfer-Encoding")
                {
                    continue;
                }
                request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }
            using var response = await upstream.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
            ctx.Response.StatusCode = (int)response.StatusCode;
            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (header.Key is "Transfer-Encoding")
                {
                    continue;
                }
                ctx.Response.Headers[header.Key] = header.Value.ToArray();
            }
            await response.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
        });
        await app.StartAsync();
        return new ApiProxy(app, $"http://127.0.0.1:{port}");
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }
}

/// <summary>EYES registrado com --no-service e executado em primeiro plano (eyes run) numa pasta de dados temporaria.</summary>
public sealed class EyesProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly StringBuilder log = new();

    public string DataDir { get; }
    public string TraySocket { get; }

    private EyesProcess(Process process, string dataDir, string traySocket)
    {
        this.process = process;
        DataDir = dataDir;
        TraySocket = traySocket;
    }

    public string Log
    {
        get
        {
            lock (log)
            {
                return log.ToString();
            }
        }
    }

    public static async Task<EyesProcess> StartAsync(string apiUrl, string natsUrl, int siteId, string installerToken)
    {
        var dataDir = Directory.CreateTempSubdirectory("eyes-e2e-").FullName;
        var traySocket = System.IO.Path.Combine(dataDir, "tray.sock");
        // Copia propria: a atualizacao remota troca o executavel em uso.
        var binary = System.IO.Path.Combine(dataDir, "eyes");
        File.Copy(EyesBinary.Path!, binary);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(binary, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        var install = new ProcessStartInfo(binary, ["install", "--no-service", "--api", apiUrl, "--nats-url", natsUrl, "--site-id",
            siteId.ToString(System.Globalization.CultureInfo.InvariantCulture), "--agent-type", "workstation", "--auth", installerToken])
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        install.Environment["EYES_DATA_DIR"] = dataDir;
        using (var p = Process.Start(install)!)
        {
            var stdout = await p.StandardOutput.ReadToEndAsync();
            var stderr = await p.StandardError.ReadToEndAsync();
            await p.WaitForExitAsync();
            if (p.ExitCode != 0)
            {
                throw new InvalidOperationException($"eyes install falhou ({p.ExitCode}): {stdout} {stderr}");
            }
        }

        var run = new ProcessStartInfo(binary, ["run"]) { RedirectStandardOutput = true, RedirectStandardError = true };
        run.Environment["EYES_DATA_DIR"] = dataDir;
        run.Environment["EYES_TRAY_SOCKET"] = traySocket;
        var process = Process.Start(run)!;
        var eyes = new EyesProcess(process, dataDir, traySocket);
        process.ErrorDataReceived += (_, e) => eyes.Append(e.Data);
        process.OutputDataReceived += (_, e) => eyes.Append(e.Data);
        process.BeginErrorReadLine();
        process.BeginOutputReadLine();
        return eyes;
    }

    private void Append(string? line)
    {
        if (line is null)
        {
            return;
        }
        lock (log)
        {
            log.AppendLine(line);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
        }
        process.Dispose();
        try
        {
            Directory.Delete(DataDir, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
