using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Identity;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var view = Policies.Permission(Permissions.UsersView);
        var manage = Policies.Permission(Permissions.UsersManage);
        var group = app.MapGroup("/api/users").WithTags("Usuarios");

        group.MapGet("/", ListAsync).RequireAuthorization(view);
        group.MapGet("/client-options", ClientOptionsAsync).RequireAuthorization(manage);
        group.MapGet("/{id:guid}", GetAsync).RequireAuthorization(view);
        group.MapPost("/", CreateAsync).RequireAuthorization(manage);
        group.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(manage);
        group.MapPost("/{id:guid}/reset-password", ResetPasswordAsync).RequireAuthorization(manage);
        group.MapPost("/{id:guid}/invite", ResendInviteAsync).RequireAuthorization(manage);
        group.MapPost("/{id:guid}/reset-2fa", ResetTwoFactorAsync).RequireAuthorization(manage);
        group.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(manage);
    }

    private static async Task<IResult> ListAsync(CybereyesDbContext db, int? page, int? pageSize, string? search, CancellationToken ct)
    {
        var (p, size) = Paging.Normalize(page, pageSize);
        var query = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(u => EF.Functions.ILike(u.UserName!, pattern) || EF.Functions.ILike(u.Email!, pattern) ||
                                     EF.Functions.ILike(u.FullName, pattern));
        }

        var total = await query.CountAsync(ct);
        var users = await query.OrderBy(u => u.UserName).Skip((p - 1) * size).Take(size).ToListAsync(ct);
        var ids = users.Select(u => u.Id).ToList();
        var roles = await LoadRolesAsync(db, ids, ct);
        var clients = await LoadClientsAsync(db, ids, ct);
        return TypedResults.Ok(new Paged<UserDto>(users.Select(u => ToDto(u, roles, clients)).ToList(), total, p, size));
    }

    /// <summary>Clientes que quem edita pode liberar: um usuario restrito so repassa os que ele mesmo ve.</summary>
    private static async Task<IResult> ClientOptionsAsync(CybereyesDbContext db, CancellationToken ct) =>
        TypedResults.Ok(await db.Clients.AsNoTracking().OrderBy(c => c.Name).Select(c => new ClientRef(c.Id, c.Name)).ToListAsync(ct));

    private static async Task<IResult> GetAsync(Guid id, CybereyesDbContext db, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }
        var logins = await db.UserLogins.AsNoTracking().Where(l => l.UserId == id && l.LoginProvider.StartsWith("oidc:")).ToListAsync(ct);
        var sso = logins.Select(l => new SsoLoginRef(int.TryParse(l.LoginProvider[5..], out var pid) ? pid : 0, l.ProviderDisplayName ?? l.LoginProvider)).ToList();
        return TypedResults.Ok(await ToDtoAsync(db, user, ct) with { SsoLogins = sso, HasPassword = user.PasswordHash is not null });
    }

    private static async Task<IResult> CreateAsync(CreateUserRequest request, HttpContext ctx, IConfiguration config, CybereyesDbContext db,
        UserManager<AppUser> userManager, AccountEmails emails, IAuditService audit, CancellationToken ct)
    {
        var password = string.IsNullOrEmpty(request.Password) ? null : request.Password;
        if (password is null && !request.SendInvite)
        {
            return Problems.Validation("password", "Informe a senha inicial ou envie um convite por e-mail");
        }
        if (password is not null && request.SendInvite)
        {
            return Problems.Validation("password", "Com convite, a senha e definida pelo proprio usuario");
        }
        if (request.SendInvite && !AccountEmails.SmtpConfigured(await SettingsStore.GetAsync(db, ct)))
        {
            return Problems.Validation("sendInvite", "Configure o SMTP (Configuracoes > E-mail) antes de enviar convites");
        }

        var roleNames = await ResolveRoleNamesAsync(db, request.RoleIds, ct);
        if (roleNames is null)
        {
            return Problems.Validation("roleIds", "Um ou mais papeis nao existem");
        }
        if (await ValidateClientAccessAsync(db, request.AllClients, request.ClientIds, ct) is { } clientError)
        {
            return clientError;
        }

        var user = new AppUser
        {
            UserName = request.Username.Trim(),
            Email = request.Email.Trim(),
            FullName = request.FullName.Trim(),
            IsActive = request.IsActive,
            AllClients = request.AllClients,
        };
        var result = password is null ? await userManager.CreateAsync(user) : await userManager.CreateAsync(user, password);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }
        if (roleNames.Count > 0)
        {
            await userManager.AddToRolesAsync(user, roleNames);
        }
        if (!request.AllClients)
        {
            await ReplaceClientsAsync(db, user.Id, request.ClientIds!, ct);
        }

        await audit.LogAsync("user.created", "user", user.Id.ToString(), $"Usuario {user.UserName} criado", cancellationToken: ct);

        // O usuario fica criado mesmo se o e-mail falhar: o console avisa e o convite pode ser reenviado.
        var inviteError = request.SendInvite ? await TrySendInviteAsync(user, InstallerEndpoints.PublicUrl(ctx, config), emails, audit, ct) : null;
        return TypedResults.Created($"/api/users/{user.Id}", await ToDtoAsync(db, user, ct) with { InviteError = inviteError });
    }

    private static async Task<IResult> ResendInviteAsync(Guid id, HttpContext ctx, IConfiguration config, UserManager<AppUser> userManager,
        AccountEmails emails, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }
        if (!IsInvitePending(user))
        {
            return Problems.Conflict("O usuario ja definiu a senha ou ja acessou o console; use Redefinir senha");
        }
        if (!user.IsActive)
        {
            return Problems.Conflict("Ative o usuario antes de reenviar o convite");
        }

        var error = await TrySendInviteAsync(user, InstallerEndpoints.PublicUrl(ctx, config), emails, audit, ct);
        return error is null ? TypedResults.NoContent() : Problems.BadRequest($"Falha ao enviar o convite: {error}");
    }

    private static async Task<string?> TrySendInviteAsync(AppUser user, string publicUrl, AccountEmails emails, IAuditService audit, CancellationToken ct)
    {
        try
        {
            await emails.SendInviteAsync(user, publicUrl, ct);
            await audit.LogAsync("user.invited", "user", user.Id.ToString(), $"Convite enviado para {user.Email}", cancellationToken: ct);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var message = ex.Message.Length <= 300 ? ex.Message : ex.Message[..300];
            await audit.LogAsync("user.invite-failed", "user", user.Id.ToString(), $"Falha ao enviar o convite: {message}", cancellationToken: ct);
            return message;
        }
    }

    /// <summary>Criado por convite e ainda sem senha nem acesso (usuarios so de SSO ja tem LastLoginAt).</summary>
    private static bool IsInvitePending(AppUser user) => user.PasswordHash is null && user.LastLoginAt is null;

    private static async Task<IResult> UpdateAsync(Guid id, UpdateUserRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        UserManager<AppUser> userManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        var roleNames = await ResolveRoleNamesAsync(db, request.RoleIds, ct);
        if (roleNames is null)
        {
            return Problems.Validation("roleIds", "Um ou mais papeis nao existem");
        }
        if (!request.IsActive && principal.UserId() == id)
        {
            return Problems.Conflict("Voce nao pode desativar o proprio usuario");
        }
        var allClients = request.AllClients ?? user.AllClients;
        var clientsChanged = request.AllClients is not null || request.ClientIds is not null;
        if (clientsChanged)
        {
            // Quem ve so alguns clientes nao pode liberar todos; manter "todos" em quem ja tinha e permitido.
            var keepsAll = allClients && user.AllClients;
            var clientIds = request.ClientIds ?? (allClients ? null : await CurrentClientIdsAsync(db, id, ct));
            if (!keepsAll && await ValidateClientAccessAsync(db, allClients, clientIds, ct) is { } clientError)
            {
                return clientError;
            }
        }

        var wasSuperuser = await SuperuserGuard.IsSuperuserAsync(db, id, ct);
        var willBeSuperuser = request.IsActive && await db.Roles.AnyAsync(r => roleNames.Contains(r.Name!) && r.IsSuperuser, ct);
        if (wasSuperuser && !willBeSuperuser && await SuperuserGuard.CountActiveSuperusersAsync(db, excludeUserId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }

        var deactivated = user.IsActive && !request.IsActive;
        user.Email = request.Email.Trim();
        user.FullName = request.FullName.Trim();
        user.IsActive = request.IsActive;
        user.AllClients = allClients;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result);
        }

        var current = await userManager.GetRolesAsync(user);
        await userManager.RemoveFromRolesAsync(user, current.Except(roleNames));
        await userManager.AddToRolesAsync(user, roleNames.Except(current));
        if (clientsChanged)
        {
            await ReplaceClientsAsync(db, id, allClients ? [] : request.ClientIds ?? await CurrentClientIdsAsync(db, id, ct), ct);
        }
        if (deactivated)
        {
            await userManager.UpdateSecurityStampAsync(user);
        }

        await audit.LogAsync("user.updated", "user", id.ToString(), $"Usuario {user.UserName} alterado", cancellationToken: ct);
        var logins = await db.UserLogins.AsNoTracking().Where(l => l.UserId == id && l.LoginProvider.StartsWith("oidc:")).ToListAsync(ct);
        var sso = logins.Select(l => new SsoLoginRef(int.TryParse(l.LoginProvider[5..], out var pid) ? pid : 0, l.ProviderDisplayName ?? l.LoginProvider)).ToList();
        return TypedResults.Ok(await ToDtoAsync(db, user, ct) with { SsoLogins = sso, HasPassword = user.PasswordHash is not null });
    }

    private static async Task<IResult> ResetPasswordAsync(Guid id, ResetPasswordRequest request, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, request.NewPassword);
        if (!result.Succeeded)
        {
            return Problems.FromIdentity(result, "newPassword");
        }

        await audit.LogAsync("user.password-reset", "user", id.ToString(), $"Senha de {user.UserName} redefinida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ResetTwoFactorAsync(Guid id, UserManager<AppUser> userManager, IAuditService audit, CancellationToken ct)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }

        await userManager.SetTwoFactorEnabledAsync(user, false);
        await userManager.ResetAuthenticatorKeyAsync(user);
        await userManager.UpdateSecurityStampAsync(user);
        await audit.LogAsync("user.2fa-reset", "user", id.ToString(), $"2FA de {user.UserName} redefinido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> DeleteAsync(Guid id, ClaimsPrincipal principal, CybereyesDbContext db, UserManager<AppUser> userManager,
        IAuditService audit, CancellationToken ct)
    {
        if (principal.UserId() == id)
        {
            return Problems.Conflict("Voce nao pode excluir o proprio usuario");
        }

        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null)
        {
            return Problems.NotFound("Usuario");
        }
        if (await SuperuserGuard.IsSuperuserAsync(db, id, ct) &&
            await SuperuserGuard.CountActiveSuperusersAsync(db, excludeUserId: id, cancellationToken: ct) == 0)
        {
            return Problems.Conflict("E preciso manter ao menos um administrador ativo");
        }

        await userManager.DeleteAsync(user);
        await audit.LogAsync("user.deleted", "user", id.ToString(), $"Usuario {user.UserName} excluido", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<List<string>?> ResolveRoleNamesAsync(CybereyesDbContext db, IReadOnlyList<Guid>? roleIds, CancellationToken ct)
    {
        var ids = (roleIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var names = await db.Roles.Where(r => ids.Contains(r.Id)).Select(r => r.Name!).ToListAsync(ct);
        return names.Count == ids.Count ? names : null;
    }

    /// <summary>Nulo quando o pedido e valido; os clientes passam pelo escopo de quem edita.</summary>
    private static async Task<IResult?> ValidateClientAccessAsync(CybereyesDbContext db, bool allClients, IReadOnlyList<int>? clientIds, CancellationToken ct)
    {
        if (allClients)
        {
            return db.IsClientRestricted ? Problems.Validation("allClients", "Voce so pode liberar os clientes que tem acesso") : null;
        }
        var ids = (clientIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return Problems.Validation("clientIds", "Selecione ao menos um cliente");
        }
        return await db.Clients.CountAsync(c => ids.Contains(c.Id), ct) == ids.Count
            ? null
            : Problems.Validation("clientIds", "Um ou mais clientes nao existem");
    }

    private static Task<List<int>> CurrentClientIdsAsync(CybereyesDbContext db, Guid userId, CancellationToken ct) =>
        db.UserClients.Where(uc => uc.UserId == userId && db.Clients.Any(c => c.Id == uc.ClientId)).Select(uc => uc.ClientId).ToListAsync(ct);

    /// <summary>Troca os clientes liberados que quem edita enxerga; os demais (fora do escopo dele) ficam como estao.</summary>
    private static async Task ReplaceClientsAsync(CybereyesDbContext db, Guid userId, IReadOnlyList<int> clientIds, CancellationToken ct)
    {
        var visible = db.Clients.Select(c => c.Id);
        await db.UserClients.Where(uc => uc.UserId == userId && visible.Contains(uc.ClientId)).ExecuteDeleteAsync(ct);
        db.UserClients.AddRange(clientIds.Distinct().Select(clientId => new UserClient { UserId = userId, ClientId = clientId }));
        await db.SaveChangesAsync(ct);
    }

    private static async Task<UserDto> ToDtoAsync(CybereyesDbContext db, AppUser user, CancellationToken ct) =>
        ToDto(user, await LoadRolesAsync(db, [user.Id], ct), await LoadClientsAsync(db, [user.Id], ct));

    private static async Task<ILookup<Guid, ClientRef>> LoadClientsAsync(CybereyesDbContext db, List<Guid> userIds, CancellationToken ct)
    {
        var rows = await (
            from uc in db.UserClients.AsNoTracking()
            join c in db.Clients.AsNoTracking() on uc.ClientId equals c.Id
            where userIds.Contains(uc.UserId)
            select new { uc.UserId, c.Id, c.Name }).ToListAsync(ct);
        return rows.ToLookup(r => r.UserId, r => new ClientRef(r.Id, r.Name));
    }

    private static async Task<ILookup<Guid, RoleRef>> LoadRolesAsync(CybereyesDbContext db, List<Guid> userIds, CancellationToken ct)
    {
        var rows = await (
            from ur in db.UserRoles.AsNoTracking()
            join r in db.Roles.AsNoTracking() on ur.RoleId equals r.Id
            where userIds.Contains(ur.UserId)
            select new { ur.UserId, r.Id, r.Name }).ToListAsync(ct);
        return rows.ToLookup(r => r.UserId, r => new RoleRef(r.Id, r.Name ?? string.Empty));
    }

    private static UserDto ToDto(AppUser user, ILookup<Guid, RoleRef> roles, ILookup<Guid, ClientRef> clients) =>
        new(user.Id, user.UserName ?? string.Empty, user.Email, user.FullName, user.IsActive, user.TwoFactorEnabled,
            roles[user.Id].OrderBy(r => r.Name, StringComparer.Ordinal).ToList(), user.LastLoginAt, user.CreatedAt,
            user.AllClients, user.AllClients ? [] : clients[user.Id].OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList())
        {
            InvitePending = IsInvitePending(user),
        };
}
