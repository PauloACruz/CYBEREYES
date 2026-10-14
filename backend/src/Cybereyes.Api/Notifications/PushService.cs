using System.Buffers.Text;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Notifications;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;
using Cybereyes.Core.Tickets;

namespace Cybereyes.Api.Notifications;

public enum TicketPushKind
{
    Opened,
    Message,
    Assigned,
    Status,
    Priority,
}

/// <summary>Evento de chamado a avisar por push. Texto e destinatarios saem no despachante, fora da requisicao.</summary>
public sealed record TicketPush(TicketPushKind Kind, int TicketId, Guid? ActorId, string? AuthorType = null, string? AuthorName = null,
    string? Text = null, bool Internal = false);

/// <summary>Conteudo que o service worker mostra: titulo, texto, tela aberta no toque e etiqueta (substitui o aviso anterior do chamado).</summary>
public sealed record PushMessage(string Title, string Body, string Url, string Tag);

public sealed record PushResult(bool Delivered, bool Gone, int? StatusCode, string? Error);

public interface IPushTransport
{
    Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct);
}

/// <summary>Chaves VAPID do servidor: geradas no primeiro uso, gravadas em core_settings e iguais em todas as replicas.</summary>
public sealed class PushKeyStore(IServiceScopeFactory scopes, IDataProtectionProvider protection) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private VapidKeys? cached;

    public async Task<VapidKeys> GetAsync(CancellationToken ct)
    {
        if (cached is { } ready)
        {
            return ready;
        }
        await gate.WaitAsync(ct);
        try
        {
            if (cached is { } again)
            {
                return again;
            }
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            var protector = protection.CreateProtector(DataProtectionNames.PushVapidPurpose);
            var settings = await SettingsStore.GetAsync(db, ct);
            if (settings.PushPublicKey is null || settings.PushPrivateKeyProtected is null)
            {
                // Duas replicas podem gerar juntas: so a primeira grava, e as duas usam o que ficou no banco.
                var generated = VapidKeys.Generate();
                var protectedKey = protector.Protect(generated.PrivateKey);
                await db.CoreSettings.Where(s => s.Id == settings.Id && s.PushPublicKey == null)
                    .ExecuteUpdateAsync(u => u.SetProperty(s => s.PushPublicKey, generated.PublicKey)
                        .SetProperty(s => s.PushPrivateKeyProtected, protectedKey), ct);
                await db.Entry(settings).ReloadAsync(ct);
            }
            cached = new VapidKeys(settings.PushPublicKey!, protector.Unprotect(settings.PushPrivateKeyProtected!));
            return cached;
        }
        finally
        {
            gate.Release();
        }
    }

    public void Dispose() => gate.Dispose();
}

/// <summary>Envia pelo servico de push do navegador (FCM, Mozilla, WNS ou Apple) a mensagem cifrada e assinada.</summary>
public sealed class WebPushTransport(IHttpClientFactory http, PushKeyStore keys, IConfiguration config, TimeProvider time) : IPushTransport
{
    public const string HttpClientName = "webpush";

    public async Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        var vapid = await keys.GetAsync(ct);
        var payload = JsonSerializer.SerializeToUtf8Bytes(message, JsonSerializerOptions.Web);
        var body = WebPushCrypto.Encrypt(payload, PushKeys.Decode(subscription.P256dh), PushKeys.Decode(subscription.Auth));
        var endpoint = new Uri(subscription.Endpoint);

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", "86400");
        request.Headers.TryAddWithoutValidation("Urgency", "high");
        request.Headers.TryAddWithoutValidation("Authorization", WebPushCrypto.VapidAuthorization(endpoint, Subject(), vapid, time.GetUtcNow()));
        try
        {
            using var response = await http.CreateClient(HttpClientName).SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
            {
                return new PushResult(true, false, (int)response.StatusCode, null);
            }
            var detail = await response.Content.ReadAsStringAsync(ct);
            var gone = response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone;
            return new PushResult(false, gone, (int)response.StatusCode, detail.Length > 300 ? detail[..300] : detail);
        }
        catch (HttpRequestException ex)
        {
            return new PushResult(false, false, null, ex.Message);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return new PushResult(false, false, null, "O servico de push nao respondeu a tempo");
        }
    }

    /// <summary>Contato do remetente exigido pelos servicos de push: o endereco publico do console.</summary>
    private string Subject() =>
        Uri.TryCreate(config["App:PublicUrl"], UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps
            ? url.GetLeftPart(UriPartial.Authority)
            : "mailto:no-reply@cybereyes.local";
}

