using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task ListAgents_ShowsHealthScoreAndSortsByIt()
    {
        var (admin, pk, _, _, clientId, siteId) = await RegisteredAgentAsync("Cliente saude");
        var installer = await InstallerTokenAsync(admin, siteId);
        var (_, semNota, _) = await RegisterAgentAsync(installer, siteId, "sem-nota");
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            db.AgentHealth.Add(new AgentHealth { AgentId = pk, Score = 72, Grade = "bom", Report = "{}", CollectedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        var page = await admin.GetFromJsonAsync<JsonElement>($"/api/agents?clientId={clientId}&sortBy=health&sortDir=desc");
        var items = page.GetProperty("items").EnumerateArray().ToList();
        var comNota = items.Single(i => i.GetProperty("id").GetInt32() == pk);
        Assert.Equal(72, comNota.GetProperty("healthScore").GetInt32());
        Assert.Equal("bom", comNota.GetProperty("healthGrade").GetString());
        var vazio = items.Single(i => i.GetProperty("id").GetInt32() == semNota);
        Assert.Equal(JsonValueKind.Null, vazio.GetProperty("healthScore").ValueKind);
    }

    [Fact]
    public async Task DashboardOverview_CountsAgentsTicketsAndChecksPerDay()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente painel");
        var tecnico = Guid.Empty;
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            tecnico = (await db.Users.FirstAsync(u => u.UserName == ApiFixture.AdminUsername)).Id;
            var check = new Check { AgentId = pk, CheckType = "ping", Name = "Ping do painel" };
            db.Checks.Add(check);
            await db.SaveChangesAsync();
            var now = DateTimeOffset.UtcNow;
            db.CheckHistory.AddRange(
                new CheckHistory { CheckId = check.Id, AgentId = pk, Time = now, Status = CheckStatus.Passing },
                new CheckHistory { CheckId = check.Id, AgentId = pk, Time = now, Status = CheckStatus.Passing },
                new CheckHistory { CheckId = check.Id, AgentId = pk, Time = now, Status = CheckStatus.Failing },
                new CheckHistory { CheckId = check.Id, AgentId = pk, Time = now.AddDays(-40), Status = CheckStatus.Failing });
            var queue = await db.TicketQueues.FirstAsync();
            db.Tickets.AddRange(
                new Ticket { Title = "Sem tecnico", RequesterName = "Ana", QueueId = queue.Id, ClientId = clientId, CreatedAt = now },
                new Ticket { Title = "Do tecnico", RequesterName = "Ana", QueueId = queue.Id, ClientId = clientId, AssignedToId = tecnico, CreatedAt = now },
                new Ticket
                {
                    Title = "Resolvido", RequesterName = "Ana", QueueId = queue.Id, ClientId = clientId, AssignedToId = tecnico,
                    Status = TicketStatus.Resolved, CreatedAt = now.AddDays(-2), ResolvedAt = now,
                });
            await db.SaveChangesAsync();
        }

        var overview = await admin.GetFromJsonAsync<JsonElement>($"/api/dashboard/overview?clientId={clientId}&days=7");
        var agents = overview.GetProperty("agents");
        Assert.Equal(1, agents.GetProperty("total").GetInt32());
        Assert.Single(agents.GetProperty("byClient").EnumerateArray());
        var checks = overview.GetProperty("checks");
        Assert.Equal(3, checks.GetProperty("total").GetInt32());
        Assert.Equal(1, checks.GetProperty("failing").GetInt32());
        Assert.Equal(7, checks.GetProperty("days").GetArrayLength());
        var tickets = overview.GetProperty("tickets");
        Assert.Equal(2, tickets.GetProperty("open").GetInt32());
        Assert.Equal(1, tickets.GetProperty("unassigned").GetInt32());
        Assert.Equal(3, tickets.GetProperty("openedInPeriod").GetInt32());
        Assert.Equal(1, tickets.GetProperty("resolvedInPeriod").GetInt32());

        var doTecnico = await admin.GetFromJsonAsync<JsonElement>($"/api/dashboard/overview?clientId={clientId}&technicianId={tecnico}&days=7");
        Assert.Equal(1, doTecnico.GetProperty("tickets").GetProperty("open").GetInt32());
        Assert.Equal(2, doTecnico.GetProperty("tickets").GetProperty("openedInPeriod").GetInt32());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/dashboard/overview?days=5")).StatusCode);
    }
}
