using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Assistant;

public sealed record ConsoleExecutorDto(string Id, string Name, IReadOnlyList<string> Permissions);

/// <summary>
/// Item da conversa na tela: <c>request</c> (pedido do tecnico), <c>reply</c> (texto do agente) ou <c>action</c> (ferramenta,
/// com <see cref="Status"/> <c>running</c>, <c>pending</c>, <c>done</c>, <c>error</c> ou <c>rejected</c>).
/// </summary>
public sealed record ConsoleEntryDto(string Kind, string? Text, DateTimeOffset? At, string? Tool = null, string? Input = null, string? Result = null,
    string? Status = null);

public sealed record ConsoleSessionDto(Guid Id, string Title, string Executor, string ExecutorName, string Status, string? Error,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, IReadOnlyList<ConsoleEntryDto>? Entries = null);

public sealed record ConsoleStartRequest([property: Required] string Executor, [property: Required, StringLength(8000, MinimumLength = 1)] string Message);

public sealed record ConsoleMessageRequest([property: Required, StringLength(8000, MinimumLength = 1)] string Message);

public sealed record ConsoleApprovalRequest(bool Approve);

/// <summary>Menu Agente de IA: o tecnico com <c>assistant.use</c> pede acoes a um dos agentes ligados.</summary>
public static class ConsoleAgentEndpoints
{
    private const int ResultPreview = 4000;

