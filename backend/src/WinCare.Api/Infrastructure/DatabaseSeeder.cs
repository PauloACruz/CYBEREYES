using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using WinCare.Core.Identity;
using WinCare.Core.Persistence;
using WinCare.Core.Security;
using WinCare.Core.Tickets;

namespace WinCare.Api.Infrastructure;

public static partial class DatabaseSeeder
{
    public const string AdminRole = "Administrador";
    public const string TechnicianRole = "Tecnico";

    public static async Task SeedAsync(IServiceProvider services, IConfiguration configuration, bool migrate, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Seeder");

        if (migrate)
        {
            await db.Database.MigrateAsync(cancellationToken);
        }

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<AppRole>>();
        if (!await roleManager.RoleExistsAsync(AdminRole))
        {
            await roleManager.CreateAsync(new AppRole { Name = AdminRole, IsSuperuser = true });
        }
        if (!await roleManager.RoleExistsAsync(TechnicianRole))
        {
            await roleManager.CreateAsync(new AppRole { Name = TechnicianRole, Permissions = [Permissions.UsersView, Permissions.ClientsView, Permissions.AgentsView, Permissions.AgentsInstall, Permissions.AgentsRun, Permissions.AgentsControl, Permissions.ScriptsView, Permissions.AlertsView, Permissions.AlertsManage, Permissions.AgentsRemote, Permissions.TicketsView, Permissions.TicketsManage, Permissions.InventoryView, Permissions.InventoryManage, Permissions.DocsView, Permissions.DocsManage, Permissions.CredentialsReveal, Permissions.WinCareRun, Permissions.LogsView, Permissions.SnmpView, Permissions.SnmpManage] });
        }

        if (!await db.TicketQueues.AnyAsync(cancellationToken))
        {
            db.TicketQueues.Add(new TicketQueue { Name = "Geral", Description = "Fila padrao", IsDefault = true });
            await db.SaveChangesAsync(cancellationToken);
        }

        if (await db.Users.AnyAsync(cancellationToken))
        {
            return;
        }

        var username = configuration["Seed:AdminUsername"];
        var password = configuration["Seed:AdminPassword"];
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            LogNoAdmin(logger);
            return;
        }

        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var admin = new AppUser
        {
            UserName = username,
            Email = configuration["Seed:AdminEmail"] ?? $"{username}@localhost",
            FullName = "Administrador",
        };
        var result = await userManager.CreateAsync(admin, password);
        if (!result.Succeeded)
        {
            throw new InvalidOperationException("Falha ao criar administrador inicial: " +
                string.Join("; ", result.Errors.Select(e => e.Description)));
        }
        await userManager.AddToRoleAsync(admin, AdminRole);
        LogAdminCreated(logger, username);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Nenhum usuario existe e Seed:AdminUsername/Seed:AdminPassword nao foram informados")]
    private static partial void LogNoAdmin(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Administrador inicial {Username} criado")]
    private static partial void LogAdminCreated(ILogger logger, string username);
}
