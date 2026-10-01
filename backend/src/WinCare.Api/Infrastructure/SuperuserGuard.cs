using Microsoft.EntityFrameworkCore;
using WinCare.Core.Persistence;

namespace WinCare.Api.Infrastructure;

public static class SuperuserGuard
{
    public static Task<int> CountActiveSuperusersAsync(WinCareDbContext db, Guid? excludeUserId = null, Guid? excludeRoleId = null,
        CancellationToken cancellationToken = default) =>
        (from ur in db.UserRoles
         join r in db.Roles on ur.RoleId equals r.Id
         join u in db.Users on ur.UserId equals u.Id
         where r.IsSuperuser && u.IsActive && u.Id != excludeUserId && r.Id != excludeRoleId
         select u.Id).Distinct().CountAsync(cancellationToken);

    public static Task<bool> IsSuperuserAsync(WinCareDbContext db, Guid userId, CancellationToken cancellationToken = default) =>
        (from ur in db.UserRoles
         join r in db.Roles on ur.RoleId equals r.Id
         where ur.UserId == userId && r.IsSuperuser
         select r.Id).AnyAsync(cancellationToken);
}
