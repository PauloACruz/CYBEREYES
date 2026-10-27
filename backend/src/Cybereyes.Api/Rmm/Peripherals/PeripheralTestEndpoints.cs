using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Actions;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Peripherals;

public sealed record StartPeripheralTestRequest(string? Section);

/// <summary>Estado da tela de teste, como o app de bandeja monta (JSON livre, ate <see cref="PeripheralTestEndpoints.MaxStateBytes"/>).</summary>
public sealed record PeripheralStateRequest(JsonElement State);

public sealed record PeripheralTestDto(long Id, int AgentId, string Section, string Status, string RequestedBy, string? Username,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? ConnectedAt, DateTimeOffset? EndedAt, string? EndedBy, JsonElement? State);

/// <summary>Pedido que o app de bandeja recebe pelo hub e na consulta depois de reconectar.</summary>
public sealed record TrayPeripheralTestDto(long TestId, string Section, string Technician);

/// <summary>
/// Teste de periferico ao vivo: o tecnico abre pelo console (<c>POST /api/agents/{id}/peripheral-tests</c>), o pedido chega ao
/// app de bandeja da maquina pelo hub <c>/hubs/tray</c> e o app abre a tela de teste sozinho, sem o usuario procurar nada. A
/// cada mudanca o app manda o estado (<c>PUT /api/tray/peripheral-test/{testId}</c>) e o console recebe pelo hub do console
/// (<c>peripheralTestChanged</c>, grupo do agente). O estado fica gravado: o ultimo teste continua no console depois de encerrado.
/// </summary>
public static class PeripheralTestEndpoints
{
    public const string StartEvent = "peripheralTestStart";
    public const string StopEvent = "peripheralTestStop";
    public const string ChangedEvent = "peripheralTestChanged";
    public const int MaxStateBytes = 64 * 1024;
    public const int KeepPerAgent = 50;

    /// <summary>O app de bandeja com a tela de teste veio com o EYES 3.4.2 (o app acompanha a versao do agente).</summary>
    public static readonly Version MinimumAgent = new(3, 4, 2);

    public static bool Supports(string? version) => System.Version.TryParse(version, out var v) && v >= MinimumAgent;

    // Sem noticia do app nesse tempo o teste e encerrado (o app manda o estado a cada tecla).
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromMinutes(30);

    public static string TrayAgentGroup(int agentId) => "tray-agent:" + agentId.ToString(CultureInfo.InvariantCulture);

    public static string ConsoleGroup(int agentId) => "peripheral-test:" + agentId.ToString(CultureInfo.InvariantCulture);

