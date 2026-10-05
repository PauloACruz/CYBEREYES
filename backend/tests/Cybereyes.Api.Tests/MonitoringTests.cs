using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private async Task<(HttpClient Admin, int Pk, string AgentId, HttpClient Agent, int ClientId, int SiteId)> RegisteredAgentAsync(string client, string plat = "linux",
        string monitoringType = "server")
    {
        var (admin, clientId, siteId) = await NewSiteAsync(client);
        var installer = await InstallerTokenAsync(admin, siteId);
        var agentId = new string(Enumerable.Range(0, 40).Select(_ => (char)('a' + Random.Shared.Next(26))).ToArray());
        using var http = AgentClient(installer);
        var response = await http.PostAsJsonAsync("/api/v3/newagent/", new { agent_id = agentId, hostname = $"mon-{plat}", site = siteId, monitoring_type = monitoringType, plat });
        var body = await response.Content.ReadFromJsonAsync<NewAgentBody>();
        return (admin, body!.Pk, agentId, AgentClient(body.Token), clientId, siteId);
    }

    [Fact]
    public async Task DiskCheck_FailsRaisesAlertWithWebhook_AndResolves()
    {
        var (admin, pk, agentId, agent, clientId, _) = await RegisteredAgentAsync("Cliente disco");
        var template = await (await admin.PostAsJsonAsync("/api/alert-templates", new
        {
            name = "Template disco", webhookUrl = "https://hooks.exemplo.com/cybereyes", webhookSeverities = new[] { "error" }, emailSeverities = Array.Empty<string>(),
            dashboardSeverities = new[] { "error", "warning", "info" }, notifyOnResolved = true,
        })).Content.ReadFromJsonAsync<IdOnly>();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync("/api/alert-templates/assignments", new { target = "client", targetId = clientId, templateId = template!.Id })).StatusCode);

        var created = await admin.PostAsJsonAsync("/api/checks", new
        {
            agentId = pk, checkType = "diskspace", name = "Disco raiz", disk = "/", warningThreshold = 30, errorThreshold = 10, failsBeforeAlert = 1,
            alertSeverity = "warning", runInterval = 0, searchLastDays = 1, numberOfEventsBeforeAlert = 1, webhookAlert = true, dashboardAlert = true,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var checkId = (await created.Content.ReadFromJsonAsync<IdOnly>())!.Id;

        using (var due = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/checkrunner/")))
        {
            var check = due.RootElement.GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == checkId);
            Assert.Equal("diskspace", check.GetProperty("check_type").GetString());
            Assert.Equal("/", check.GetProperty("disk").GetString());
            Assert.Equal(10, check.GetProperty("error_threshold").GetInt32());
        }

        var fail = await agent.PatchAsJsonAsync("/api/v3/checkrunner/", new { id = checkId, agent_id = agentId, exists = true, percent_used = 95.4, more_info = "Total: 100 GB, Free: 5 GB" });
        Assert.Equal("\"ok\"", await fail.Content.ReadAsStringAsync());

        var alerts = await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}");
        var alert = Assert.Single(alerts!.Items);
        Assert.Equal("error", alert.Severity);
        Assert.True(alert.WebhookSent);
        Assert.Contains(fixture.Notifications.Webhooks, w => w.Url == "https://hooks.exemplo.com/cybereyes" && w.Payload.Contains("alert.created", StringComparison.Ordinal));

        using (var due = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/checkrunner/")))
        {
            Assert.DoesNotContain(due.RootElement.GetProperty("checks").EnumerateArray(), c => c.GetProperty("id").GetInt32() == checkId);
        }

        await agent.PatchAsJsonAsync("/api/v3/checkrunner/", new { id = checkId, agent_id = agentId, exists = true, percent_used = 40.0, more_info = "ok" });
        Assert.Empty((await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}"))!.Items);
        Assert.Contains(fixture.Notifications.Webhooks, w => w.Payload.Contains("alert.resolved", StringComparison.Ordinal));

        var history = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/checks/{checkId}/history?agentId={pk}");
        Assert.Equal(2, history!.Count);
    }

    [Fact]
    public async Task PolicyCheck_IsInheritedFromGlobal_UnlessBlocked()
    {
        var (admin, pk, agentId, agent, _, _) = await RegisteredAgentAsync("Cliente politica", monitoringType: "workstation");
        var policy = await (await admin.PostAsJsonAsync("/api/policies", new { name = "Estacoes padrao", enabled = true })).Content.ReadFromJsonAsync<IdOnly>();
        var check = await (await admin.PostAsJsonAsync("/api/checks", new
        {
            policyId = policy!.Id, checkType = "memory", warningThreshold = 80, errorThreshold = 95, failsBeforeAlert = 3, alertSeverity = "warning",
            runInterval = 0, searchLastDays = 1, numberOfEventsBeforeAlert = 1,
        })).Content.ReadFromJsonAsync<IdOnly>();
        await admin.PutAsJsonAsync("/api/policies/assignments", new { target = "global", monitoringType = "workstation", policyId = policy.Id });

        using (var due = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/runchecks/")))
        {
            Assert.Contains(due.RootElement.GetProperty("checks").EnumerateArray(), c => c.GetProperty("id").GetInt32() == check!.Id);
        }
        var effective = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/agents/{pk}/policies");
        Assert.Equal("global", Assert.Single(effective!).GetProperty("source").GetString());

        await admin.PutAsJsonAsync("/api/policies/block-inheritance", new { target = "agent", targetId = pk, block = true });
        using (var due = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{agentId}/runchecks/")))
        {
            Assert.DoesNotContain(due.RootElement.GetProperty("checks").EnumerateArray(), c => c.GetProperty("id").GetInt32() == check!.Id);
        }
        await admin.PutAsJsonAsync("/api/policies/assignments", new { target = "global", monitoringType = "workstation", policyId = (int?)null });
    }

    [Fact]
    public async Task Task_ServesActionsToAgent_AndFailingResultRaisesAlert()
    {
        var (admin, pk, agentId, agent, _, _) = await RegisteredAgentAsync("Cliente tarefa");
        var created = await admin.PostAsJsonAsync("/api/tasks", new
        {
            agentId = pk, name = "Limpeza", enabled = true, continueOnError = true, alertSeverity = "error", scheduleType = "daily", time = "03:00",
            actions = new[] { new { type = "cmd", command = "echo {{agent.hostname}}", shell = "/bin/bash", timeout = 30, runAsUser = false } },
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var taskId = (await created.Content.ReadFromJsonAsync<IdOnly>())!.Id;

        using (var task = JsonDocument.Parse(await agent.GetStringAsync($"/api/v3/{taskId}/{agentId}/taskrunner/")))
        {
            var action = task.RootElement.GetProperty("task_actions")[0];
            Assert.Equal("cmd", action.GetProperty("type").GetString());
            Assert.Equal("echo mon-linux", action.GetProperty("command").GetString());
        }

        await agent.PatchAsJsonAsync($"/api/v3/{taskId}/{agentId}/taskrunner/", new { stdout = "", stderr = "erro", retcode = 2, execution_time = 0.5 });
        var tasks = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/agents/{pk}/tasks");
        var result = Assert.Single(tasks!).GetProperty("result");
        Assert.Equal("failing", result.GetProperty("status").GetString());
        Assert.Contains((await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}"))!.Items, a => a.AlertType == "task");
        Assert.NotEqual(JsonValueKind.Null, Assert.Single(tasks!).GetProperty("nextRun").ValueKind);
    }

    [Fact]
    public async Task WindowsUpdates_AreStored_AndApprovedByPatchPolicy()
    {
        var (admin, pk, agentId, agent, _, _) = await RegisteredAgentAsync("Cliente patches", plat: "windows");
        var posted = await agent.PostAsJsonAsync("/api/v3/winupdates/", new
        {
            agent_id = agentId,
            wua_updates = new object[]
            {
                new { guid = "g-critica", title = "Atualizacao critica", severity = "Critical", kb_article_ids = new[] { "5001" }, installed = false, downloaded = false, categories = new[] { "Security Updates" } },
                new { guid = "g-baixa", title = "Atualizacao baixa", severity = "Low", kb_article_ids = new[] { "5002" }, installed = false, downloaded = false, categories = Array.Empty<string>() },
            },
        });
        Assert.Equal(HttpStatusCode.OK, posted.StatusCode);

        await admin.PutAsJsonAsync($"/api/agents/{pk}/patch-policy", new
        {
            critical = "approve", important = "manual", moderate = "manual", low = "ignore", other = "manual", runTimeDays = new[] { 0 }, runTimeHour = 3, rebootAfterInstall = "never",
        });
        await fixture.Services.GetRequiredService<PatchScheduler>().RunOnceAsync(new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero), CancellationToken.None);

        var updates = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/agents/{pk}/updates");
        Assert.Equal("approve", updates!.Single(u => u.GetProperty("kb").GetString() == "KB5001").GetProperty("action").GetString());
        Assert.Equal("ignore", updates!.Single(u => u.GetProperty("kb").GetString() == "KB5002").GetProperty("action").GetString());

        await agent.PatchAsJsonAsync("/api/v3/winupdates/", new { agent_id = agentId, guid = "g-critica", success = true });
        updates = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/agents/{pk}/updates");
        Assert.True(updates!.Single(u => u.GetProperty("kb").GetString() == "KB5001").GetProperty("installed").GetBoolean());
    }

    [Fact]
    public async Task OverdueAgent_RaisesAvailabilityAlert_AndCheckinResolvesIt()
    {
        var (admin, pk, agentId, agent, _, _) = await RegisteredAgentAsync("Cliente disponibilidade");
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Cybereyes.Core.Persistence.CybereyesDbContext>();
            var old = DateTimeOffset.UtcNow.AddHours(-2);
            var row = db.Agents.Single(a => a.Id == pk);
            row.LastSeen = old;
            await db.SaveChangesAsync();
        }
        await fixture.Services.GetRequiredService<Cybereyes.Api.Rmm.Nats.AgentStatusMonitor>().RunOnceAsync(CancellationToken.None);

        var alert = Assert.Single((await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}"))!.Items);
        Assert.Equal("availability", alert.AlertType);

        await using var nats = await ConnectAsAgentAsync(agentId, (await AgentTokenOf(agent)));
        await nats.PublishAsync(agentId, Cybereyes.Api.Rmm.Nats.MsgPack.Serialize(new Dictionary<string, object?> { ["agent_id"] = agentId, ["version"] = "2.11.0" }),
            serializer: NATS.Client.Core.NatsRawSerializer<byte[]>.Default, replyTo: "agent-hello");
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline && (await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}"))!.Items.Count > 0)
        {
            await Task.Delay(300);
        }
        Assert.Empty((await admin.GetFromJsonAsync<AlertPage>($"/api/alerts?agentId={pk}"))!.Items);
    }

    private static Task<string> AgentTokenOf(HttpClient agent) => Task.FromResult(agent.DefaultRequestHeaders.Authorization!.Parameter!);

    private sealed record AlertItem(long Id, string AlertType, string Severity, bool WebhookSent, bool Resolved);
    private sealed record AlertPage(List<AlertItem> Items, int Total);
}

public sealed class CheckEvaluatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    [Fact]
    public void CpuCheck_UsesAverageOfLastReadings()
    {
        var check = new Check { CheckType = CheckTypes.CpuLoad, WarningThreshold = 70, ErrorThreshold = 90 };
        var result = new CheckResult();
        CheckEvaluator.Apply(check, result, Json(new { percent = 100 }), Now);
        Assert.Equal(CheckStatus.Failing, result.Status);
        Assert.Equal(Severity.Error, result.AlertSeverity);

        CheckEvaluator.Apply(check, result, Json(new { percent = 50 }), Now);
        Assert.Equal(CheckStatus.Failing, result.Status);
        Assert.Equal(Severity.Warning, result.AlertSeverity);
        Assert.Equal(2, result.FailCount);

        CheckEvaluator.Apply(check, result, Json(new { percent = 0 }), Now);
        Assert.Equal(CheckStatus.Passing, result.Status);
        Assert.Equal(0, result.FailCount);
    }

    [Theory]
    [InlineData(0, "passing", null)]
    [InlineData(3, "failing", "info")]
    [InlineData(4, "failing", "warning")]
    [InlineData(5, "passing", null)]
    [InlineData(1, "failing", "error")]
    public void ScriptCheck_MapsReturnCodes(long retcode, string status, string? severity)
    {
        var check = new Check { CheckType = CheckTypes.Script, InfoReturnCodes = [3], WarningReturnCodes = [4], SuccessReturnCodes = [5] };
        var result = new CheckResult();
        CheckEvaluator.Apply(check, result, Json(new { retcode, stdout = "x", stderr = "", runtime = 0.1 }), Now);
        Assert.Equal(status, result.Status);
        Assert.Equal(severity, result.AlertSeverity);
    }

    [Fact]
    public void Schedule_WeeklyAndMonthlyRules()
    {
        var weekly = new AutomatedTask { Name = "s", Actions = "[]", ScheduleType = TaskSchedules.Weekly, Time = "08:30", DaysOfWeek = [1, 3] };
        var monday = new DateTimeOffset(2026, 10, 5, 8, 30, 0, TimeSpan.FromHours(-3));
        Assert.True(AgentTaskScheduler.IsDue(weekly, monday.ToUniversalTime(), monday));
        Assert.False(AgentTaskScheduler.IsDue(weekly, monday.AddDays(1).ToUniversalTime(), monday.AddDays(1)));

        var monthly = new AutomatedTask { Name = "m", Actions = "[]", ScheduleType = TaskSchedules.Monthly, Time = "23:00", DayOfMonth = 31 };
        var lastDayOfFebruary = new DateTimeOffset(2027, 2, 28, 23, 0, 0, TimeSpan.Zero);
        Assert.True(AgentTaskScheduler.IsDue(monthly, lastDayOfFebruary, lastDayOfFebruary));

        var tz = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");
        var next = AgentTaskScheduler.NextRun(weekly, new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero), tz);
        Assert.Equal(new DateTimeOffset(2026, 10, 7, 11, 30, 0, TimeSpan.Zero), next);
    }
}
