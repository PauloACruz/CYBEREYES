using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.SpeedTest;

/// <summary>Plano contratado opcional: o relatorio compara a velocidade entregue com ele.</summary>
public sealed record StartSpeedTestRequest(
    string? Mode,
    [property: Range(0.1, 100_000)] double? PlanDownloadMbps = null,
    [property: Range(0.1, 100_000)] double? PlanUploadMbps = null);

public sealed record SpeedTestSummaryDto(long Id, string Mode, string Status, string? Phase, int Progress, double? LiveMbps, string RequestedBy,
    DateTimeOffset CreatedAt, DateTimeOffset? FinishedAt, double? DownloadMbps, double? UploadMbps, double? LatencyMs, double? JitterMs, double? LossPct,
    double? PlanDownloadMbps, double? PlanUploadMbps, string? Error);

public sealed record SpeedTestAgentDto(int Id, string Hostname, string ClientName, string SiteName, string Plat, string Version);

/// <summary><see cref="Report"/> e <see cref="Analysis"/> so existem depois que o agente envia o resultado.</summary>
public sealed record SpeedTestDetailDto(SpeedTestSummaryDto Test, SpeedTestAgentDto Agent, SpeedTestReport? Report, SpeedTestAnalysis? Analysis);

/// <summary>
/// Teste de velocidade (EYES 3.4.0+): o console pede (func <c>speedtest</c>), o agente mede em segundo plano e informa o
/// andamento e o relatorio em <c>PATCH /api/v4/{agent_id}/{pk}/speedtest/</c>. Um teste por maquina de cada vez.
/// </summary>
public static class SpeedTestEndpoints
{
    public const string Func = "speedtest";
    public const int KeepPerAgent = 100;
    public static readonly Version MinimumAgent = new(3, 4, 0);

    // Sem noticia do agente nesse tempo o teste e dado como perdido (o agente manda andamento ao menos a cada fase).
    private static readonly TimeSpan PendingTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RunningTimeout = TimeSpan.FromSeconds(120);
    private static readonly HashSet<string> Modes = new(StringComparer.Ordinal) { SpeedTestMode.Full, SpeedTestMode.Quick };
    private static readonly HashSet<string> Phases = new(StringComparer.Ordinal) { "network", "latency", "download", "upload", "finishing" };

    public static bool Supports(string? version) => System.Version.TryParse(version, out var v) && v >= MinimumAgent;

