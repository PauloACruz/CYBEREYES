using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WinCare.Api.Logs;
using WinCare.Api.Rmm.Nats;
using WinCare.Api.Snmp;
using WinCare.Core.Persistence;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    private static string Iso(DateTimeOffset t) => t.ToString("O", CultureInfo.InvariantCulture);

    private async Task<T> InDbAsync<T>(Func<WinCareDbContext, Task<T>> query)
    {
        using var scope = fixture.Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<WinCareDbContext>());
    }

    [Fact]
    public async Task Logs_AreStoredInMonthlyPartition_FilteredByLevel_PagedByCursor_AndSummarized()
    {
        var (admin, pk, agentId, token, agent) = await WinCareAgentAsync("Cliente logs", _ => null);
        await using var _ = agent;
        await fixture.Services.GetRequiredService<LogPartitionService>().RunOnceAsync(default);
        using var http = AgentClient(token);

        var config = await http.GetFromJsonAsync<JsonElement>($"/api/v3/{agentId}/logconfig/");
        Assert.True(config.GetProperty("enabled").GetBoolean());
        Assert.Equal("warning", config.GetProperty("min_level").GetString());

        var now = DateTimeOffset.UtcNow;
        var sent = await http.PostAsJsonAsync("/api/v3/logs/", new
        {
            entries = new object[]
            {
                new { time = Iso(now.AddMinutes(-3)), level = "error", source = "kernel", log = "journal", event_id = (int?)null, message = "I/O error\0 no disco sda", host = "wc-host" },
                new { time = Iso(now.AddMinutes(-2)), level = "warning", source = "sshd", log = "journal", event_id = (int?)null, message = "Falha de login", host = "wc-host" },
                new { time = Iso(now.AddMinutes(-1)), level = "info", source = "cron", log = "journal", event_id = (int?)null, message = "abaixo do nivel minimo", host = "wc-host" },
                new { time = Iso(now.AddDays(-90)), level = "critical", source = "kernel", log = "journal", event_id = (int?)null, message = "fora da retencao", host = "wc-host" },
            },
        });
        Assert.Equal(HttpStatusCode.OK, sent.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.PostAsJsonAsync("/api/v3/logs/",
            new { entries = Enumerable.Range(0, LogIngest.MaxEntries + 1).Select(i => new { time = Iso(now), level = "error", message = "x" }) })).StatusCode);

        var partition = LogPartitionService.PartitionName("system_logs", new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero));
#pragma warning disable EF1002 // Nome da particao gerado pelo proprio servico.
        var inPartition = await InDbAsync(db => db.Database.SqlQueryRaw<int>($"SELECT count(*)::int AS \"Value\" FROM {partition} WHERE \"AgentId\" = {{0}}", pk).SingleAsync());