    public static void MapConsoleAgentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/assistant/console").WithTags("Agente de IA")
            .RequireAuthorization(Policies.Permission(Permissions.AssistantUse));
        group.MapGet("/executors", ExecutorsAsync);
        group.MapGet("/sessions", ListAsync);
        group.MapPost("/sessions", StartAsync);
        group.MapGet("/sessions/{id:guid}", GetAsync);
        group.MapPost("/sessions/{id:guid}/messages", ContinueAsync);
        group.MapPost("/sessions/{id:guid}/approval", ApproveAsync);
    }

    private static async Task<IResult> ExecutorsAsync(ClaimsPrincipal principal, CybereyesDbContext db, ConsoleAgent agent, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        var result = new List<ConsoleExecutorDto>();
        foreach (var e in await agent.ExecutorsAsync(settings, ct))
        {
            // O que o agente faz para este tecnico: as permissoes do agente que ele tambem tem.
            var scope = await agent.TechnicianScopeAsync(principal.UserId()!.Value, e.Permissions, ct);
            result.Add(new ConsoleExecutorDto(e.Id, e.Name, scope?.Permissions ?? []));
        }
        return TypedResults.Ok(result);
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct)
    {
        var userId = principal.UserId();
        var sessions = await db.AssistantSessions.AsNoTracking().Where(s => s.UserId == userId)
            .OrderByDescending(s => s.UpdatedAt).Take(30).ToListAsync(ct);
        return TypedResults.Ok(sessions.Select(s => ToDto(s, time.GetUtcNow(), false)));
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, CybereyesDbContext db, TimeProvider time, CancellationToken ct) =>
        await MineAsync(db, id, principal, ct) is { } session ? TypedResults.Ok(ToDto(session, time.GetUtcNow(), true)) : Problems.NotFound("Conversa");

    private static async Task<IResult> StartAsync(ConsoleStartRequest r, HttpContext http, ClaimsPrincipal principal, CybereyesDbContext db,
        ConsoleAgent agent, ConsoleAgentOutbox outbox, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        if ((await agent.ExecutorsAsync(settings, ct)).FirstOrDefault(e => e.Id == r.Executor) is not { } executor)
        {
            return Problems.Validation("executor", "Agente desligado ou inexistente; veja Configuracoes > Assistente de IA");
        }
        var message = r.Message.Trim();
        var now = time.GetUtcNow();
        var session = new AssistantSession
        {
            Id = Guid.NewGuid(),
            UserId = principal.UserId()!.Value,
            Executor = executor.Id,
            ExecutorName = executor.Name,
            Title = Flatten(message, 200),
            Status = AssistantSessionStatus.Running,
            Messages = JsonSerializer.Serialize(new List<AgentMessage> { new("user", [AgentBlock.FromText(message)], now) }, ConsoleAgent.Json),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.AssistantSessions.Add(session);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("assistant.request", "assistant_session", session.Id.ToString(), Flatten($"Pedido ao agente {executor.Name}: {message}", 1000),
            cancellationToken: ct);
        outbox.Enqueue(session.Id, http.Connection.RemoteIpAddress?.ToString());
        return TypedResults.Accepted($"/api/assistant/console/sessions/{session.Id}", ToDto(session, now, true));
    }

    private static async Task<IResult> ContinueAsync(Guid id, ConsoleMessageRequest r, HttpContext http, ClaimsPrincipal principal, CybereyesDbContext db,
        ConsoleAgentOutbox outbox, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (await MineAsync(db, id, principal, ct) is not { } session)
        {
            return Problems.NotFound("Conversa");
        }
        var now = time.GetUtcNow();
        if (Busy(session, now))
        {
            return Problems.Conflict(session.Status == AssistantSessionStatus.AwaitingApproval
                ? "Aprove ou recuse a acao pendente antes de pedir outra coisa"
                : "O agente ainda esta trabalhando no pedido anterior");
        }
        var message = r.Message.Trim();
        var messages = ConsoleAgent.ReadMessages(session.Messages);
        // Depois de resultados de ferramenta a ultima mensagem ja e do tecnico: o pedido novo entra junto.
        if (messages.Count > 0 && messages[^1].Role == "user")
        {
            messages[^1] = messages[^1] with { Content = [.. messages[^1].Content, AgentBlock.FromText(message)], At = now };
        }
        else
        {
            messages.Add(new AgentMessage("user", [AgentBlock.FromText(message)], now));
        }
        session.Messages = JsonSerializer.Serialize(messages, ConsoleAgent.Json);
        session.Status = AssistantSessionStatus.Running;
        session.Error = null;
        session.Pending = null;
        session.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("assistant.request", "assistant_session", session.Id.ToString(),
            Flatten($"Pedido ao agente {session.ExecutorName}: {message}", 1000), cancellationToken: ct);
        outbox.Enqueue(session.Id, http.Connection.RemoteIpAddress?.ToString());
        return TypedResults.Accepted($"/api/assistant/console/sessions/{session.Id}", ToDto(session, now, true));
    }

    private static async Task<IResult> ApproveAsync(Guid id, ConsoleApprovalRequest r, HttpContext http, ClaimsPrincipal principal, CybereyesDbContext db,
        ConsoleAgentOutbox outbox, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (await MineAsync(db, id, principal, ct) is not { } session)
        {
            return Problems.NotFound("Conversa");
        }
        if (session.Status != AssistantSessionStatus.AwaitingApproval || ConsoleAgent.ReadPending(session.Pending) is not { } pending)
        {
            return Problems.Conflict("Nao ha acao esperando aprovacao nesta conversa");
        }
        var now = time.GetUtcNow();
        session.Pending = JsonSerializer.Serialize(pending with { Approved = r.Approve }, ConsoleAgent.Json);
        session.Status = AssistantSessionStatus.Running;
        session.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        var actions = string.Join("; ", pending.Calls.Select(c => $"{c.Name} {c.Input?.GetRawText()}"));
        await audit.LogAsync(r.Approve ? "assistant.approved" : "assistant.rejected", "assistant_session", session.Id.ToString(),
            Flatten($"{(r.Approve ? "Aprovou" : "Recusou")} para o agente {session.ExecutorName}: {actions}", 2000), cancellationToken: ct);
        outbox.Enqueue(session.Id, http.Connection.RemoteIpAddress?.ToString());
        return TypedResults.Accepted($"/api/assistant/console/sessions/{session.Id}", ToDto(session, now, true));
    }

    private static Task<AssistantSession?> MineAsync(CybereyesDbContext db, Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.UserId();
        return db.AssistantSessions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId, ct);
    }

    /// <summary>Executando ha mais de <see cref="ConsoleAgent.Stale"/> sem sinal: a replica caiu no meio e a conversa fica livre.</summary>
    private static bool Busy(AssistantSession s, DateTimeOffset now) =>
        s.Status == AssistantSessionStatus.AwaitingApproval || (s.Status == AssistantSessionStatus.Running && now - s.UpdatedAt < ConsoleAgent.Stale);

    private static ConsoleSessionDto ToDto(AssistantSession s, DateTimeOffset now, bool withEntries)
    {
        var interrupted = s.Status == AssistantSessionStatus.Running && now - s.UpdatedAt >= ConsoleAgent.Stale;
        return new ConsoleSessionDto(s.Id, s.Title, s.Executor, s.ExecutorName, interrupted ? AssistantSessionStatus.Failed : s.Status,
            interrupted ? "A execucao foi interrompida; peca de novo" : s.Error, s.CreatedAt, s.UpdatedAt, withEntries ? Entries(s) : null);
    }

    private static List<ConsoleEntryDto> Entries(AssistantSession s)
    {
        var entries = new List<ConsoleEntryDto>();
        var actions = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var message in ConsoleAgent.ReadMessages(s.Messages))
        {
            foreach (var block in message.Content)
            {
                switch (block.Type)
                {
                    case "text" when message.Role == "user":
                        entries.Add(new ConsoleEntryDto("request", block.Text, message.At));
                        break;
                    case "text" when !string.IsNullOrWhiteSpace(block.Text):
                        entries.Add(new ConsoleEntryDto("reply", block.Text, message.At));
                        break;
                    case "tool_use":
                        actions[block.Id!] = entries.Count;
                        entries.Add(new ConsoleEntryDto("action", null, message.At, block.Name, block.Input?.GetRawText(), Status: "running"));
                        break;
                    case "tool_result" when actions.TryGetValue(block.ToolUseId ?? string.Empty, out var index):
                        var text = block.Text ?? string.Empty;
                        entries[index] = entries[index] with
                        {
                            Result = text.Length <= ResultPreview ? text : text[..ResultPreview] + "…",
                            Status = text == ConsoleAgent.RejectedText ? "rejected" : block.IsError == true ? "error" : "done",
                        };
                        break;
                }
            }
        }
        if (s.Status == AssistantSessionStatus.AwaitingApproval && ConsoleAgent.ReadPending(s.Pending) is { } pending)
        {
            foreach (var done in pending.Results)
            {
                if (actions.TryGetValue(done.ToolUseId ?? string.Empty, out var index))
                {
                    entries[index] = entries[index] with { Result = done.Text, Status = done.IsError == true ? "error" : "done" };
                }
            }
            foreach (var call in pending.Calls)
            {
                if (actions.TryGetValue(call.Id ?? string.Empty, out var index))
                {
                    entries[index] = entries[index] with { Status = "pending" };
                }
            }
        }
        return entries;
    }

    private static string Flatten(string text, int max)
    {
        var flat = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return flat.Length <= max ? flat : flat[..(max - 1)] + "…";
    }
}