    public static void MapSpeedTestEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.AgentsView);
        var g = app.MapGroup("/api/agents/{id:int}/speedtests").WithTags("Teste de velocidade");
        g.MapGet("/", ListAsync).RequireAuthorization(view);
        g.MapGet("/{testId:long}", GetAsync).RequireAuthorization(view);
        g.MapGet("/{testId:long}/pdf", PdfAsync).RequireAuthorization(view);
        g.MapPost("/", StartAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsControl));

        app.MapPatch("/api/v4/{agentId}/{pk:long}/speedtest/", ResultAsync).RequireAuthorization(Policies.Agent).ExcludeFromDescription();
    }

    private static async Task<IResult> StartAsync(int id, StartSpeedTestRequest r, CybereyesDbContext db, IAgentRpc rpc, IAuditService audit,
        ProcedureLog procedures, TimeProvider time, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var mode = r.Mode ?? SpeedTestMode.Full;
        if (!Modes.Contains(mode))
        {
            return Problems.Validation("mode", "Modo de teste invalido");
        }
        var version = await db.Agents.Where(a => a.Id == id).Select(a => a.Version).FirstAsync(ct);
        if (!Supports(version))
        {
            return Problems.BadRequest($"Atualize o agente para a versao {MinimumAgent} ou maior para usar o teste de velocidade");
        }
        var now = time.GetUtcNow();
        await ExpireAsync(db, procedures, id, now, ct);
        if (await db.AgentSpeedTests.AnyAsync(t => t.AgentId == id && (t.Status == SpeedTestStatus.Pending || t.Status == SpeedTestStatus.Running), ct))
        {
            return Problems.Conflict("Ja existe um teste de velocidade em andamento nesta maquina");
        }

        var actor = await procedures.CurrentActorAsync(ct);
        var test = new AgentSpeedTest
        {
            AgentId = id, Mode = mode, RequestedBy = SpeedTestReport.Cut(actor.Name, 200), CreatedAt = now, UpdatedAt = now,
            PlanDownloadMbps = r.PlanDownloadMbps, PlanUploadMbps = r.PlanUploadMbps,
        };
        db.AgentSpeedTests.Add(test);
        await db.SaveChangesAsync(ct);
        var old = await db.AgentSpeedTests.Where(t => t.AgentId == id).OrderByDescending(t => t.CreatedAt).Skip(KeepPerAgent).Select(t => t.Id).ToListAsync(ct);
        if (old.Count > 0)
        {
            await db.AgentSpeedTests.Where(t => old.Contains(t.Id)).ExecuteDeleteAsync(ct);
        }

        var label = ModeLabel(mode);
        var procedure = await procedures.StartAsync(id, ProcedureKind.SpeedTest, $"Teste de velocidade {label}", refType: ProcedureRef.SpeedTest,
            refId: test.Id.ToString(CultureInfo.InvariantCulture), actor: actor, ct: ct);
        await audit.LogAsync("agent.speedtest", "agent", id.ToString(CultureInfo.InvariantCulture), $"{agent.Hostname}: teste de velocidade {label}",
            cancellationToken: ct);
        string? failure = null;
        try
        {
            // Pedido com resposta: o agente so confirma e mede em segundo plano, entao a maquina offline aparece na hora.
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = Func, ["speedtest_pk"] = (int)test.Id, ["mode"] = mode,
            }, TimeSpan.FromSeconds(10), ct);
            if (reply is string text && text.StartsWith("error", StringComparison.OrdinalIgnoreCase))
            {
                failure = text;
            }
        }
        catch (AgentRpcTimeoutException)
        {
            failure = "O agente nao respondeu: a maquina esta offline ou sem conexao com o servidor";
        }
        if (failure is not null)
        {
            Fail(test, failure, time.GetUtcNow());
            await db.SaveChangesAsync(CancellationToken.None);
            await procedures.FinishAsync(procedure, ProcedureStatus.Error, failure, CancellationToken.None);
            return Problems.Conflict(failure);
        }
        return TypedResults.Created($"/api/agents/{id}/speedtests/{test.Id}", Summary(test));
    }

    private static async Task<IResult> ListAsync(int id, int? limit, CybereyesDbContext db, ProcedureLog procedures, TimeProvider time, CancellationToken ct)
    {
        if (!await db.Agents.AnyAsync(a => a.Id == id, ct))
        {
            return Problems.NotFound("Agente");
        }
        await ExpireAsync(db, procedures, id, time.GetUtcNow(), ct);
        var tests = await db.AgentSpeedTests.AsNoTracking().Where(t => t.AgentId == id).OrderByDescending(t => t.CreatedAt)
            .Take(Math.Clamp(limit ?? 50, 1, KeepPerAgent)).ToListAsync(ct);
        return TypedResults.Ok(tests.Select(Summary).ToList());
    }

    private static async Task<IResult> GetAsync(int id, long testId, CybereyesDbContext db, ProcedureLog procedures, TimeProvider time, CancellationToken ct)
    {
        await ExpireAsync(db, procedures, id, time.GetUtcNow(), ct);
        return await DetailAsync(db, id, testId, ct) is { } detail ? TypedResults.Ok(detail) : Problems.NotFound("Teste de velocidade");
    }

    private static async Task<IResult> PdfAsync(int id, long testId, CybereyesDbContext db, CancellationToken ct)
    {
        if (await DetailAsync(db, id, testId, ct) is not { } detail)
        {
            return Problems.NotFound("Teste de velocidade");
        }
        if (detail.Report is null)
        {
            return Problems.Conflict(SpeedTestStatus.IsActive(detail.Test.Status) ? "O teste ainda nao terminou" : "Este teste nao gerou relatorio");
        }
        var zone = SettingsStore.TimeZone(await SettingsStore.GetAsync(db, ct));
        var bytes = SpeedTestPdf.Render(detail, zone);
        var stamp = TimeZoneInfo.ConvertTime(detail.Test.CreatedAt, zone).ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);
        return Results.File(bytes, "application/pdf", $"teste-velocidade-{FileSafe(detail.Agent.Hostname)}-{stamp}.pdf");
    }

    /// <summary>Andamento (status running) e resultado (completed ou failed) enviados pelo agente.</summary>
    public static async Task<IResult> ResultAsync(long pk, JsonElement body, ClaimsPrincipal principal, CybereyesDbContext db, ProcedureLog procedures,
        TimeProvider time, CancellationToken ct)
    {
        var agentPk = int.Parse(principal.FindFirstValue(CybereyesClaims.AgentPk)!, CultureInfo.InvariantCulture);
        var test = await db.AgentSpeedTests.FirstOrDefaultAsync(t => t.Id == pk && t.AgentId == agentPk, ct);
        if (test is null || !SpeedTestStatus.IsActive(test.Status) || body.ValueKind != JsonValueKind.Object)
        {
            return Results.Json("ok");
        }
        var now = time.GetUtcNow();
        test.UpdatedAt = now;
        var status = Str(body, "status");
        if (status is SpeedTestStatus.Completed or SpeedTestStatus.Failed)
        {
            var report = body.TryGetProperty("report", out var raw) ? SpeedTestReport.Normalize(raw) : null;
            if (report is not null)
            {
                test.Report = report.Serialize();
                test.DownloadMbps = report.Download.Mbps > 0 ? report.Download.Mbps : null;
                test.UploadMbps = report.Upload.Mbps > 0 ? report.Upload.Mbps : null;
                var analysis = SpeedTestAnalyzer.Analyze(report, test.PlanDownloadMbps, test.PlanUploadMbps);
                (test.LatencyMs, test.JitterMs, test.LossPct) = (analysis.LatencyMs, analysis.JitterMs, analysis.LossPct);
            }
            if (status == SpeedTestStatus.Completed && report is not null)
            {
                test.Status = SpeedTestStatus.Completed;
                test.FinishedAt = now;
                test.Progress = 100;
                (test.Phase, test.LiveMbps) = (null, null);
            }
            else
            {
                Fail(test, Str(body, "error") is { Length: > 0 } error ? error : "O agente nao enviou o relatorio", now);
            }
            await db.SaveChangesAsync(ct);
            var detail = test.Status == SpeedTestStatus.Completed
                ? $"Download {SpeedTestAnalyzer.Mbps(test.DownloadMbps)}, upload {SpeedTestAnalyzer.Mbps(test.UploadMbps)}, latencia {SpeedTestAnalyzer.Ms(test.LatencyMs)}"
                : test.Error;
            await procedures.FinishByRefAsync(ProcedureRef.SpeedTest, test.Id.ToString(CultureInfo.InvariantCulture),
                test.Status == SpeedTestStatus.Completed ? ProcedureStatus.Ok : ProcedureStatus.Error, detail, ct);
            return Results.Json("ok");
        }

        test.Status = SpeedTestStatus.Running;
        var phase = Str(body, "phase");
        if (Phases.Contains(phase))
        {
            test.Phase = phase;
        }
        if (body.TryGetProperty("progress", out var p) && p.TryGetInt32(out var progress))
        {
            // 100 so com o resultado: o console usa o fim do andamento para saber que o relatorio chegou.
            test.Progress = Math.Clamp(progress, test.Progress, 99);
        }
        test.LiveMbps = body.TryGetProperty("live_mbps", out var live) && live.TryGetDouble(out var mbps) && mbps is >= 0 and < 1_000_000
            ? Math.Round(mbps, 1) : null;
        await db.SaveChangesAsync(ct);
        return Results.Json("ok");
    }

    /// <summary>Da como perdidos os testes sem noticia do agente (offline no meio do teste, agente reiniciado...).</summary>
    private static async Task ExpireAsync(CybereyesDbContext db, ProcedureLog procedures, int agentId, DateTimeOffset now, CancellationToken ct)
    {
        var pendingLimit = now - PendingTimeout;
        var runningLimit = now - RunningTimeout;
        var stale = await db.AgentSpeedTests.Where(t => t.AgentId == agentId &&
            ((t.Status == SpeedTestStatus.Pending && t.UpdatedAt < pendingLimit) || (t.Status == SpeedTestStatus.Running && t.UpdatedAt < runningLimit)))
            .ToListAsync(ct);
        if (stale.Count == 0)
        {
            return;
        }
        foreach (var test in stale)
        {
            Fail(test, test.Status == SpeedTestStatus.Pending
                ? "O agente nao comecou o teste: a maquina ficou offline ou o EYES esta desatualizado"
                : "O agente parou de informar o andamento do teste", now);
        }
        await db.SaveChangesAsync(ct);
        foreach (var test in stale)
        {
            await procedures.FinishByRefAsync(ProcedureRef.SpeedTest, test.Id.ToString(CultureInfo.InvariantCulture), ProcedureStatus.Timeout, test.Error, ct);
        }
    }

    private static async Task<SpeedTestDetailDto?> DetailAsync(CybereyesDbContext db, int id, long testId, CancellationToken ct)
    {
        var test = await db.AgentSpeedTests.AsNoTracking().FirstOrDefaultAsync(t => t.Id == testId && t.AgentId == id, ct);
        if (test is null)
        {
            return null;
        }
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id)
            .Select(a => new SpeedTestAgentDto(a.Id, a.Hostname, a.Site!.Client!.Name, a.Site.Name, a.Plat, a.Version)).FirstAsync(ct);
        var report = SpeedTestReport.Read(test.Report);
        var analysis = report is null ? null : SpeedTestAnalyzer.Analyze(report, test.PlanDownloadMbps, test.PlanUploadMbps);
        return new SpeedTestDetailDto(Summary(test), agent, report, analysis);
    }

    private static void Fail(AgentSpeedTest test, string error, DateTimeOffset now)
    {
        test.Status = SpeedTestStatus.Failed;
        test.Error = SpeedTestReport.Cut(error, 1000);
        test.FinishedAt = now;
        (test.Phase, test.LiveMbps) = (null, null);
    }

    private static SpeedTestSummaryDto Summary(AgentSpeedTest t) =>
        new(t.Id, t.Mode, t.Status, t.Phase, t.Progress, t.LiveMbps, t.RequestedBy, t.CreatedAt, t.FinishedAt, t.DownloadMbps, t.UploadMbps,
            t.LatencyMs, t.JitterMs, t.LossPct, t.PlanDownloadMbps, t.PlanUploadMbps, t.Error);

    public static string ModeLabel(string mode) => mode == SpeedTestMode.Quick ? "rapido" : "completo";

    private static string Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;

    private static string FileSafe(string name) =>
        new(name.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '-').ToArray());
}
