using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using WinCare.Core.Audit;
using WinCare.Core.Identity;

namespace WinCare.Core.Persistence;

public sealed class WinCareDbContext(DbContextOptions<WinCareDbContext> options)
    : IdentityDbContext<AppUser, AppRole, Guid>(options), IDataProtectionKeyContext
{
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<AppUser>(e =>
        {
            e.Property(u => u.FullName).HasMaxLength(200);
        });

        builder.Entity<AppRole>(e =>
        {
            e.Property(r => r.Permissions).HasColumnType("text[]");
        });

        builder.Entity<DataProtectionKey>(e => e.ToTable("data_protection_keys"));

        builder.Entity<ApiKey>(e =>
        {
            e.ToTable("api_keys");
            e.Property(k => k.Name).HasMaxLength(100);
            e.Property(k => k.Prefix).HasMaxLength(16);
            e.Property(k => k.KeyHash).HasMaxLength(64);
            e.HasIndex(k => k.KeyHash).IsUnique();
            e.HasOne(k => k.User).WithMany().HasForeignKey(k => k.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_logs");
            e.Property(a => a.Username).HasMaxLength(256);
            e.Property(a => a.Action).HasMaxLength(64);
            e.Property(a => a.ObjectType).HasMaxLength(64);
            e.Property(a => a.ObjectId).HasMaxLength(64);
            e.Property(a => a.Message).HasMaxLength(2000);
            e.Property(a => a.IpAddress).HasMaxLength(64);
            e.HasIndex(a => a.Timestamp);
            e.HasIndex(a => new { a.Username, a.Timestamp });
            e.HasIndex(a => new { a.Action, a.Timestamp });
        });
    }
}
