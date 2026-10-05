using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Infrastructure;

/// <summary>Token do convite: provedor proprio para ter validade maior que a da redefinicao de senha.</summary>
public sealed class InviteTokenProviderOptions : DataProtectionTokenProviderOptions
{
    public const string ProviderName = "Invite";

    public InviteTokenProviderOptions()
    {
        Name = ProviderName;
        TokenLifespan = AccountEmails.InviteLifespan;
    }
}

public sealed class InviteTokenProvider(IDataProtectionProvider dataProtectionProvider, IOptions<InviteTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<AppUser>> logger) : DataProtectorTokenProvider<AppUser>(dataProtectionProvider, options, logger);

/// <summary>E-mails de conta (convite e redefinicao de senha) enviados pelo SMTP das configuracoes globais.</summary>
public sealed partial class AccountEmails(UserManager<AppUser> userManager, CybereyesDbContext db, INotificationSender sender,
    IServiceScopeFactory scopes, ILogger<AccountEmails> logger)
{
    public const string InvitePurpose = "invite";
    public static readonly TimeSpan ResetLifespan = TimeSpan.FromHours(2);
    public static readonly TimeSpan InviteLifespan = TimeSpan.FromHours(72);
    /// <summary>Intervalo minimo entre dois e-mails de redefinicao para o mesmo usuario.</summary>
    public static readonly TimeSpan ResetThrottle = TimeSpan.FromMinutes(2);

    public const string ResetRequestedAction = "user.password-reset-requested";

    public static bool SmtpConfigured(CoreSettings settings) =>
        !string.IsNullOrWhiteSpace(settings.SmtpHost) && !string.IsNullOrWhiteSpace(settings.SmtpFrom);

    /// <summary>Envia o convite e invalida os links de convites anteriores. Lanca excecao se o envio falhar.</summary>
    public async Task SendInviteAsync(AppUser user, string publicUrl, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        if (!SmtpConfigured(settings))
        {
            throw new InvalidOperationException("SMTP nao configurado (Configuracoes > E-mail)");
        }

        await userManager.UpdateSecurityStampAsync(user);
        var token = await userManager.GenerateUserTokenAsync(user, InviteTokenProviderOptions.ProviderName, InvitePurpose);
        var link = Link(publicUrl, "/convite", user.Id, token);
        var body =
            $"Ola, {user.FullName}.\n\n" +
            "Voce foi convidado para o console Cybereyes.\n" +
            $"Seu usuario: {user.UserName}\n\n" +
            $"Defina sua senha pelo link abaixo (valido por {InviteLifespan.TotalHours:0} horas):\n{link}\n\n" +
            "No primeiro acesso sera pedida a verificacao em duas etapas (Google Authenticator, Microsoft Authenticator ou similar).\n\n" +
            "Se voce nao esperava este convite, ignore esta mensagem.";
        await sender.SendEmailAsync(settings, [user.Email!], "[Cybereyes] Convite para o console", body, ct);
    }

    public Task<bool> VerifyInviteAsync(AppUser user, string token) =>
        userManager.VerifyUserTokenAsync(user, InviteTokenProviderOptions.ProviderName, InvitePurpose, token);

    /// <summary>
    /// Gera o link de redefinicao e envia em segundo plano, para a resposta levar o mesmo tempo exista a conta ou nao.
    /// Retorna false quando o pedido foi ignorado (SMTP ausente ou outro e-mail enviado ha pouco).
    /// </summary>
    public async Task<bool> QueuePasswordResetAsync(AppUser user, string publicUrl, CancellationToken ct)
    {
        var settings = await SettingsStore.GetAsync(db, ct);
        if (!SmtpConfigured(settings))
        {
            LogResetSkipped(logger, user.UserName, "SMTP nao configurado");
            return false;
        }

        var since = DateTimeOffset.UtcNow - ResetThrottle;
        var userId = user.Id.ToString();
        if (await db.AuditLogs.AnyAsync(a => a.Action == ResetRequestedAction && a.ObjectId == userId && a.Timestamp > since, ct))
        {
            LogResetSkipped(logger, user.UserName, "pedido repetido em menos de 2 minutos");
            return false;
        }

        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var link = Link(publicUrl, "/redefinir-senha", user.Id, token);
        var body =
            $"Ola, {user.FullName}.\n\n" +
            $"Recebemos um pedido para redefinir a senha do usuario {user.UserName} no console Cybereyes.\n\n" +
            $"Defina uma nova senha pelo link abaixo (valido por {ResetLifespan.TotalHours:0} horas e uma unica vez):\n{link}\n\n" +
            "A verificacao em duas etapas continua sendo pedida no login.\n\n" +
            "Se nao foi voce, ignore esta mensagem: sua senha atual continua valendo.";
        var email = user.Email!;
        var username = user.UserName;

        // Sem o contexto da requisicao: ela termina antes do envio (o HttpContext ja estaria descartado).
        using (ExecutionContext.SuppressFlow())
        {
            _ = Task.Run(() => SendResetAsync(settings, email, body, userId, username), CancellationToken.None);
        }
        return true;
    }

    private async Task SendResetAsync(CoreSettings settings, string email, string body, string userId, string? username)
    {
        try
        {
            await sender.SendEmailAsync(settings, [email], "[Cybereyes] Redefinicao de senha", body, CancellationToken.None);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogResetFailed(logger, ex, username);
            await using var scope = scopes.CreateAsyncScope();
            var audit = scope.ServiceProvider.GetRequiredService<Cybereyes.Core.Audit.IAuditService>();
            await audit.LogAsync("user.password-reset-email-failed", "user", userId, Truncate(ex.Message), username, CancellationToken.None);
        }
    }

    private static string Link(string publicUrl, string path, Guid userId, string token) =>
        $"{publicUrl}{path}?uid={userId}&token={Uri.EscapeDataString(token)}";

    private static string Truncate(string text) => text.Length <= 300 ? text : text[..300];

    [LoggerMessage(Level = LogLevel.Warning, Message = "Redefinicao de senha de {Username} nao enviada: {Reason}")]
    private static partial void LogResetSkipped(ILogger logger, string? username, string reason);

    [LoggerMessage(Level = LogLevel.Error, Message = "Falha ao enviar o e-mail de redefinicao de senha de {Username}")]
    private static partial void LogResetFailed(ILogger logger, Exception ex, string? username);
}
