using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Rmm.Procedures;

/// <summary>Quem fez o procedimento: o tecnico logado (com id) ou o usuario da maquina pelo app de bandeja (sem id).</summary>
public sealed record ProcedureActor(Guid? UserId, string Name, string Source);

/// <summary>
/// Registra os procedimentos feitos nos agentes: abre ao comecar, conclui com o resultado e a duracao, e inclui no chamado como
/// apontamento de horas. Usa o mesmo contexto do banco da acao, entao grava junto com ela.
/// </summary>
public sealed class ProcedureLog(CybereyesDbContext db, IHttpContextAccessor http, TimeProvider time)
{
    public const int MaxMinutes = 1440;

    /// <summary>O tecnico da requisicao atual; fora de uma requisicao, "sistema".</summary>
    public async Task<ProcedureActor> CurrentActorAsync(CancellationToken ct)
    {
        var principal = http.HttpContext?.User;
        if (principal?.UserId() is not { } userId)
        {
            return new ProcedureActor(null, principal?.Identity?.Name ?? "sistema", ProcedureSource.Console);
        }
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.FullName, u.UserName }).FirstOrDefaultAsync(ct);
        var name = string.IsNullOrWhiteSpace(user?.FullName) ? user?.UserName ?? principal.Identity?.Name ?? "?" : user.FullName;
        return new ProcedureActor(userId, name, ProcedureSource.Console);
    }

    /// <summary>Abre um procedimento em andamento. Devolve nulo se o agente nao existe mais.</summary>
    public async Task<AgentProcedure?> StartAsync(int agentId, string kind, string title, string? detail = null, int? ticketId = null,
        string? refType = null, string? refId = null, ProcedureActor? actor = null, CancellationToken ct = default)
    {
        var procedure = await NewAsync(agentId, kind, title, detail, actor, ct);
        if (procedure is null)
        {
            return null;
        }
        procedure.TicketId = ticketId;
        procedure.RefType = refType;
        procedure.RefId = refId;
        db.AgentProcedures.Add(procedure);
        await db.SaveChangesAsync(ct);
        return procedure;
    }

    /// <summary>Procedimento que comecou e terminou agora (ou em <paramref name="startedAt"/>), gravado de uma vez.</summary>
    public async Task<AgentProcedure?> RecordAsync(int agentId, string kind, string title, string status, string? detail = null,
        DateTimeOffset? startedAt = null, ProcedureActor? actor = null, CancellationToken ct = default)
    {
        var procedure = await NewAsync(agentId, kind, title, detail, actor, ct);
        if (procedure is null)
        {
            return null;
        }
        if (startedAt is { } start)
        {
            procedure.StartedAt = start;
        }
        Complete(procedure, status, time.GetUtcNow());
        db.AgentProcedures.Add(procedure);
        await db.SaveChangesAsync(ct);
        return procedure;
    }

    /// <summary>Conclui o procedimento com o resultado; se ele nasceu ligado a um chamado, ja entra no tempo do chamado.</summary>
    public async Task FinishAsync(AgentProcedure? procedure, string status, string? detail = null, CancellationToken ct = default)
    {
        if (procedure is null || procedure.Status != ProcedureStatus.Running)
        {
            return;
        }
        Complete(procedure, status, time.GetUtcNow());
        if (detail is not null)
        {
            procedure.Detail = Truncate(detail, 2000);
        }
        await db.SaveChangesAsync(ct);
        if (procedure is { TicketId: { } ticketId, TimeEntryId: null, UserId: { } userId } &&
            await db.Tickets.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == ticketId, ct) is { } ticket)
        {
            await IncludeAsync(procedure, ticket, DefaultMinutes(procedure), null, userId, ct);
        }
    }

    /// <summary>Conclui o procedimento aberto pela origem (sessao remota, execucao do Care...), se ainda estiver em andamento.</summary>
    public async Task FinishByRefAsync(string refType, string refId, string status, string? detail = null, CancellationToken ct = default)
    {
        var procedure = await db.AgentProcedures.IgnoreQueryFilters()
            .Where(p => p.RefType == refType && p.RefId == refId && p.Status == ProcedureStatus.Running)
            .OrderByDescending(p => p.Id).FirstOrDefaultAsync(ct);
        await FinishAsync(procedure, status, detail, ct);
    }

    /// <summary>
    /// Roda a acao como um procedimento: conclui com o status que a resposta indicar, "timeout" quando o agente nao responde e
    /// "error" em qualquer outra falha, sem engolir a excecao.
    /// </summary>
    public async Task<T> TrackAsync<T>(int agentId, string kind, string title, string? detail, Func<Task<T>> action, Func<T, string> statusOf,
        CancellationToken ct)
    {
        var procedure = await StartAsync(agentId, kind, title, detail, ct: ct);
        T result;
        try
        {
            result = await action();
        }
        catch (AgentRpcTimeoutException)
        {
            await FinishAsync(procedure, ProcedureStatus.Timeout, ct: CancellationToken.None);
            throw;
        }
        catch
        {
            await FinishAsync(procedure, ProcedureStatus.Error, ct: CancellationToken.None);
            throw;
        }
        await FinishAsync(procedure, statusOf(result), ct: CancellationToken.None);
        return result;
    }

    /// <summary>Status de um IResult: respostas de erro (4xx e 5xx) contam como falha do procedimento.</summary>
    public static string StatusOf(IResult result) => result switch
    {
        IStatusCodeHttpResult { StatusCode: 504 } => ProcedureStatus.Timeout,
        IStatusCodeHttpResult { StatusCode: >= 400 } => ProcedureStatus.Error,
        _ => ProcedureStatus.Ok,
    };

    /// <summary>Inclui o procedimento no chamado como um apontamento de horas e devolve o apontamento.</summary>
    public async Task<TimeEntry> IncludeAsync(AgentProcedure procedure, Ticket ticket, int minutes, string? description, Guid fallbackUserId,
        CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        var zone = TimeZoneInfo.TryFindSystemTimeZoneById(settings.TimeZone, out var tz) ? tz : TimeZoneInfo.Utc;
        var entry = new TimeEntry
        {
            TicketId = ticket.Id,
            UserId = procedure.UserId ?? fallbackUserId,
            Minutes = Math.Clamp(minutes, 1, MaxMinutes),
            Description = Truncate(string.IsNullOrWhiteSpace(description) ? Describe(procedure) : description.Trim(), 1000),
            WorkDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(procedure.StartedAt, zone).DateTime),
            CreatedAt = time.GetUtcNow(),
        };
        db.TimeEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        procedure.TicketId = ticket.Id;
        procedure.TimeEntryId = entry.Id;
        await db.SaveChangesAsync(ct);
        return entry;
    }

    /// <summary>Tempo de servico sugerido: a duracao arredondada para cima em minutos, de 1 a 1440.</summary>
    public static int DefaultMinutes(AgentProcedure procedure) =>
        Math.Clamp((int)Math.Ceiling((procedure.DurationSeconds ?? 0) / 60.0), 1, MaxMinutes);

    /// <summary>Descricao do apontamento: o tipo, o que foi feito e a maquina.</summary>
    public static string Describe(AgentProcedure procedure)
    {
        var label = ProcedureLabels.Of(procedure.Kind);
        return string.IsNullOrWhiteSpace(procedure.Title)
            ? $"{label} em {procedure.Hostname}"
            : $"{label} em {procedure.Hostname}: {procedure.Title}";
    }

    private async Task<AgentProcedure?> NewAsync(int agentId, string kind, string title, string? detail, ProcedureActor? actor, CancellationToken ct)
    {
        var agent = await db.Agents.IgnoreQueryFilters().AsNoTracking().Where(a => a.Id == agentId)
            .Select(a => new { a.Hostname, a.Site!.ClientId }).FirstOrDefaultAsync(ct);
        if (agent is null)
        {
            return null;
        }
        actor ??= await CurrentActorAsync(ct);
        return new AgentProcedure
        {
            AgentId = agentId,
            ClientId = agent.ClientId,
            Hostname = agent.Hostname,
            Kind = kind,
            Title = Truncate(title.Trim(), 500),
            Detail = detail is null ? null : Truncate(detail, 2000),
            Source = actor.Source,
            UserId = actor.UserId,
            UserName = Truncate(actor.Name, 256),
            StartedAt = time.GetUtcNow(),
        };
    }

    private static void Complete(AgentProcedure procedure, string status, DateTimeOffset now)
    {
        procedure.Status = status;
        procedure.FinishedAt = now;
        procedure.DurationSeconds = Math.Max(0, (int)Math.Round((now - procedure.StartedAt).TotalSeconds));
    }

    public static string Truncate(string text, int max) => text.Length <= max ? text : text[..max];

    /// <summary>Texto numa linha so (comandos de varias linhas viram o titulo do procedimento).</summary>
    public static string OneLine(string text) => string.Join(' ', text.Split((char[])['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
}

/// <summary>Nomes dos tipos de procedimento usados nos apontamentos e nos chamados.</summary>
public static class ProcedureLabels
{
    public static string Of(string kind) => kind switch
    {
        ProcedureKind.Remote => "Acesso remoto",
        ProcedureKind.Files => "Arquivos",
        ProcedureKind.Care => "Cybereyes Care",
        ProcedureKind.Command => "Comando",
        ProcedureKind.Script => "Script",
        ProcedureKind.Terminal => "Terminal",
        ProcedureKind.Rename => "Alteração do hostname",
        ProcedureKind.Reboot => "Reinício",
        ProcedureKind.Shutdown => "Desligamento",
        ProcedureKind.Service => "Serviço",
        ProcedureKind.Process => "Processo encerrado",
        ProcedureKind.Registry => "Registro do Windows",
        ProcedureKind.Software => "Instalação de software",
        ProcedureKind.Updates => "Atualizações do Windows",
        ProcedureKind.Task => "Tarefa",
        ProcedureKind.Wake => "Wake-on-LAN",
        ProcedureKind.AgentUpdate => "Atualização do EYES",
        _ => kind,
    };
}
