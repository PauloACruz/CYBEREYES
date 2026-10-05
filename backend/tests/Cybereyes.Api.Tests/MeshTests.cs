using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Mesh;

namespace Cybereyes.Api.Tests;

public sealed class MeshTokenTests
{
    [Fact]
    public void LoginToken_RoundTrips_WithMeshCentralLayout()
    {
        var key = RandomNumberGenerator.GetBytes(80);
        var time = new FixedTime(DateTimeOffset.FromUnixTimeSeconds(1_790_000_000));

        var token = MeshTokens.Encode(key, new { a = 3, u = "user//ce-tecnico" }, time);

        Assert.DoesNotContain('+', token);
        Assert.DoesNotContain('/', token);
        using var json = JsonDocument.Parse(MeshTokens.Decode(key, token)!);
        Assert.Equal(3, json.RootElement.GetProperty("a").GetInt32());
        Assert.Equal("user//ce-tecnico", json.RootElement.GetProperty("u").GetString());
        Assert.Equal(1_790_000_000, json.RootElement.GetProperty("time").GetInt64());
    }

    [Fact]
    public void NodeId_ConvertsAgentHexToMeshFormat()
    {
        var hex = Convert.ToHexString(Enumerable.Range(0, 48).Select(i => (byte)(i * 5 + 250)).ToArray());

        var node = MeshTokens.NodeId(hex);

        Assert.StartsWith("node//", node, StringComparison.Ordinal);
        Assert.DoesNotContain('+', node[6..]);
        Assert.DoesNotContain('/', node[6..]);
        Assert.Equal(Convert.FromHexString(hex), Convert.FromBase64String(node[6..].Replace('@', '+').Replace('$', '/')));
    }

    [Fact]
    public void MeshUsername_IsPrefixedAndSanitized() =>
        Assert.Equal("ce-joao.silva", MeshTokens.MeshUsername("Joao.Silva@!"));

    [Theory]
    [InlineData("windows", "amd64", "https://mesh.x/meshagents?id=4&meshid=G$1@&installflags=0")]
    [InlineData("linux", "arm64", "https://mesh.x/meshagents?id=G$1@&installflags=2&meshinstall=26")]
    [InlineData("darwin", "arm64", "https://mesh.x/meshagents?id=G$1@&installflags=2&meshinstall=10005")]
    public void AgentDownloadUrl_UsesMeshCentralIdents(string plat, string goarch, string expected) =>
        Assert.Equal(expected, MeshEndpoints.AgentDownloadUrl("https://mesh.x", "G$1@", plat, goarch));

    [Fact]
    public async Task LinuxScript_WithMesh_KeepsGroupIdLiteral()
    {
        var script = InstallScripts.Linux("https://rmm.x", null, "https://mesh.x", "ab$HOME@cd");

        Assert.Contains("MESH_URL='https://mesh.x/meshagents?id=ab$HOME@cd&installflags=2&meshinstall='", script, StringComparison.Ordinal);
        var path = Path.GetTempFileName();
        await File.WriteAllTextAsync(path, script);
        using (var syntax = Process.Start("bash", ["-n", path]))
        {
            await syntax.WaitForExitAsync();
            Assert.Equal(0, syntax.ExitCode);
        }
        var start = new ProcessStartInfo("bash", ["-c", $"eval \"$(grep '^MESH_URL=' '{path}')\"; printf '%s' \"$MESH_URL\""]) { RedirectStandardOutput = true };
        using var process = Process.Start(start)!;
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        File.Delete(path);
        Assert.Equal("https://mesh.x/meshagents?id=ab$HOME@cd&installflags=2&meshinstall=", output);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}

[Collection(ApiCollection.Name)]
public sealed class MeshEndpointTests(ApiFixture fixture)
{
    [Fact]
    public async Task RemoteAccess_WithoutMeshCentral_Returns503AndStatusShowsDisabled()
    {
        var admin = await fixture.AdminClientAsync();

        var response = await admin.GetAsync("/api/agents/1/remote");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("MESH_DISABLED", problem.GetProperty("code").GetString());

        var status = await admin.GetFromJsonAsync<JsonElement>("/api/mesh/status");
        Assert.False(status.GetProperty("enabled").GetBoolean());
    }
}
