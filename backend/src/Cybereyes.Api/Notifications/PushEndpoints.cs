using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Notifications;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Notifications;

public sealed record PushConfigDto(string PublicKey);

public sealed record PushSubscriptionRequest(
    [property: Required, StringLength(2000)] string Endpoint,
    [property: Required, StringLength(200)] string P256dh,
    [property: Required, StringLength(100)] string Auth,
    [property: StringLength(100)] string? Device,
    bool NewTickets, bool Updates, bool Messages, bool Insights = true);

public sealed record PushSubscriptionDto(string Endpoint, string? Device, bool NewTickets, bool Updates, bool Messages, bool Insights, DateTimeOffset CreatedAt,
    DateTimeOffset? LastSentAt);

public sealed record PushEndpointRequest([property: Required, StringLength(2000)] string Endpoint);

public sealed record PushTestResult(bool Delivered, string? Error);

/// <summary>Inscricao do aparelho no Web Push (avisos de chamados), por usuario logado: cada um so ve e muda as proprias.</summary>
public static class PushEndpoints
{
    public static void MapPushEndpoints(this IEndpointRouteBuilder app)
    {
        var push = app.MapGroup("/api/push").WithTags("Notificacoes").RequireAuthorization();
        push.MapGet("/config", async (PushKeyStore keys, CancellationToken ct) => TypedResults.Ok(new PushConfigDto((await keys.GetAsync(ct)).PublicKey)));
        push.MapPost("/subscription/find", FindAsync);
        push.MapPut("/subscription", SaveAsync);
        push.MapPost("/subscription/delete", DeleteAsync);
        push.MapPost("/test", TestAsync);
    }

    private static async Task<IResult> FindAsync(PushEndpointRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var userId = principal.UserId();
        var subscription = await db.PushSubscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.Endpoint == r.Endpoint && s.UserId == userId, ct);
        return subscription is null ? Problems.NotFound("Inscricao") : TypedResults.Ok(ToDto(subscription));
    }

    private static async Task<IResult> SaveAsync(PushSubscriptionRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        if (principal.UserId() is not { } userId)
        {
            return Problems.Forbidden("So usuarios do console recebem notificacoes");
        }
        if (!PushKeys.AllowedEndpoint(r.Endpoint))
        {
            return Problems.Validation("endpoint", "Endereco de push desconhecido");
        }
        if (!PushKeys.TryDecode(r.P256dh, out var publicKey) || !WebPushCrypto.IsValidPublicKey(publicKey))
        {
            return Problems.Validation("p256dh", "Chave do aparelho invalida");
        }
        if (!PushKeys.TryDecode(r.Auth, out var auth) || auth.Length != 16)
        {
            return Problems.Validation("auth", "Segredo do aparelho invalido");
        }

        // O mesmo navegador pode trocar de usuario: a inscricao passa para quem entrou por ultimo.
        var subscription = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == r.Endpoint, ct);
        if (subscription is null)
        {
            subscription = new PushSubscription { Endpoint = r.Endpoint, P256dh = r.P256dh, Auth = r.Auth, UserId = userId };
            db.PushSubscriptions.Add(subscription);
        }
        subscription.UserId = userId;
        subscription.P256dh = r.P256dh;
        subscription.Auth = r.Auth;
        subscription.Device = string.IsNullOrWhiteSpace(r.Device) ? null : r.Device.Trim();
        subscription.NewTickets = r.NewTickets;
        subscription.Updates = r.Updates;
        subscription.Messages = r.Messages;
        subscription.Insights = r.Insights;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(subscription));
    }

    private static async Task<IResult> DeleteAsync(PushEndpointRequest r, ClaimsPrincipal principal, CybereyesDbContext db, CancellationToken ct)
    {
        var userId = principal.UserId();
        await db.PushSubscriptions.Where(s => s.Endpoint == r.Endpoint && s.UserId == userId).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> TestAsync(PushEndpointRequest r, ClaimsPrincipal principal, CybereyesDbContext db, IPushTransport transport,
        CancellationToken ct)
    {
        var userId = principal.UserId();
        var subscription = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == r.Endpoint && s.UserId == userId, ct);
        if (subscription is null)
        {
            return Problems.NotFound("Inscricao");
        }
        var result = await transport.SendAsync(subscription,
            new PushMessage("Notificações ativas", "Este aparelho vai receber os avisos dos chamados.", "/", "teste"), ct);
        if (result.Gone)
        {
            db.PushSubscriptions.Remove(subscription);
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new PushTestResult(false, "O navegador cancelou a inscricao deste aparelho. Ative as notificacoes de novo."));
        }
        return TypedResults.Ok(new PushTestResult(result.Delivered,
            result.Delivered ? null : $"O servico de push recusou o envio{(result.StatusCode is { } code ? $" (HTTP {code})" : string.Empty)}."));
    }

    private static PushSubscriptionDto ToDto(PushSubscription s) =>
        new(s.Endpoint, s.Device, s.NewTickets, s.Updates, s.Messages, s.Insights, s.CreatedAt, s.LastSentAt);
}