public static class PushKeys
{
    /// <summary>Servicos de push dos navegadores. O servidor so faz POST nesses enderecos (evita SSRF por inscricao forjada).</summary>
    private static readonly string[] Hosts = ["fcm.googleapis.com", "android.googleapis.com", ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

    public static bool AllowedEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo) &&
        Hosts.Any(h => h.StartsWith('.') ? uri.Host.EndsWith(h, StringComparison.OrdinalIgnoreCase) : uri.Host.Equals(h, StringComparison.OrdinalIgnoreCase));

    public static byte[] Decode(string value) => Base64Url.DecodeFromChars(value.Trim().TrimEnd('='));

    public static bool TryDecode(string value, out byte[] bytes)
    {
        try
        {
            bytes = Decode(value);
            return true;
        }
        catch (FormatException)
        {
            bytes = [];
            return false;
        }
    }
}

/// <summary>Fila dos avisos de chamado: a requisicao so enfileira; quem fez a acao (usuario logado) nao recebe o aviso.</summary>
public sealed class PushOutbox(IHttpContextAccessor accessor)
{
    private readonly Channel<TicketPush> channel = Channel.CreateUnbounded<TicketPush>(new UnboundedChannelOptions { SingleReader = true });

    public ChannelReader<TicketPush> Reader => channel.Reader;

    public void Ticket(TicketPushKind kind, int ticketId, string? authorType = null, string? authorName = null, string? text = null, bool isInternal = false) =>
        channel.Writer.TryWrite(new TicketPush(kind, ticketId, accessor.HttpContext?.User.UserId(), authorType, authorName, text, isInternal));
}

