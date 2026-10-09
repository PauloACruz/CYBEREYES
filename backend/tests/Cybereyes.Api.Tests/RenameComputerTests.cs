using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cybereyes.Api.Rmm.Nats;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task RenameComputer_RunsTheEmbeddedScript_WithoutLeakingTheDomainPassword()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente renomear", "windows", r => r.GetString("func") == "runscriptfull"
            ? new Dictionary<string, object?>
            {
                ["stdout"] = "[OK] Renomeado: host-windows -> PC-FIN-012 (vale depois do reinicio).\r\nRESULTADO: OK - host-windows -> PC-FIN-012 (renomeado); reinicio agendado em 300 s\r\n",
                ["stderr"] = "", ["retcode"] = 0, ["execution_time"] = 4.2, ["id"] = 0,
            }
            : null);
        await using var _ = agent;

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/rename", new { newName = "-PC" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/rename", new { newName = "12345" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/rename", new { newName = "PC-FIN", domainUser = "EMPRESA\\ti" })).StatusCode);

        var response = await admin.PostAsJsonAsync($"/api/agents/{pk}/rename", new
        {
            newName = " PC-FIN-012 ", restart = true, domainUser = "EMPRESA\\ti", domainPassword = "senha-do-dominio",
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("retcode").GetInt32());
        Assert.Equal("OK - host-windows -> PC-FIN-012 (renomeado); reinicio agendado em 300 s", body.GetProperty("result").GetString());

        var sent = Assert.Single(agent.Received, r => r.GetString("func") == "runscriptfull");
        Assert.Equal(["-NovoNome", "PC-FIN-012", "-Confirmar", "-Reiniciar"], ((IEnumerable<object?>)sent["script_args"]!).Cast<string>());
        Assert.Equal(["MANUTENCAOTI_DOMINIO_USUARIO=EMPRESA\\ti", "MANUTENCAOTI_DOMINIO_SENHA=senha-do-dominio"],
            ((IEnumerable<object?>)sent["env_vars"]!).Cast<string>());
        var payload = (IReadOnlyDictionary<string, object?>)sent["payload"]!;
        Assert.Equal("powershell", payload.GetString("shell"));
        Assert.Contains("Rename-Computer @parametros", payload.GetString("code"), StringComparison.Ordinal);

        // A senha nao fica no historico do agente nem na auditoria.
        var history = await admin.GetStringAsync($"/api/agents/{pk}/history");
        Assert.Contains("Renomear computador", history, StringComparison.Ordinal);
        Assert.DoesNotContain("senha-do-dominio", history, StringComparison.Ordinal);
        Assert.DoesNotContain("senha-do-dominio", await admin.GetStringAsync("/api/audit?pageSize=200"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RenameComputer_IsWindowsOnly()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente renomear linux", "linux", _ => null);
        await using var _ = agent;
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/agents/{pk}/rename", new { newName = "SRV-01" })).StatusCode);
        Assert.Empty(agent.Received);
    }
}