#pragma warning restore EF1002
        Assert.Equal(2, inPartition);

        var page = await admin.GetFromJsonAsync<JsonElement>($"/api/logs?agentId={pk}&limit=1");
        var first = Assert.Single(page.GetProperty("items").EnumerateArray());
        Assert.Equal("sshd", first.GetProperty("source").GetString());
        Assert.Equal("wc-host", first.GetProperty("hostname").GetString());
        var next = await admin.GetFromJsonAsync<JsonElement>($"/api/logs?agentId={pk}&limit=1&before={page.GetProperty("nextBefore").GetString()}");
        Assert.Equal("I/O error no disco sda", next.GetProperty("items")[0].GetProperty("message").GetString());

        var errors = await admin.GetFromJsonAsync<JsonElement>($"/api/logs?agentId={pk}&level=error&search=disco");
        Assert.Equal("kernel", Assert.Single(errors.GetProperty("items").EnumerateArray()).GetProperty("source").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/api/logs?from={Uri.EscapeDataString(Iso(now.AddDays(-40)))}")).StatusCode);

        var summary = await admin.GetFromJsonAsync<JsonElement>($"/api/logs/summary?agentId={pk}");
        Assert.Equal(1, summary.GetProperty("byLevel").GetProperty("error").GetInt32());
        Assert.Equal(1, summary.GetProperty("byLevel").GetProperty("warning").GetInt32());
        Assert.Equal(2, summary.GetProperty("perHour").EnumerateArray().Sum(h => h.GetProperty("error").GetInt32() + h.GetProperty("warning").GetInt32()));
    }

    [Fact]
    public async Task LogAlertRule_RaisesAlertWhenThresholdIsReached_AndResolvesWhenWindowIsQuiet()
    {
        var (admin, pk, _, token, agent) = await WinCareAgentAsync("Cliente regra de log", _ => null);
        await using var _ = agent;
        var clientId = await InDbAsync(db => db.Agents.Where(a => a.Id == pk).Select(a => a.Site!.ClientId).SingleAsync());
        var created = await admin.PostAsJsonAsync("/api/log-alert-rules", new
        {
            name = "Disco com falha", clientId, minLevel = "error", messageContains = "sector", threshold = 2, windowMinutes = 10, severity = "warning", enabled = true,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var ruleId = (await created.Content.ReadFromJsonAsync<IdOnly>())!.Id;

        using var http = AgentClient(token);
        var now = DateTimeOffset.UtcNow;
        await http.PostAsJsonAsync("/api/v3/logs/", new
        {
            entries = new[]
            {
                new { time = Iso(now.AddMinutes(-4)), level = "error", source = "kernel", message = "bad sector 100" },
                new { time = Iso(now.AddMinutes(-3)), level = "error", source = "kernel", message = "bad sector 200" },
            },
        });

        var evaluator = fixture.Services.GetRequiredService<LogAlertEvaluator>();
        await evaluator.RunOnceAsync(default);
        var open = await admin.GetFromJsonAsync<JsonElement>($"/api/alerts?agentId={pk}");
        var alert = Assert.Single(open.GetProperty("items").EnumerateArray(), a => a.GetProperty("alertType").GetString() == "log");
        Assert.Contains("bad sector 200", alert.GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Equal("warning", alert.GetProperty("severity").GetString());

        await admin.PutAsJsonAsync($"/api/log-alert-rules/{ruleId}", new
        {
            name = "Disco com falha", clientId, minLevel = "error", messageContains = "sector", threshold = 2, windowMinutes = 1, severity = "warning", enabled = true,
        });
        await evaluator.RunOnceAsync(default);
        var after = await admin.GetFromJsonAsync<JsonElement>($"/api/alerts?agentId={pk}");
        Assert.DoesNotContain(after.GetProperty("items").EnumerateArray(), a => a.GetProperty("alertType").GetString() == "log");
    }

    [Fact]
    public async Task SnmpDevice_PollingComputesRates_AlertsOnSensorInterfaceAndOutage_AndTrapsBecomeLogs()
    {
        var (admin, pk, agentId, token, agent) = await WinCareAgentAsync("Cliente snmp", r => r.GetString("func") == "snmp_test"
            ? """{"reachable":true,"error":null,"rtt_ms":3.5,"system":{"name":"sw-core"}}"""
            : null);
        await using var _ = agent;
        var clientId = await InDbAsync(db => db.Agents.Where(a => a.Id == pk).Select(a => a.Site!.ClientId).SingleAsync());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/agents/{pk}/snmp-collector", new { enabled = true })).StatusCode);
        await UpdateAgentAsync(pk, a => a.Version = "2.13.0");
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/agents/{pk}/snmp-collector", new { enabled = true })).StatusCode);

        var body = new
        {
            clientId, collectorAgentId = pk, name = "Switch core", host = "10.9.8.7", port = 161, version = "v2c", community = "comunidade-secreta",
            interval = 60, timeout = 2, retries = 1, pollInterfaces = true, enabled = true, trapSeverity = "warning",
        };
        var test = await admin.PostAsJsonAsync("/api/snmp/devices/test", body);
        Assert.Equal("sw-core", (await test.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("system").GetProperty("name").GetString());
        var testTarget = JsonDocument.Parse(Payload(agent.Received.Single(m => m.GetString("func") == "snmp_test"), "target")!).RootElement;
        Assert.Equal("comunidade-secreta", testTarget.GetProperty("community").GetString());

        var created = await admin.PostAsJsonAsync("/api/snmp/devices", body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var deviceId = (await created.Content.ReadFromJsonAsync<IdOnly>())!.Id;
        Assert.StartsWith("v1:", await InDbAsync(db => db.SnmpDevices.Where(d => d.Id == deviceId).Select(d => d.CommunityEncrypted!).SingleAsync()),
            StringComparison.Ordinal);
        Assert.DoesNotContain("comunidade-secreta", await admin.GetStringAsync($"/api/snmp/devices/{deviceId}"), StringComparison.Ordinal);
        var sensor = await (await admin.PostAsJsonAsync($"/api/snmp/devices/{deviceId}/sensors",
            new { name = "Temperatura", oid = ".1.3.6.1.4.1.9.9.13.1.3.1.3.1", unit = "C", critAbove = 80.0 })).Content.ReadFromJsonAsync<IdOnly>();

        using var http = AgentClient(token);
        var config = await http.GetFromJsonAsync<JsonElement>($"/api/v3/{agentId}/snmp/");
        var target = Assert.Single(config.GetProperty("devices").EnumerateArray());
        Assert.Equal("comunidade-secreta", target.GetProperty("community").GetString());
        Assert.Equal(sensor!.Id, target.GetProperty("sensors")[0].GetProperty("id").GetInt32());

        var t0 = DateTimeOffset.UtcNow.AddMinutes(-10);
        object Result(int minute, bool reachable, long inOctets, string oper, double temperature) => new
        {
            device_id = deviceId, time = Iso(t0.AddMinutes(minute)), reachable, error = reachable ? null : "timeout", rtt_ms = 2.0,
            system = reachable ? new { descr = "Cisco IOS", object_id = "1.3.6.1.4.1.9", uptime_ticks = 360000, contact = "", name = "sw-core", location = "CPD" } : null,
            interfaces = new[] { new { index = 1, name = "Gi0/1", descr = "GigabitEthernet0/1", alias = "", type = 6, speed_bps = 1_000_000_000L, admin_status = "up", oper_status = oper, in_octets = inOctets, out_octets = 0L, in_errors = 0, out_errors = 0, hc = true } },
            sensors = new[] { new { id = sensor.Id, value = (double?)temperature, text = (string?)null } },
        };
        async Task PostAsync(params object[] results) =>
            Assert.Equal(HttpStatusCode.OK, (await http.PostAsJsonAsync("/api/v3/snmp/results/", new { results })).StatusCode);

        await PostAsync(Result(0, true, 1000, "up", 50));
        await PostAsync(Result(1, true, 8500, "up", 90));
        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/snmp/devices/{deviceId}");
        Assert.Equal("up", detail.GetProperty("status").GetString());
        Assert.Equal(3600, detail.GetProperty("uptimeSeconds").GetInt64());
        Assert.Equal(1000, detail.GetProperty("interfaces")[0].GetProperty("inBps").GetDouble(), 3);
        var metrics = await admin.GetFromJsonAsync<JsonElement>($"/api/snmp/devices/{deviceId}/metrics?metric=if:1:in&from={Uri.EscapeDataString(Iso(t0.AddHours(-1)))}");
        Assert.Equal(1000, Assert.Single(metrics.GetProperty("points").EnumerateArray()).GetProperty("value").GetDouble(), 3);

        await admin.PutAsJsonAsync($"/api/snmp/devices/{deviceId}/interfaces/1", new { monitored = true });
        await PostAsync(Result(2, true, 500, "down", 40));
        await PostAsync(Result(3, false, 0, "down", 40), Result(4, false, 0, "down", 40));

        var alerts = (await admin.GetFromJsonAsync<JsonElement>($"/api/alerts?clientId={clientId}")).GetProperty("items").EnumerateArray().ToList();
        Assert.All(alerts, a => Assert.Equal("Switch core", a.GetProperty("deviceName").GetString()));
        Assert.Equal(new[] { "snmp_device", "snmp_interface" }, alerts.Select(a => a.GetProperty("alertType").GetString()).Order());
        var outage = alerts.Single(a => a.GetProperty("alertType").GetString() == "snmp_device").GetProperty("id").GetInt64();
        var incident = await InDbAsync(db => db.Tickets.Where(t => t.AlertId == outage).Select(t => new { t.Title, t.ClientId }).SingleAsync());
        Assert.StartsWith("[Switch core]", incident.Title, StringComparison.Ordinal);
        Assert.Equal(clientId, incident.ClientId);
        Assert.True(await InDbAsync(db => db.Alerts.AnyAsync(a => a.SnmpDeviceId == deviceId && a.AlertType == "snmp_sensor" && a.Resolved)));

        await PostAsync(Result(5, true, 600, "up", 40));
        var reopened = (await admin.GetFromJsonAsync<JsonElement>($"/api/alerts?clientId={clientId}")).GetProperty("items");
        Assert.Equal(0, reopened.GetArrayLength());

        await http.PostAsJsonAsync("/api/v3/snmp/traps/", new
        {
            traps = new object[]
            {
                new { time = Iso(DateTimeOffset.UtcNow), source_ip = "10.9.8.7", version = "v2c", community = "comunidade-secreta", trap_oid = "1.3.6.1.6.3.1.1.5.3", varbinds = new[] { new { oid = "1.3.6.1.2.1.2.2.1.1.1", type = "Integer", value = "1" } } },
                new { time = Iso(DateTimeOffset.UtcNow), source_ip = "10.9.8.7", version = "v2c", community = "errada", trap_oid = "1.3.6.1.6.3.1.1.5.4", varbinds = Array.Empty<object>() },
                new { time = Iso(DateTimeOffset.UtcNow), source_ip = "10.1.1.1", version = "v2c", community = "x", trap_oid = "1.3.6.1.6.3.1.1.5.1", varbinds = Array.Empty<object>() },
            },
        });
        var trapLog = Assert.Single((await admin.GetFromJsonAsync<JsonElement>($"/api/logs?deviceId={deviceId}")).GetProperty("items").EnumerateArray());
        Assert.Equal("warning", trapLog.GetProperty("level").GetString());
        Assert.Contains("1.3.6.1.6.3.1.1.5.3", trapLog.GetProperty("message").GetString(), StringComparison.Ordinal);
        var collectorLogs = (await admin.GetFromJsonAsync<JsonElement>($"/api/logs?agentId={pk}&source=snmp-trap")).GetProperty("items").EnumerateArray()
            .Select(l => l.GetProperty("message").GetString()).ToList();
        Assert.Equal(2, collectorLogs.Count);
        Assert.Contains(collectorLogs, m => m!.Contains("comunidade nao confere", StringComparison.Ordinal));
        Assert.Single((await admin.GetFromJsonAsync<JsonElement>($"/api/alerts?clientId={clientId}")).GetProperty("items").EnumerateArray(),
            a => a.GetProperty("alertType").GetString() == "snmp_trap");

        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/agents/{pk}/snmp-collector", new { enabled = false })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/snmp/devices/{deviceId}")).StatusCode);
    }

    [Fact]
    public void InterfaceRate_DiscardsCounterWrapAndReset()
    {
        Assert.Equal(800, SnmpService.Rate(1000, 2000, 10));
        Assert.Null(SnmpService.Rate(2000, 1000, 10));
        Assert.Null(SnmpService.Rate(null, 1000, 10));
    }
}
