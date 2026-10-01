using Microsoft.EntityFrameworkCore;
using WinCare.Api.Rmm.Monitoring;
using WinCare.Core.Identity;
using WinCare.Core.Persistence;

namespace WinCare.Api.Sso;

public static class SsoPolicy
{
    /// <summary>Com o login por senha desativado, so superusuarios entram por senha (acesso de emergencia se o provedor cair).</summary>
    public static async Task<bool> PasswordLoginBlockedAsync(AppUser user, WinCareDbContext db, CancellationToken ct)
    {
        if (!(await SettingsStore.GetAsync(db, ct)).DisablePasswordLogin)
        {
            return false;
        }
        var superuser = await (from ur in db.UserRoles
                               join r in db.Roles on ur.RoleId equals r.Id
                               where ur.UserId == user.Id && r.IsSuperuser
                               select r.Id).AnyAsync(ct);
        return !superuser;
    }
}
