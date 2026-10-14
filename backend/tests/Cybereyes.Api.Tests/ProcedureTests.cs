using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Persistence.Migrations;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static async Task<List<JsonElement>> ProceduresAsync(HttpClient admin, string query)
    {
        var page = await admin.GetFromJsonAsync<JsonElement>($"/api/procedures?{query}");
        return page.GetProperty("items").EnumerateArray().ToList();
    }

    private async Task<int> TicketForAgentAsync(HttpClient admin, int pk, string title)
    {
        var created = await admin.PostAsJsonAsync("/api/tickets", new { title, agentId = pk });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Procedures_RecordCommandsAndScripts_WithUserStatusAndDuration()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente procedimentos", "linux", r => r.GetString("func") switch
        {
            "rawcmd" => "ok",
            "runscriptfull" => new Dictionary<string, object?> { ["stdout"] = "", ["stderr"] = "falhou", ["retcode"] = 2, ["execution_time"] = 0.4, ["id"] = 0 },
            _ => null,
        });
        await using var _ = agent;

        await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "df -h\nuptime", timeout = 30, runAsUser = false });
        var created = await admin.PostAsJsonAsync("/api/scripts", new
        {
            name = "Script que falha", shell = "shell", body = "exit 2", defaultArgs = Array.Empty<string>(), defaultTimeout = 60, platforms = new[] { "linux" },
        });
        var script = await created.Content.ReadFromJsonAsync<IdOnly>();
        await admin.PostAsJsonAsync($"/api/agents/{pk}/runscript", new { scriptId = script!.Id });

        var page = await admin.GetFromJsonAsync<JsonElement>($"/api/procedures?agentId={pk}");
        var items = page.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(2, page.GetProperty("total").GetInt32());
        var command = items.Single(i => i.GetProperty("kind").GetString() == ProcedureKind.Command);
        Assert.Equal("df -h uptime", command.GetProperty("title").GetString());
        Assert.Equal("/bin/bash", command.GetProperty("detail").GetString());
        Assert.Equal(ProcedureStatus.Ok, command.GetProperty("status").GetString());
        Assert.Equal("Administrador", command.GetProperty("userName").GetString());
        Assert.Equal("host-linux", command.GetProperty("hostname").GetString());
        Assert.True(command.GetProperty("durationSeconds").GetInt32() >= 0);
        Assert.Equal(JsonValueKind.Null, command.GetProperty("ticketId").ValueKind);
        var scriptRun = items.Single(i => i.GetProperty("kind").GetString() == ProcedureKind.Script);
        Assert.Equal("Script que falha", scriptRun.GetProperty("title").GetString());
        Assert.Equal(ProcedureStatus.Error, scriptRun.GetProperty("status").GetString());

        var totals = page.GetProperty("totals");
        Assert.Equal(2, totals.GetProperty("count").GetInt32());
        Assert.Equal(2, totals.GetProperty("unlinked").GetInt32());
        Assert.Single(await ProceduresAsync(admin, $"agentId={pk}&kind=command"));
        Assert.Single(await ProceduresAsync(admin, $"agentId={pk}&status=error"));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        Assert.Empty(await ProceduresAsync(admin, $"agentId={pk}&from={today.AddDays(-10):yyyy-MM-dd}&to={today.AddDays(-5):yyyy-MM-dd}"));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/procedures?kind=nada")).StatusCode);

        var overview = await admin.GetFromJsonAsync<JsonElement>($"/api/dashboard/overview?clientId={command.GetProperty("clientId").GetInt32()}&days=7");
        var procedures = overview.GetProperty("procedures");
        Assert.Equal(2, procedures.GetProperty("total").GetInt32());
        Assert.Equal(2, procedures.GetProperty("unlinked").GetInt32());
        Assert.Equal(7, procedures.GetProperty("days").GetArrayLength());
        Assert.Contains(procedures.GetProperty("byKind").EnumerateArray(), k => k.GetProperty("kind").GetString() == ProcedureKind.Command);
        Assert.Equal("Administrador", procedures.GetProperty("byUser")[0].GetProperty("userName").GetString());
    }

    [Fact]
    public async Task Procedures_IncludedInTicket_CountAsServiceTime_AndCanBeRemoved()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente procedimento no chamado", "linux", r => r.GetString("func") == "rawcmd" ? "ok" : null);
        await using var _ = agent;
        await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "uptime", timeout = 30, runAsUser = false });
        var procedureId = (await ProceduresAsync(admin, $"agentId={pk}")).Single().GetProperty("id").GetInt64();
        var ticketId = await TicketForAgentAsync(admin, pk, "Lentidao na maquina");

        var included = await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/procedures", new { items = new[] { new { procedureId, minutes = 15 } } });
        Assert.Equal(HttpStatusCode.OK, included.StatusCode);
        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal(15, detail.GetProperty("totalMinutes").GetInt32());
        var entry = (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}/time")).EnumerateArray().Single();
        Assert.Equal(procedureId, entry.GetProperty("procedureId").GetInt64());
        Assert.Equal("Comando em host-linux: uptime", entry.GetProperty("description").GetString());
        var linked = (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}/procedures")).EnumerateArray().Single();
        Assert.Equal(15, linked.GetProperty("serviceMinutes").GetInt32());
        Assert.Equal("Lentidao na maquina", linked.GetProperty("ticketTitle").GetString());
        Assert.Empty(await ProceduresAsync(admin, $"agentId={pk}&linked=false"));

        var again = await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/procedures", new { items = new[] { new { procedureId, minutes = 5 } } });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);

        // Apagar o apontamento devolve o procedimento para "sem chamado".
        var removed = await admin.DeleteAsync($"/api/tickets/{ticketId}/time/{entry.GetProperty("id").GetInt64()}");
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.Single(await ProceduresAsync(admin, $"agentId={pk}&linked=false"));

        await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/procedures", new { items = new[] { new { procedureId, minutes = (int?)null } } });
        detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal(1, detail.GetProperty("totalMinutes").GetInt32());
        var unlinked = await admin.DeleteAsync($"/api/tickets/{ticketId}/procedures/{procedureId}");
        Assert.Equal(HttpStatusCode.NoContent, unlinked.StatusCode);
        detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal(0, detail.GetProperty("totalMinutes").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/tickets/{ticketId}/procedures/{procedureId}")).StatusCode);

        // Em andamento nao entra; de outro cliente tambem nao.
        var (_, otherPk, otherAgent) = await FakeAgentAsync("Outro cliente do procedimento", "linux", _ => null);
        await using var __ = otherAgent;
        var otherTicket = await TicketForAgentAsync(admin, otherPk, "Chamado de outro cliente");
        var foreign = await admin.PostAsJsonAsync($"/api/tickets/{otherTicket}/procedures", new { items = new[] { new { procedureId, minutes = 5 } } });
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        long runningId;
        using (var scope = fixture.Services.CreateScope())
        {
            var log = scope.ServiceProvider.GetRequiredService<ProcedureLog>();
            var running = await log.StartAsync(pk, ProcedureKind.Terminal, "/bin/bash", actor: new ProcedureActor(null, "admin", ProcedureSource.Console));
            runningId = running!.Id;
        }
        var busy = await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/procedures", new { items = new[] { new { procedureId = runningId, minutes = 5 } } });
        Assert.Equal(HttpStatusCode.BadRequest, busy.StatusCode);
    }

    [Fact]
    public async Task Procedures_RegisteredAsTicket_CreateResolvedTicketWithTheirTime()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente chamado de procedimentos", "linux", r => r.GetString("func") == "rawcmd" ? "ok" : null);
        await using var _ = agent;
        await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "uptime", timeout = 30, runAsUser = false });
        await admin.PostAsJsonAsync($"/api/agents/{pk}/command", new { shell = "/bin/bash", command = "df -h", timeout = 30, runAsUser = false });
        var ids = (await ProceduresAsync(admin, $"agentId={pk}")).Select(i => i.GetProperty("id").GetInt64()).ToArray();

        var created = await admin.PostAsJsonAsync("/api/procedures/ticket", new { procedureIds = ids, title = "Atendimento remoto sem chamado", resolve = true });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var ticketId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal(TicketStatus.Resolved, detail.GetProperty("status").GetString());
        Assert.Equal(pk, detail.GetProperty("agentId").GetInt32());
        Assert.Equal("Administrador", detail.GetProperty("assignedToName").GetString());
        Assert.Equal(2, detail.GetProperty("totalMinutes").GetInt32());
        Assert.Equal(2, (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}/procedures")).GetArrayLength());

        var again = await admin.PostAsJsonAsync("/api/procedures/ticket", new { procedureIds = ids, title = "De novo", resolve = false });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Procedure_StartedFromTicket_EntersTicketTimeWhenFinished()
    {
        var (admin, pk, agent) = await FakeAgentAsync("Cliente procedimento do chamado", "linux", _ => null);
        await using var _ = agent;
        var ticketId = await TicketForAgentAsync(admin, pk, "Acesso pelo chamado");
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            var adminId = (await db.Users.FirstAsync(u => u.UserName == ApiFixture.AdminUsername)).Id;
            var log = scope.ServiceProvider.GetRequiredService<ProcedureLog>();
            var procedure = await log.StartAsync(pk, ProcedureKind.Remote, "Tela", ticketId: ticketId, refType: ProcedureRef.RemoteSession, refId: "sessao-teste",
                actor: new ProcedureActor(adminId, "Administrador", ProcedureSource.Console));
            procedure!.StartedAt = procedure.StartedAt.AddMinutes(-7).AddSeconds(-10);
            await db.SaveChangesAsync();
            await log.FinishByRefAsync(ProcedureRef.RemoteSession, "sessao-teste", ProcedureStatus.Ok);
        }

        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
        Assert.Equal(8, detail.GetProperty("totalMinutes").GetInt32());
        var linked = (await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}/procedures")).EnumerateArray().Single();
        Assert.Equal(ProcedureKind.Remote, linked.GetProperty("kind").GetString());
        Assert.True(linked.GetProperty("durationSeconds").GetInt32() >= 430);
    }

    [Fact]
    public async Task ProcedureBackfill_ImportsRemoteCareHistoryAndAudit()
    {
        var (_, pk, agentId, _, agent) = await CareAgentAsync("Cliente carga de procedimentos", _ => null);
        await using var _ = agent;
        var sql = new Fase15Procedimentos().UpOperations.OfType<SqlOperation>().Single().Sql;

        await using var scope = fixture.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var admin = await db.Users.FirstAsync(u => u.UserName == ApiFixture.AdminUsername);
        var now = DateTimeOffset.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync();
        db.RemoteSessions.Add(new RemoteSession
        {
            SessionId = "carga-sessao", AgentId = pk, UserId = admin.Id, Username = "admin", Channels = "desktop,files", ConsentMode = "none",
            State = RemoteSessionState.Ended, StartedAt = now.AddMinutes(-20), FirstFrameAt = now.AddMinutes(-19), EndedAt = now.AddMinutes(-5),
        });
        db.CareRuns.Add(new CareRun
        {
            RunId = "wc-carga", AgentId = pk, Module = "maintenance", Tasks = ["temp_files", "dns_flush"], Params = "{}", Status = CareRunStatus.Warning,
            StartedAt = now.AddMinutes(-30), FinishedAt = now.AddMinutes(-28), RequestedBy = "tray:maria", Source = "tray",
        });
        db.AgentHistory.Add(new AgentHistory
        {
            AgentId = pk, Type = AgentHistoryType.ScriptRun, Command = "-x", Username = "admin", ScriptName = "Limpeza",
            ScriptResults = """{"Stdout":"","Stderr":"","Retcode":0,"ExecutionTime":42.4}""", Time = now.AddHours(-1),
        });
        db.AuditLogs.Add(new Cybereyes.Core.Audit.AuditLog
        {
            Action = "agent.rebootnow", ObjectType = "agent", ObjectId = pk.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Message = "reiniciou ce-host", Username = "admin", Timestamp = now.AddHours(-2),
        });
        await db.SaveChangesAsync();
        await db.AgentProcedures.IgnoreQueryFilters().Where(p => p.AgentId == pk).ExecuteDeleteAsync();

        await db.Database.ExecuteSqlRawAsync(sql);
        var rows = await db.AgentProcedures.AsNoTracking().IgnoreQueryFilters().Where(p => p.AgentId == pk).ToListAsync();
        await tx.RollbackAsync();

        var remote = rows.Single(p => p.Kind == ProcedureKind.Remote);
        Assert.Equal("Tela e arquivos", remote.Title);
        Assert.Equal(ProcedureStatus.Ok, remote.Status);
        Assert.Equal(900, remote.DurationSeconds);
        Assert.Equal("Administrador", remote.UserName);
        Assert.Null(remote.TicketId);
        var care = rows.Single(p => p.Kind == ProcedureKind.Care);
        Assert.Equal("Manutenção do sistema (2 tarefas)", care.Title);
        Assert.Equal(ProcedureStatus.Warning, care.Status);
        Assert.Equal(ProcedureSource.Tray, care.Source);
        Assert.Equal("maria", care.UserName);
        Assert.Null(care.UserId);
        var script = rows.Single(p => p.Kind == ProcedureKind.Script);
        Assert.Equal("Limpeza", script.Title);
        Assert.Equal(42, script.DurationSeconds);
        Assert.Equal(admin.Id, script.UserId);
        var reboot = rows.Single(p => p.Kind == ProcedureKind.Reboot);
        Assert.Equal("reiniciou ce-host", reboot.Title);
        Assert.Equal(4, rows.Count);
        Assert.False(string.IsNullOrEmpty(agentId));
    }
}
