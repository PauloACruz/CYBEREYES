using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Cybereyes.Api.Rmm;

namespace Cybereyes.Api.Tests;

/// <summary>Pula o teste sem o PowerShell (pwsh) no PATH; os runners Linux do GitHub trazem o pwsh.</summary>
public sealed class PwshFactAttribute : FactAttribute
{
    public PwshFactAttribute()
    {
        if (InstallScriptsTests.Pwsh is null)
        {
            Skip = "pwsh indisponivel";
        }
    }
}

public sealed partial class InstallScriptsTests
{
    private static readonly InstallParameters Params = new("https://rmm.x", 1, 2, "abc", "server");

    internal static string? Pwsh { get; } = FindPwsh();

    private static string? FindPwsh()
    {
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator))
        {
            foreach (var name in new[] { "pwsh", "pwsh.exe" })
            {
                var path = Path.Combine(dir, name);
                if (File.Exists(path))
                {
                    return path;
                }
            }
        }
        return null;
    }

    [GeneratedRegex("'-EncodedCommand', '([A-Za-z0-9+/=]+)'")]
    private static partial Regex Encoded();

    private static string Inner(string script) =>
        Encoding.Unicode.GetString(Convert.FromBase64String(Encoded().Match(script).Groups[1].Value));

    [Fact]
    public void WindowsScript_WithoutAdmin_RelaunchesElevatedWithSameInstall()
    {
        var script = InstallScripts.Windows(Params);

        Assert.Contains("IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)", script, StringComparison.Ordinal);
        Assert.Contains("-Verb RunAs", script, StringComparison.Ordinal);
        var inner = Inner(script);
        Assert.Contains("install --api https://rmm.x --client-id 1 --site-id 2 --agent-type server --auth abc", inner, StringComparison.Ordinal);
        Assert.Contains("EYES instalado", inner, StringComparison.Ordinal);
        // Como administrador, a instalacao roda direto na mesma janela.
        Assert.Contains("install --api https://rmm.x --client-id 1 --site-id 2 --agent-type server --auth abc", script, StringComparison.Ordinal);
    }

    /// <summary>O script e a instalacao elevada passam no analisador do PowerShell (sem erro de sintaxe).</summary>
    [PwshFact]
    public void WindowsScript_ParsesInPowerShell()
    {
        var script = InstallScripts.Windows(Params);
        var dir = Directory.CreateTempSubdirectory("eyes-ps");
        try
        {
            var outer = Path.Combine(dir.FullName, "outer.ps1");
            var inner = Path.Combine(dir.FullName, "inner.ps1");
            File.WriteAllText(outer, script);
            File.WriteAllText(inner, Inner(script));
            var check = """
                $failed = 0
                foreach ($f in $args) {
                    $tokens = $null; $errors = $null
                    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
                    foreach ($e in $errors) { Write-Output "$f`: $($e.Message)"; $failed++ }
                }
                exit $failed
                """;
            var psi = new ProcessStartInfo(Pwsh!) { RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-Command", check, outer, inner })
            {
                psi.ArgumentList.Add(a);
            }
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            p.WaitForExit();
            Assert.True(p.ExitCode == 0, output);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }
}