/// <summary>Monta o aviso de cada evento, escolhe os aparelhos que podem ve-lo e envia; inscricoes que o navegador descartou saem do banco.</summary>
public sealed partial class PushDispatcher(PushOutbox queue, IServiceScopeFactory scopes, IPushTransport transport, TimeProvider time, ILogger<PushDispatcher> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var item in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await DispatchAsync(item, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogDispatchFailed(logger, ex, item.Kind, item.TicketId);
            }
        }
    }

    private async Task DispatchAsync(TicketPush item, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
        var ticket = await db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == item.TicketId, ct);
        if (ticket is null)
        {
            return;
        }
        var targets = await TargetsAsync(db, item, ticket, ct);
        if (targets.Count == 0)
        {
            return;
        }
        var clientName = ticket.ClientId is { } clientId
            ? await db.Clients.AsNoTracking().Where(c => c.Id == clientId).Select(c => c.Name).FirstOrDefaultAsync(ct)
            : null;
        var message = Compose(item, ticket, clientName);

        var results = await Task.WhenAll(targets.Select(async s => (Subscription: s, Result: await transport.SendAsync(s, message, ct))));
        var gone = results.Where(r => r.Result.Gone).Select(r => r.Subscription.Id).ToList();
        var delivered = results.Where(r => r.Result.Delivered).Select(r => r.Subscription.Id).ToList();
        foreach (var (subscription, result) in results.Where(r => !r.Result.Delivered && !r.Result.Gone))
        {
            LogRejected(logger, subscription.Id, result.StatusCode, result.Error);
        }
        if (gone.Count > 0)
        {
            await db.PushSubscriptions.Where(s => gone.Contains(s.Id)).ExecuteDeleteAsync(ct);
        }
        if (delivered.Count > 0)
        {
            var now = time.GetUtcNow();
            await db.PushSubscriptions.Where(s => delivered.Contains(s.Id)).ExecuteUpdateAsync(u => u.SetProperty(s => s.LastSentAt, now), ct);
        }
    }

    /// <summary>
    /// Destinatarios: chamado novo sem responsavel e mensagem do solicitante vao para todos que veem o cliente (com responsavel,
    /// so para ele); nota ou resposta de outro tecnico, atribuicao e mudancas, so para o responsavel. Quem fez a acao fica de fora.
    /// </summary>
    private static async Task<List<PushSubscription>> TargetsAsync(CybereyesDbContext db, TicketPush item, Ticket ticket, CancellationToken ct)
    {
        Guid? only = item.Kind switch
        {
            TicketPushKind.Opened => ticket.AssignedToId,
            TicketPushKind.Message when item.AuthorType == MessageAuthor.Requester => ticket.AssignedToId,
            _ => ticket.AssignedToId ?? Guid.Empty,
        };
        if (only == Guid.Empty)
        {
            return [];
        }

        var query = db.PushSubscriptions.AsNoTracking();
        query = item.Kind switch
        {
            TicketPushKind.Opened => query.Where(s => s.NewTickets),
            TicketPushKind.Message => query.Where(s => s.Messages),
            _ => query.Where(s => s.Updates),
        };
        if (only is { } userId)
        {
            query = query.Where(s => s.UserId == userId);
        }
        if (item.ActorId is { } actor)
        {
            query = query.Where(s => s.UserId != actor);
        }
        var subscriptions = await query.ToListAsync(ct);
        if (subscriptions.Count == 0)
        {
            return [];
        }

        var userIds = subscriptions.Select(s => s.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id) && u.IsActive)
            .Select(u => new { u.Id, u.AllClients }).ToDictionaryAsync(u => u.Id, u => u.AllClients, ct);
        var roles = await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where userIds.Contains(ur.UserId)
            select new { ur.UserId, r.IsSuperuser, r.Permissions }).ToListAsync(ct);
        var withClient = ticket.ClientId is { } clientId
            ? (await db.UserClients.AsNoTracking().Where(uc => userIds.Contains(uc.UserId) && uc.ClientId == clientId).Select(uc => uc.UserId).ToListAsync(ct)).ToHashSet()
            : [];

        bool CanSee(Guid userId)
        {
            if (!users.TryGetValue(userId, out var allClients))
            {
                return false;
            }
            var mine = roles.Where(r => r.UserId == userId).ToList();
            if (mine.Any(r => r.IsSuperuser))
            {
                return true;
            }
            if (!mine.Any(r => r.Permissions.Contains(Permissions.TicketsView)))
            {
                return false;
            }
            // Mesma regra do filtro de chamados do DbContext para quem ve so alguns clientes.
            return allClients || (ticket.ClientId is not null ? withClient.Contains(userId) : ticket.CreatedById == userId || ticket.AssignedToId == userId);
        }

        return subscriptions.Where(s => CanSee(s.UserId)).ToList();
    }

    private static PushMessage Compose(TicketPush item, Ticket ticket, string? clientName)
    {
        var number = $"#{ticket.Id}";
        var (title, body) = item.Kind switch
        {
            TicketPushKind.Opened => (ticket.AssignedToId is null ? $"Novo chamado {number}" : $"Novo chamado {number} atribuído a você",
                Join(ticket.Title, Join(ticket.RequesterName, clientName))),
            TicketPushKind.Message => ($"{number} · {(item.Internal ? "Nota interna" : "Mensagem")} de {item.AuthorName}", Excerpt(item.Text ?? string.Empty)),
            TicketPushKind.Assigned => ($"{number} atribuído a você", ticket.Title),
            TicketPushKind.Status => ($"{number} agora está {StatusLabel(ticket.Status)}", ticket.Title),
            _ => ($"{number} com prioridade {PriorityLabel(ticket.Priority)}", ticket.Title),
        };
        return new PushMessage(title, body, $"/chamados/{ticket.Id}", $"chamado-{ticket.Id}");
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao enviar o aviso {Kind} do chamado {TicketId}")]
    private static partial void LogDispatchFailed(ILogger logger, Exception exception, TicketPushKind kind, int ticketId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Push recusado para a inscricao {Id} ({Status}): {Error}")]
    private static partial void LogRejected(ILogger logger, long id, int? status, string? error);

    private static string Join(string? first, string? second) =>
        string.IsNullOrWhiteSpace(second) ? first ?? string.Empty : string.IsNullOrWhiteSpace(first) ? second : $"{first} · {second}";

    private static string Excerpt(string text)
    {
        var flat = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return flat.Length <= 180 ? flat : $"{flat[..179]}…";
    }

    private static string StatusLabel(string status) => status switch
    {
        TicketStatus.New => "novo",
        TicketStatus.InProgress => "em atendimento",
        TicketStatus.WaitingUser => "aguardando o usuário",
        TicketStatus.Resolved => "resolvido",
        TicketStatus.Closed => "fechado",
        _ => status,
    };

    private static string PriorityLabel(string priority) => priority switch
    {
        TicketPriority.Low => "baixa",
        TicketPriority.Medium => "média",
        TicketPriority.High => "alta",
        TicketPriority.Critical => "crítica",
        _ => priority,
    };
}
