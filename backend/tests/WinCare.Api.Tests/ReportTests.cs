using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WinCare.Api.Reports;
using WinCare.Core.Persistence;
using WinCare.Core.Reports;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    [Fact]
    public async Task Reports_PreviewAgents_GeneratePdfAndCsv_AndDownload()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente relatorio", plat: "windows", monitoringType: "workstation");
        await UpdateAgentAsync(pk, a => a.Hostname = "=HYPERLINK(\"x\")");

        var types = await admin.GetFromJsonAsync<JsonElement>("/api/reports/types");
        Assert.Equal(7, types.GetArrayLength());

        var preview = await (await admin.PostAsJsonAsync("/api/reports/preview", new { type = "agents", clientId })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Agentes", preview.GetProperty("title").GetString());
        var row = Assert.Single(preview.GetProperty("rows").EnumerateArray());
        Assert.Equal("Cliente relatorio", row.GetProperty("client").GetString());
        Assert.Contains(preview.GetProperty("filtersText").EnumerateArray(), f => f.GetString() == "Cliente: Cliente relatorio");
        Assert.Equal("1", preview.GetProperty("summary")[0].GetProperty("value").GetString());

        var pdf = await admin.PostAsJsonAsync("/api/reports/runs", new { type = "agents", clientId, format = "pdf" });
        Assert.Equal(HttpStatusCode.Created, pdf.StatusCode);
        var pdfRun = await pdf.Content.ReadFromJsonAsync<JsonElement>();
        var pdfBytes = await admin.GetByteArrayAsync($"/api/reports/runs/{pdfRun.GetProperty("id").GetInt64()}/download");
        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdfBytes, 0, 4));
        Assert.EndsWith(".pdf", pdfRun.GetProperty("fileName").GetString(), StringComparison.Ordinal);

        var csvRun = await (await admin.PostAsJsonAsync("/api/reports/runs", new { type = "agents", clientId, format = "csv" })).Content.ReadFromJsonAsync<JsonElement>();
        var csv = await admin.GetAsync($"/api/reports/runs/{csvRun.GetProperty("id").GetInt64()}/download");
        Assert.Equal("text/csv", csv.Content.Headers.ContentType!.MediaType);
        var csvBytes = await csv.Content.ReadAsByteArrayAsync();
        Assert.Equal(Encoding.UTF8.GetPreamble(), csvBytes[..3]);
        var lines = Encoding.UTF8.GetString(csvBytes[3..]).Split("\r\n");
        Assert.StartsWith("Cliente;Site;Maquina;", lines[0], StringComparison.Ordinal);
        Assert.Contains("\"'=HYPERLINK(\"\"x\"\")\"", lines[1], StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/reports/preview", new { type = "nao_existe" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/reports/preview",
            new { type = "alerts", from = DateTimeOffset.UtcNow.AddDays(-400), to = DateTimeOffset.UtcNow })).StatusCode);
    }

    [Fact]
    public async Task Reports_TicketsComputeSla_AndScheduleSendsEmailOncePerSlot()
    {
        var (admin, clientId, _) = await NewSiteAsync("Cliente relatorio chamados");
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
            var queue = await db.TicketQueues.Select(q => q.Id).FirstAsync();
            var now = DateTimeOffset.UtcNow;
            db.Tickets.AddRange(
                new() { Title = "No prazo", RequesterName = "x", QueueId = queue, ClientId = clientId, CreatedAt = now.AddHours(-5), FirstResponseDueAt = now.AddHours(-4),
                        FirstResponseAt = now.AddHours(-4.5), ResolutionDueAt = now.AddHours(-1), ResolvedAt = now.AddHours(-2), Status = "resolved" },
                new() { Title = "Atrasado", RequesterName = "y", QueueId = queue, ClientId = clientId, CreatedAt = now.AddHours(-5), FirstResponseDueAt = now.AddHours(-4),
                        ResolutionDueAt = now.AddHours(-1), Status = "new" });
            await db.SaveChangesAsync();
        }
        var preview = await (await admin.PostAsJsonAsync("/api/reports/preview", new { type = "tickets", clientId, period = "last_24h" })).Content.ReadFromJsonAsync<JsonElement>();
        var summary = preview.GetProperty("summary").EnumerateArray().ToDictionary(s => s.GetProperty("label").GetString()!, s => s.GetProperty("value").GetString());
        Assert.Equal("2", summary["Abertos no periodo"]);
        Assert.Equal("50,0%", summary["SLA de resposta cumprido"]);
        Assert.Contains(preview.GetProperty("rows").EnumerateArray(), r => r.GetProperty("slaResolution").GetString() == "Estourado");

        var bad = await admin.PostAsJsonAsync("/api/reports/schedules", new
        {
            name = "Sem periodo", @params = new { type = "tickets", clientId }, format = "pdf", frequency = "weekly", time = "07:30", dayOfWeek = 1,
            recipients = new[] { "gestor@exemplo.com" }, enabled = true,
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var created = await admin.PostAsJsonAsync("/api/reports/schedules", new
        {
            name = "Chamados semanal", @params = new { type = "tickets", clientId, period = "last_7d" }, format = "csv", frequency = "weekly", time = "07:30",
            dayOfWeek = 1, recipients = new[] { "gestor@exemplo.com" }, enabled = true,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var schedule = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = schedule.GetProperty("id").GetInt32();
        Assert.True(schedule.GetProperty("nextRunAt").GetDateTimeOffset() > DateTimeOffset.UtcNow);

        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
            await db.ReportSchedules.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.NextRunAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }
        var scheduler = fixture.Services.GetRequiredService<ReportScheduler>();
        await Task.WhenAll(scheduler.RunOnceAsync(default), scheduler.RunOnceAsync(default));

        var runs = await admin.GetFromJsonAsync<JsonElement>($"/api/reports/runs?scheduleId={id}");
        var run = Assert.Single(runs.GetProperty("items").EnumerateArray());
        Assert.Equal("gestor@exemplo.com", run.GetProperty("emailedTo")[0].GetString());
        lock (fixture.Notifications.Emails)
        {
            var mail = Assert.Single(fixture.Notifications.EmailsWithAttachments, m => m.To.Contains("gestor@exemplo.com"));
            Assert.EndsWith(".csv", Assert.Single(mail.Attachments).FileName, StringComparison.Ordinal);
        }
        var after = (await admin.GetFromJsonAsync<JsonElement>("/api/reports/schedules")).EnumerateArray().Single(s => s.GetProperty("id").GetInt32() == id);
        Assert.Equal("ok", after.GetProperty("lastStatus").GetString());
        Assert.True(after.GetProperty("nextRunAt").GetDateTimeOffset() > DateTimeOffset.UtcNow);
    }
}

public sealed class ReportUnitTests
{
    private static readonly TimeZoneInfo SaoPaulo = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");

    [Fact]
    public void NextRun_IsComputedInConfiguredTimeZone()
    {
        var weekly = new ReportSchedule { Name = "x", Type = "agents", CreatedBy = "t", Frequency = "weekly", Time = "07:30", DayOfWeek = 1 };
        // Quarta-feira 01/10/2026 12:00 UTC (09:00 em Sao Paulo): proxima segunda 05/10 07:30 local = 10:30 UTC.
        Assert.Equal(new DateTimeOffset(2026, 10, 5, 10, 30, 0, TimeSpan.Zero), ReportService.NextRun(weekly, new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero), SaoPaulo));
        var monthly = new ReportSchedule { Name = "x", Type = "agents", CreatedBy = "t", Frequency = "monthly", Time = "06:00", DayOfMonth = 1 };
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 9, 0, 0, TimeSpan.Zero), ReportService.NextRun(monthly, new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero), SaoPaulo));
    }

    [Fact]
    public void PreviousMonth_UsesLocalMonthBoundaries()
    {
        var (from, to) = ReportPeriods.Resolve("previous_month", new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero), SaoPaulo);
        Assert.Equal(new DateTimeOffset(2026, 9, 1, 3, 0, 0, TimeSpan.Zero), from);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 3, 0, 0, TimeSpan.Zero), to);
    }

    [Theory]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("texto;com;ponto", "\"texto;com;ponto\"")]
    [InlineData("normal", "normal")]
    public void Csv_EscapesFormulasAndSeparators(string input, string expected) => Assert.Equal(expected, CsvRenderer.Escape(input));

    [Fact]
    public void Pdf_IsA4Landscape()
    {
        var data = new ReportData
        {
            Type = "agents", Title = "Agentes", GeneratedAt = DateTimeOffset.UtcNow,
            Columns = [new("hostname", "Maquina"), new("lastSeen", "Ultimo contato", ColumnKind.DateTime)],
            Rows = [new() { ["hostname"] = "pc-01", ["lastSeen"] = DateTimeOffset.UtcNow }],
        };
        using var stream = new MemoryStream(PdfRenderer.Render(data, SaoPaulo));
        var page = PdfSharp.Pdf.IO.PdfReader.Open(stream, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import).Pages[0];
        Assert.True(page.Width.Point > page.Height.Point, $"pagina {page.Width.Point} x {page.Height.Point}");
        Assert.Equal(842, page.Width.Point, 0);
    }

    [Fact]
    public void Duration_IsHumanReadable()
    {
        Assert.Equal("45s", ReportFormatter.Duration(45));
        Assert.Equal("2h 05min", ReportFormatter.Duration(7500));
        Assert.Equal("1d 0h 01min", ReportFormatter.Duration(86460));
    }
}