    public static void MapPeripheralTestEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/agents/{id:int}/peripheral-tests").WithTags("Teste de periféricos");
        g.MapGet("/current", CurrentAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        g.MapPost("/", StartAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsControl));
        g.MapPost("/{testId:long}/end", EndAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsControl));

        var tray = app.MapGroup("/api/tray/peripheral-test").WithTags("App de bandeja").RequireAuthorization(Policies.Tray);
        tray.MapGet("/", TrayOpenAsync);
        tray.MapPut("/{testId:long}", TrayStateAsync);
        tray.MapPost("/{testId:long}/end", TrayEndAsync);
    }

    public static PeripheralTestDto Dto(AgentPeripheralTest t)
    {
        JsonElement? state = null;
        if (t.State is { Length: > 0 } raw)
        {
            using var doc = JsonDocument.Parse(raw);
            state = doc.RootElement.Clone();
        }
        return new PeripheralTestDto(t.Id, t.AgentId, t.Section, t.Status, t.RequestedBy, t.Username, t.CreatedAt, t.UpdatedAt, t.ConnectedAt,
            t.EndedAt, t.EndedBy, state);
    }

    private static async Task ExpireAsync(CybereyesDbContext db, int agentId, DateTimeOffset now, CancellationToken ct)
    {
        var limit = now - IdleTimeout;
        await db.AgentPeripheralTests
            .Where(t => t.AgentId == agentId && (t.Status == PeripheralTestStatus.Pending || t.Status == PeripheralTestStatus.Active) && t.UpdatedAt < limit)
            .ExecuteUpdateAsync(set => set
                .SetProperty(t => t.Status, PeripheralTestStatus.Ended)
                .SetProperty(t => t.EndedAt, now)
                .SetProperty(t => t.EndedBy, "tempo esgotado"), ct);
    }

    private static Task<AgentPeripheralTest?> OpenAsync(CybereyesDbContext db, int agentId, CancellationToken ct) =>
        db.AgentPeripheralTests.Where(t => t.AgentId == agentId && (t.Status == PeripheralTestStatus.Pending || t.Status == PeripheralTestStatus.Active))
            .OrderByDescending(t => t.CreatedAt).FirstOrDefaultAsync(ct);

    private static Task NotifyConsoleAsync(IHubContext<ConsoleHub> console, AgentPeripheralTest test, CancellationToken ct) =>
        console.Clients.Group(ConsoleGroup(test.AgentId)).SendAsync(ChangedEvent, Dto(test), ct);

    /// <summary>Ultimo teste da maquina (em andamento ou o ultimo encerrado); 204 se nunca houve.</summary>
    private static async Task<IResult> CurrentAsync(int id, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (!await db.Agents.AnyAsync(a => a.Id == id, ct))
        {
            return Problems.NotFound("Agente");
        }
        await ExpireAsync(db, id, time.GetUtcNow(), ct);
        var test = await db.AgentPeripheralTests.AsNoTracking().Where(t => t.AgentId == id).OrderByDescending(t => t.CreatedAt).FirstOrDefaultAsync(ct);
        return test is null ? TypedResults.NoContent() : TypedResults.Ok(Dto(test));
    }

    /// <summary>Abre o teste no app da maquina ou, com um teste aberto, troca a secao (o tecnico conduz pelo telefone).</summary>
    private static async Task<IResult> StartAsync(int id, StartPeripheralTestRequest r, CybereyesDbContext db, IHubContext<TrayHub> tray,
        IHubContext<ConsoleHub> console, IAuditService audit, ProcedureLog procedures, TimeProvider time, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var section = r.Section ?? PeripheralTestSection.Keyboard;
        if (!PeripheralTestSection.All.Contains(section))
        {
            return Problems.Validation("section", "Seção de teste inválida");
        }
        var version = await db.Agents.Where(a => a.Id == id).Select(a => a.Version).FirstAsync(ct);
        if (!Supports(version))
        {
            return Problems.BadRequest($"Atualize o agente para a versão {MinimumAgent} ou maior para usar o teste de periféricos");
        }
        var now = time.GetUtcNow();
        await ExpireAsync(db, id, now, ct);
        var actor = await procedures.CurrentActorAsync(ct);
        var test = await OpenAsync(db, id, ct);
        var created = test is null;
        if (test is null)
        {
            test = new AgentPeripheralTest { AgentId = id, RequestedBy = Cut(actor.Name, 200), CreatedAt = now };
            db.AgentPeripheralTests.Add(test);
        }
        test.Section = section;
        test.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        if (created)
        {
            var old = await db.AgentPeripheralTests.Where(t => t.AgentId == id).OrderByDescending(t => t.CreatedAt).Skip(KeepPerAgent)
                .Select(t => t.Id).ToListAsync(ct);
            if (old.Count > 0)
            {
                await db.AgentPeripheralTests.Where(t => old.Contains(t.Id)).ExecuteDeleteAsync(ct);
            }
            await audit.LogAsync("agent.peripheral-test", "agent", id.ToString(CultureInfo.InvariantCulture),
                $"{agent.Hostname}: teste de periféricos aberto no app do usuário", cancellationToken: ct);
        }
        await tray.Clients.Group(TrayAgentGroup(id)).SendAsync(StartEvent, new TrayPeripheralTestDto(test.Id, section, test.RequestedBy), ct);
        await NotifyConsoleAsync(console, test, ct);
        return created ? TypedResults.Created($"/api/agents/{id}/peripheral-tests/current", Dto(test)) : TypedResults.Ok(Dto(test));
    }

    private static async Task<IResult> EndAsync(int id, long testId, CybereyesDbContext db, IHubContext<TrayHub> tray, IHubContext<ConsoleHub> console,
        ProcedureLog procedures, TimeProvider time, CancellationToken ct)
    {
        var test = await db.AgentPeripheralTests.FirstOrDefaultAsync(t => t.Id == testId && t.AgentId == id, ct);
        if (test is null)
        {
            return Problems.NotFound("Teste de periféricos");
        }
        if (PeripheralTestStatus.IsOpen(test.Status))
        {
            var actor = await procedures.CurrentActorAsync(ct);
            test.Status = PeripheralTestStatus.Ended;
            test.EndedAt = test.UpdatedAt = time.GetUtcNow();
            test.EndedBy = Cut(actor.Name, 200);
            await db.SaveChangesAsync(ct);
            await tray.Clients.Group(TrayAgentGroup(id)).SendAsync(StopEvent, new { testId }, ct);
            await NotifyConsoleAsync(console, test, ct);
        }
        return TypedResults.Ok(Dto(test));
    }

    /// <summary>Teste aberto para esta maquina: o app consulta ao conectar no hub, para nao perder o pedido feito enquanto estava fora.</summary>
    private static async Task<IResult> TrayOpenAsync(HttpContext http, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (Tray.Session(http.User) is not { } session)
        {
            return TypedResults.Unauthorized();
        }
        await ExpireAsync(db, session.AgentId, time.GetUtcNow(), ct);
        var test = await OpenAsync(db, session.AgentId, ct);
        return test is null ? TypedResults.NoContent() : TypedResults.Ok(new TrayPeripheralTestDto(test.Id, test.Section, test.RequestedBy));
    }

    private static async Task<IResult> TrayStateAsync(long testId, PeripheralStateRequest r, HttpContext http, CybereyesDbContext db,
        IHubContext<ConsoleHub> console, TimeProvider time, CancellationToken ct)
    {
        if (Tray.Session(http.User) is not { } session)
        {
            return TypedResults.Unauthorized();
        }
        if (r.State.ValueKind != JsonValueKind.Object)
        {
            return Problems.Validation("state", "Estado inválido");
        }
        var raw = r.State.GetRawText();
        if (raw.Length > MaxStateBytes)
        {
            return Results.Json("Estado do teste grande demais", statusCode: StatusCodes.Status413PayloadTooLarge);
        }
        var test = await db.AgentPeripheralTests.FirstOrDefaultAsync(t => t.Id == testId && t.AgentId == session.AgentId, ct);
        if (test is null)
        {
            return Problems.NotFound("Teste de periféricos");
        }
        if (!PeripheralTestStatus.IsOpen(test.Status))
        {
            return Problems.Conflict("O teste foi encerrado");
        }
        var now = time.GetUtcNow();
        test.State = raw;
        test.Status = PeripheralTestStatus.Active;
        test.Username = Cut(session.Username, 256);
        test.ConnectedAt ??= now;
        test.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await NotifyConsoleAsync(console, test, ct);
        return TypedResults.Ok();
    }

    /// <summary>O usuario encerrou pelo app (botao "Encerrar teste").</summary>
    private static async Task<IResult> TrayEndAsync(long testId, HttpContext http, CybereyesDbContext db, IHubContext<ConsoleHub> console,
        TimeProvider time, CancellationToken ct)
    {
        if (Tray.Session(http.User) is not { } session)
        {
            return TypedResults.Unauthorized();
        }
        var test = await db.AgentPeripheralTests.FirstOrDefaultAsync(t => t.Id == testId && t.AgentId == session.AgentId, ct);
        if (test is null)
        {
            return Problems.NotFound("Teste de periféricos");
        }
        if (PeripheralTestStatus.IsOpen(test.Status))
        {
            test.Status = PeripheralTestStatus.Ended;
            test.EndedAt = test.UpdatedAt = time.GetUtcNow();
            test.EndedBy = Cut("usuário " + session.Username, 200);
            await db.SaveChangesAsync(ct);
            await NotifyConsoleAsync(console, test, ct);
        }
        return TypedResults.Ok();
    }

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max];
}
