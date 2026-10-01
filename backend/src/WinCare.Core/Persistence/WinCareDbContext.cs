using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using WinCare.Core.Audit;
using WinCare.Core.Identity;
using WinCare.Core.Rmm;

namespace WinCare.Core.Persistence;

public sealed class WinCareDbContext(DbContextOptions<WinCareDbContext> options)
    : IdentityDbContext<AppUser, AppRole, Guid>(options), IDataProtectionKeyContext
{
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Client> Clients => Set<Client>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<Agent> Agents => Set<Agent>();
    public DbSet<AgentSoftware> AgentSoftware => Set<AgentSoftware>();
    public DbSet<InstallerToken> InstallerTokens => Set<InstallerToken>();
    public DbSet<Deployment> Deployments => Set<Deployment>();

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
    
        ConfigureRmm(builder);
    }

    private static void ConfigureRmm(ModelBuilder builder)
    {
        builder.Entity<Client>(e =>
        {
            e.ToTable("clients");
            e.Property(c => c.Name).HasMaxLength(255);
            e.HasIndex(c => c.Name).IsUnique();
        });

        builder.Entity<Site>(e =>
        {
            e.ToTable("sites");
            e.Property(s => s.Name).HasMaxLength(255);
            e.HasIndex(s => new { s.ClientId, s.Name }).IsUnique();
            e.HasOne(s => s.Client).WithMany(c => c.Sites).HasForeignKey(s => s.ClientId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Agent>(e =>
        {
            e.ToTable("agents");
            e.Property(a => a.AgentId).HasMaxLength(200);
            e.HasIndex(a => a.AgentId).IsUnique();
            e.Property(a => a.Hostname).HasMaxLength(255);
            e.Property(a => a.MonitoringType).HasMaxLength(30);
            e.Property(a => a.Description).HasMaxLength(255);
            e.Property(a => a.MeshNodeId).HasMaxLength(255);
            e.Property(a => a.GoArch).HasMaxLength(32);
            e.Property(a => a.Plat).HasMaxLength(32);
            e.Property(a => a.Version).HasMaxLength(64);
            e.Property(a => a.OperatingSystem).HasMaxLength(255);
            e.Property(a => a.Status).HasMaxLength(16);
            e.Property(a => a.PublicIp).HasMaxLength(255);
            e.Property(a => a.LoggedInUsername).HasMaxLength(255);
            e.Property(a => a.LastLoggedInUser).HasMaxLength(255);
            e.Property(a => a.Disks).HasColumnType("jsonb");
            e.Property(a => a.Services).HasColumnType("jsonb");
            e.Property(a => a.WmiDetail).HasColumnType("jsonb");
            e.Property(a => a.TokenHash).HasMaxLength(64);
            e.HasIndex(a => a.TokenHash).IsUnique();
            e.Property(a => a.NatsPasswordHash).HasMaxLength(80);
            e.HasIndex(a => a.Status);
            e.HasOne(a => a.Site).WithMany(s => s.Agents).HasForeignKey(a => a.SiteId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<AgentSoftware>(e =>
        {
            e.ToTable("agent_software");
            e.HasKey(s => s.AgentId);
            e.Property(s => s.Software).HasColumnType("jsonb");
            e.HasOne(s => s.Agent).WithOne().HasForeignKey<AgentSoftware>(s => s.AgentId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<InstallerToken>(e =>
        {
            e.ToTable("installer_tokens");
            e.Property(t => t.TokenHash).HasMaxLength(64);
            e.HasIndex(t => t.TokenHash).IsUnique();
            e.Property(t => t.CreatedBy).HasMaxLength(256);
        });

        builder.Entity<Deployment>(e =>
        {
            e.ToTable("deployments");
            e.HasIndex(d => d.Uid).IsUnique();
            e.Property(d => d.MonitoringType).HasMaxLength(30);
            e.Property(d => d.GoArch).HasMaxLength(32);
            e.Property(d => d.CreatedBy).HasMaxLength(256);
            e.HasOne(d => d.Site).WithMany().HasForeignKey(d => d.SiteId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(d => d.InstallerToken).WithMany().HasForeignKey(d => d.InstallerTokenId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
