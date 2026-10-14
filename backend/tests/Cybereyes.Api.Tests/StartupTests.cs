using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private const string UserSid = "S-1-5-21-1004336348-1177238915-682003330-1001";

    /// <summary>Saida do win-conf-inicializacao.ps1: a lista em JSON (base64) e a linha RESULTADO.</summary>
    private static Dictionary<string, object?> StartupReply(bool discordEnabled, int retcode = 0, string? result = null)
    {
        var json = JsonSerializer.Serialize(new
        {
            items = new object[]
            {
                new
                {
                    scope = UserSid, location = "Run", name = "Discord", user = @"EMPRESA\maria", command = "\"C:\\Users\\maria\\AppData\\Local\\Discord\\Update.exe\" --processStart Discord.exe",
                    file = @"C:\Users\maria\AppData\Local\Discord\Update.exe", description = "Discord", publisher = "Discord Inc.", enabled = discordEnabled,
                    disabledAt = discordEnabled ? null : "2026-10-14T18:00:00.0000000Z",
                },
                new
                {
                    scope = "HKLM", location = "Run", name = "Atualizador Ação", user = (string?)null, command = @"C:\Programas\atualiza.exe /silencioso",
                    file = @"C:\Programas\atualiza.exe", description = (string?)null, publisher = (string?)null, enabled = true, disabledAt = (string?)null,
                },
            },
            users = new[] { @"EMPRESA\maria" },
        });
        var stdout = retcode == 0
            ? $"JSONB64:{Convert.ToBase64String(Encoding.UTF8.GetBytes(json))}\r\nRESULTADO: {result ?? "OK - lista da inicialização"}\r\n"
            : $"RESULTADO: {result}\r\n";
        return new Dictionary<string, object?> { ["stdout"] = stdout, ["stderr"] = "", ["retcode"] = retcode, ["execution_time"] = 1.5, ["id"] = 0 };
    }

    [Fact]
    public async Task Startup_ListsAndTogglesThroughTheEmbeddedScript()
    {
        var discordEnabled = true;
        var (admin, pk, agent) = await FakeAgentAsync("Cliente inicializacao", "windows", r =>
        {
            if (r.GetString("func") != "runscriptfull")
            {
                return null;
            }
            var env = ((IEnumerable<object?>)r["env_vars"]!).Cast<string>().ToList();
            if (env.Contains("CYBEREYES_INICIO_LOCAL=StartupFolder"))
            {
                return StartupReply(discordEnabled, 3, "ERRO - entrada não encontrada na inicialização");
            }
            if (env.Contains("CYBEREYES_INICIO_ACAO=desabilitar"))
            {
                discordEnabled = false;
            }
            return StartupReply(discordEnabled);
        });
        await using var _ = agent;

        var list = await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/startup");
        var items = list.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["Atualizador Ação", "Discord"], items.Select(i => i.GetProperty("name").GetString()));
        Assert.Equal("Discord Inc.", items[1].GetProperty("publisher").GetString());
        Assert.True(items[1].GetProperty("enabled").GetBoolean());
        Assert.Equal(@"EMPRESA\maria", Assert.Single(list.GetProperty("users").EnumerateArray()).GetString());
        var listing = Assert.Single(agent.Received, r => r.GetString("func") == "runscriptfull");
        Assert.Empty(((IEnumerable<object?>)listing["env_vars"]!).Cast<string>());
        Assert.Equal("powershell", ((IReadOnlyDictionary<string, object?>)listing["payload"]!).GetString("shell"));
        Assert.Contains("StartupApproved", ((IReadOnlyDictionary<string, object?>)listing["payload"]!).GetString("code"), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync($"/api/agents/{pk}/startup", new { scope = "HKCU", location = "Run", name = "Discord", enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync($"/api/agents/{pk}/startup", new { scope = UserSid, location = "Run32", name = "Discord", enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync($"/api/agents/{pk}/startup", new { scope = "HKLM", location = "Servicos", name = "x", enabled = false })).StatusCode);

        var changed = await admin.PutAsJsonAsync($"/api/agents/{pk}/startup", new { scope = UserSid, location = "Run", name = "Discord", enabled = false });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var discord = (await changed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("name").GetString() == "Discord");
        Assert.False(discord.GetProperty("enabled").GetBoolean());
        Assert.Equal(DateTimeOffset.Parse("2026-10-14T18:00:00Z", System.Globalization.CultureInfo.InvariantCulture), discord.GetProperty("disabledAt").GetDateTimeOffset());

        var sent = agent.Received.Where(r => r.GetString("func") == "runscriptfull").Last();
        Assert.Equal(
            ["CYBEREYES_INICIO_ACAO=desabilitar", $"CYBEREYES_INICIO_ESCOPO={UserSid}", "CYBEREYES_INICIO_LOCAL=Run",
                $"CYBEREYES_INICIO_NOME_B64={Convert.ToBase64String("Discord"u8)}"],
            ((IEnumerable<object?>)sent["env_vars"]!).Cast<string>());

        var refused = await admin.PutAsJsonAsync($"/api/agents/{pk}/startup", new { scope = "HKLM", location = "StartupFolder", name = "sumiu.lnk", enabled = true });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("ERRO - entrada não encontrada na inicialização", (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());

        // A alteracao fica no historico, na auditoria e nos procedimentos; a listagem nao.
        var history = await admin.GetStringAsync($"/api/agents/{pk}/history");
        Assert.Contains("desabilitar Run Discord (usuario)", history, StringComparison.Ordinal);
        Assert.Contains("Discord desabilitado na inicializacao", await admin.GetStringAsync("/api/audit?pageSize=200"), StringComparison.Ordinal);
        var procedures = await admin.GetFromJsonAsync<JsonElement>($"/api/procedures?agentId={pk}&kind=startup");
        var titles = procedures.GetProperty("items").EnumerateArray().Select(p => (p.GetProperty("title").GetString(), p.GetProperty("status").GetString())).ToList();
        Assert.Contains(("Discord desabilitado", "ok"), titles);
        Assert.Contains(("sumiu.lnk habilitado", "error"), titles);
    }

    [Fact]
    public async Task Startup_IsWindowsOnly()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente inicializacao linux", "linux", _ => null);
        await using var _ = agent;
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/agents/{pk}/startup")).StatusCode);
        Assert.Empty(agent.Received);
    }
}
