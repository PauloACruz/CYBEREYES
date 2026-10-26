using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm;

public sealed record AgentUpdateRequest(int[]? AgentIds);

/// <summary>
/// Atualizacao remota do EYES: o servidor manda "agentupdate" com a versao e o SHA-256 do binario que ele
/// distribui; o agente baixa de /api/agent/download, confere, troca o executavel e reinicia o servico.
/// </summary>
public static partial class AgentUpdates
{
    public const string Func = "agentupdate";

    private static readonly ConcurrentDictionary<string, (DateTime Modified, string Hash)> Hashes = new(StringComparer.Ordinal);

    public static void MapAgentUpdateEndpoints(this IEndpointRouteBuilder app)
    {
        var control = Policies.Permission(Permissions.AgentsControl);
        app.MapGet("/api/agents/version", (IOptions<AgentSettings> settings) => TypedResults.Ok(new { version = settings.Value.Version, autoUpdate = settings.Value.AutoUpdate }))
            .WithTags("Agentes").RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        app.MapPost("/api/agents/{id:int}/update", UpdateOneAsync).WithTags("Agentes").RequireAuthorization(control);
        app.MapPost("/api/agents/update", UpdateManyAsync).WithTags("Agentes").RequireAuthorization(control);
        // Consulta do proprio agente por REST: atualiza mesmo quando o NATS nao esta funcionando.
        app.MapGet("/api/v3/{agentId}/update/", CheckForAgentAsync).RequireAuthorization(Policies.Agent).ExcludeFromDescription();
    }

    private static async Task<IResult> CheckForAgentAsync(System.Security.Claims.ClaimsPrincipal principal, CybereyesDbContext db,
        IOptions<AgentSettings> options, CancellationToken ct)
    {
        var pk = int.Parse(principal.FindFirst(CybereyesClaims.AgentPk)!.Value, CultureInfo.InvariantCulture);
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == pk).Select(a => new { a.Plat, a.GoArch }).FirstOrDefaultAsync(ct);
        var settings = options.Value;
        var message = agent is null ? null : Message(settings, agent.Plat, agent.GoArch);
        var sha = message?["payload"] is Dictionary<string, string> payload ? payload["sha256"] : string.Empty;
        return Results.Json(new Dictionary<string, object> { ["version"] = settings.Version, ["sha256"] = sha, ["auto_update"] = settings.AutoUpdate });
    }

    /// <summary>Mensagem NATS de atualizacao para a plataforma, ou nulo se o servidor nao tem o binario.</summary>
    public static Dictionary<string, object?>? Message(AgentSettings settings, string plat, string? goarch)
    {
        if (settings.FindBinary(plat, goarch ?? "amd64") is not { } path)
        {
            return null;
        }
        return new Dictionary<string, object?>
        {
            ["func"] = Func,
            ["payload"] = new Dictionary<string, string> { ["version"] = settings.Version, ["sha256"] = Sha256(path) },
        };
    }

    public static bool IsOutdated(string? current, string target) =>
        Version.TryParse(target, out var t) && (!Version.TryParse(current, out var c) || c < t);

    /// <summary>
    /// Primeira versao do EYES que nao deixa o Windows sem eyes.exe quando a troca do binario falha no meio. Ate a anterior, a
    /// troca renomeava eyes.exe para .old e, se o novo nao entrasse no lugar, nao desfazia: o servico seguia rodando pela imagem
    /// renomeada e nao subia mais no proximo boot (o agente ficava "em atraso" com a maquina ligada).
    /// </summary>
    public const string SafeSwapVersion = "3.4.1";

    /// <summary>
    /// Comando (cmd) que recoloca eyes.exe a partir do .old so quando ele falta e diz o que encontrou. Fica num arquivo para o
    /// CI rodar o mesmo texto num Windows de verdade (backend/tests/scripts/win-eyes-restaurar-binario.Tests.ps1).
    /// </summary>
    public static string RestoreBinaryCommand => RestoreScript.Value;

    private static readonly Lazy<string> RestoreScript = new(() =>
    {
        using var stream = typeof(AgentUpdates).Assembly.GetManifestResourceStream("Cybereyes.Scripts.win-eyes-restaurar-binario.cmd")
            ?? throw new InvalidOperationException("Comando de recuperacao do eyes.exe ausente do assembly");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd().Trim();
    });

    /// <summary>
    /// Depois de uma atualizacao que falhou num agente Windows anterior a <see cref="SafeSwapVersion"/> (a troca e feita pelo
    /// codigo da versao em execucao), confere o eyes.exe e o recoloca se ele sumiu. Devolve o resultado, ou nulo quando nao se aplica.
    /// </summary>
    public static async Task<string?> RestoreBinaryAfterFailureAsync(IAgentRpc rpc, string agentId, string plat, string? version, CancellationToken ct)
    {
        if (plat != "windows" || !IsOutdated(version, SafeSwapVersion))
        {
            return null;
        }
        try
        {
            var reply = await rpc.RequestAsync(agentId, new Dictionary<string, object?>
            {
                ["func"] = "rawcmd",
                ["timeout"] = 30,
                ["payload"] = new Dictionary<string, string> { ["command"] = RestoreBinaryCommand, ["shell"] = "cmd" },
                ["run_as_user"] = false,
            }, TimeSpan.FromSeconds(32), ct);
            return (reply as string)?.Trim();
        }
        catch (AgentRpcTimeoutException)
        {
            return "o agente nao respondeu a conferencia do eyes.exe";
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return null;
        }
    }

    private static string Sha256(string path)
    {
        var modified = File.GetLastWriteTimeUtc(path);
        if (Hashes.TryGetValue(path, out var cached) && cached.Modified == modified)
        {
            return cached.Hash;
        }
        using var stream = File.OpenRead(path);
        var hash = Convert.ToHexStringLower(SHA256.HashData(stream));
        Hashes[path] = (modified, hash);
        return hash;
    }

    private static async Task<IResult> UpdateOneAsync(int id, CybereyesDbContext db, IAgentRpc rpc, IOptions<AgentSettings> options, IAuditService audit,
        ProcedureLog procedures, CancellationToken ct)
    {
        var agent = await db.Agents.AsNoTracking().Where(a => a.Id == id).Select(a => new { a.AgentId, a.Hostname, a.Plat, a.GoArch, a.Version }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        var settings = options.Value;
        if (Message(settings, agent.Plat, agent.GoArch) is not { } message)
        {
            return Problems.Conflict($"Este servidor nao tem o EYES {settings.Version} para {agent.Plat}/{agent.GoArch}");
        }
        object? reply;
        try
        {
            reply = await rpc.RequestAsync(agent.AgentId, message, TimeSpan.FromMinutes(5), ct);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
        if (reply is string text && text.StartsWith("error", StringComparison.OrdinalIgnoreCase))
        {
            var restore = await RestoreBinaryAfterFailureAsync(rpc, agent.AgentId, agent.Plat, agent.Version, ct);
            return Problems.Validation("agent", restore is null ? text : $"{text} (conferencia do eyes.exe: {restore})");
        }
        if (reply is string unknown && unknown.Contains("unknown", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.Conflict("Este agente nao suporta atualizacao remota: reinstale pelo comando de implantacao");
        }
        await audit.LogAsync("agent.update", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"Atualizacao do EYES de {agent.Version} para {settings.Version} em {agent.Hostname}", cancellationToken: ct);
        await procedures.RecordAsync(id, ProcedureKind.AgentUpdate, $"{agent.Version} para {settings.Version}", ProcedureStatus.Ok, ct: ct);
        return TypedResults.Accepted((string?)null, new { version = settings.Version });
    }

    private static async Task<IResult> UpdateManyAsync(AgentUpdateRequest request, CybereyesDbContext db, IAgentRpc rpc, IOptions<AgentSettings> options,
        IAuditService audit, ProcedureLog procedures, CancellationToken ct)
    {
        var settings = options.Value;
        var query = db.Agents.AsNoTracking().Where(a => a.Status == AgentStatus.Online);
        if (request.AgentIds is { Length: > 0 } ids)
        {
            query = query.Where(a => ids.Contains(a.Id));
        }
        var agents = await query.Select(a => new { a.Id, a.AgentId, a.Plat, a.GoArch, a.Version }).ToListAsync(ct);
        var sent = 0;
        var actor = await procedures.CurrentActorAsync(ct);
        foreach (var a in agents.Where(a => IsOutdated(a.Version, settings.Version)))
        {
            if (Message(settings, a.Plat, a.GoArch) is { } message)
            {
                await rpc.PublishAsync(a.AgentId, message, ct);
                await procedures.RecordAsync(a.Id, ProcedureKind.AgentUpdate, $"{a.Version} para {settings.Version}", ProcedureStatus.Ok, actor: actor,
                    ct: ct);
                sent++;
            }
        }
        await audit.LogAsync("agent.update-bulk", "agent", null, $"Atualizacao do EYES para {settings.Version} enviada a {sent} agente(s)", cancellationToken: ct);
        return TypedResults.Ok(new { version = settings.Version, sent });
    }
}

/// <summary>
/// Atualiza sozinho, a cada 30 minutos, ate 25 agentes online com versao menor que a distribuida
/// (Agent:AutoUpdate, ligado por padrao). Cada envio vira um procedimento "Atualizacao do EYES" com a resposta do agente.
/// A escolha roda sob lock consultivo do PostgreSQL e grava as tentativas na mesma transacao: a outra replica, que roda
/// logo depois (o lock solta no commit), ja enxerga as tentativas e nao manda de novo. Um agente so recebe outra tentativa
/// da mesma versao depois de <see cref="RetryAfter"/> e no maximo <see cref="MaxAttempts"/> vezes; depois disso fica para
/// o "Atualizar EYES" do console, que mostra o erro na hora. O proprio agente ainda confere a versao a cada 6 horas.
/// </summary>
public sealed partial class AgentAutoUpdater(IServiceScopeFactory scopes, IOptions<AgentSettings> options, IAgentRpc rpc, TimeProvider time,
    ILogger<AgentAutoUpdater> logger) : BackgroundService
{
    public const int BatchSize = 25;
    public const int MaxAttempts = 3;
    public static readonly TimeSpan RetryAfter = TimeSpan.FromHours(6);

    /// <summary>O agente desiste de baixar, conferir e trocar o binario em 15 minutos.</summary>
    public static readonly TimeSpan ReplyTimeout = TimeSpan.FromMinutes(15);

    /// <summary>Se o agente pode receber mais uma tentativa da versao, pelo horario das tentativas anteriores.</summary>
    public static bool IsDue(IReadOnlyCollection<DateTimeOffset> attempts, DateTimeOffset now) =>
        attempts.Count < MaxAttempts && (attempts.Count == 0 || attempts.Max() <= now - RetryAfter);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var settings = options.Value;
        if (!settings.AutoUpdate)
        {
            return 0;
        }
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var procedures = scope.ServiceProvider.GetRequiredService<ProcedureLog>();
        var sends = new List<(AgentProcedure Procedure, string AgentId, string Plat, string Version, Dictionary<string, object?> Message)>();
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var locked = await db.Database.SqlQueryRaw<bool>("SELECT pg_try_advisory_xact_lock(hashtext('cybereyes-agent-update')) AS \"Value\"").SingleAsync(ct);
            if (!locked)
            {
                return 0;
            }
            var agents = await db.Agents.AsNoTracking().Where(a => a.Status == AgentStatus.Online)
                .Select(a => new { a.Id, a.AgentId, a.Plat, a.GoArch, a.Version }).ToListAsync(ct);
            // Agentes anteriores ao EYES (2.x) nao entendem "agentupdate": precisam ser reinstalados.
            var outdated = agents.Where(a => AgentUpdates.IsOutdated(a.Version, settings.Version)
                && Version.TryParse(a.Version, out var v) && v.Major >= 3).ToList();
            var ids = outdated.Select(a => a.Id).ToList();
            var attempts = (await db.AgentProcedures.IgnoreQueryFilters().AsNoTracking()
                    .Where(p => p.RefType == ProcedureRef.AutoUpdate && p.RefId == settings.Version && p.AgentId != null && ids.Contains(p.AgentId.Value))
                    .Select(p => new { AgentId = p.AgentId!.Value, p.StartedAt }).ToListAsync(ct))
                .ToLookup(p => p.AgentId, p => p.StartedAt);
            var now = time.GetUtcNow();
            var actor = new ProcedureActor(null, "Atualização automática", ProcedureSource.Console);
            foreach (var a in outdated.Where(a => IsDue(attempts[a.Id].ToList(), now)))
            {
                if (sends.Count == BatchSize)
                {
                    break;
                }
                if (AgentUpdates.Message(settings, a.Plat, a.GoArch) is not { } message)
                {
                    continue;
                }
                var procedure = await procedures.StartAsync(a.Id, ProcedureKind.AgentUpdate, $"{a.Version} para {settings.Version}",
                    refType: ProcedureRef.AutoUpdate, refId: settings.Version, actor: actor, ct: ct);
                if (procedure is not null)
                {
                    sends.Add((procedure, a.AgentId, a.Plat, a.Version, message));
                }
            }
            await tx.CommitAsync(ct);
        }
        if (sends.Count == 0)
        {
            return 0;
        }
        LogSent(logger, sends.Count, settings.Version);
        // Os agentes baixam ao mesmo tempo; os resultados sao gravados um a um (o contexto do banco nao aceita uso paralelo).
        var results = await Task.WhenAll(sends.Select(s => AwaitReplyAsync(s.AgentId, s.Message, ct)));
        for (var i = 0; i < sends.Count; i++)
        {
            var (status, detail) = results[i];
            if (status == ProcedureStatus.Error &&
                await AgentUpdates.RestoreBinaryAfterFailureAsync(rpc, sends[i].AgentId, sends[i].Plat, sends[i].Version, ct) is { } restore)
            {
                detail = $"{detail}\nConferencia do eyes.exe: {restore}";
            }
            await procedures.FinishAsync(sends[i].Procedure, status, detail, CancellationToken.None);
            if (status != ProcedureStatus.Ok)
            {
                LogAgentFailed(logger, sends[i].Procedure.Hostname, settings.Version, detail);
            }
        }
        return sends.Count;
    }

    private async Task<(string Status, string? Detail)> AwaitReplyAsync(string agentId, IReadOnlyDictionary<string, object?> message, CancellationToken ct)
    {
        try
        {
            var reply = await rpc.RequestAsync(agentId, message, ReplyTimeout, ct);
            return reply is string text && (text.StartsWith("error", StringComparison.OrdinalIgnoreCase) || text.Contains("unknown", StringComparison.OrdinalIgnoreCase))
                ? (ProcedureStatus.Error, text)
                : (ProcedureStatus.Ok, null);
        }
        catch (AgentRpcTimeoutException)
        {
            return (ProcedureStatus.Timeout, $"O agente nao respondeu em {ReplyTimeout.TotalMinutes:0} minutos");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return (ProcedureStatus.Cancelled, "O servidor reiniciou antes da resposta do agente");
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Atualizacao automatica do EYES {Version} enviada a {Count} agente(s)")]
    private static partial void LogSent(ILogger logger, int count, string version);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Atualizacao automatica do EYES {Version} falhou em {Hostname}: {Detail}")]
    private static partial void LogAgentFailed(ILogger logger, string hostname, string version, string? detail);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha na atualizacao automatica dos agentes")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
