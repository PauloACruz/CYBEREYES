using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using WinCare.Core.Audit;
using WinCare.Core.Identity;
using WinCare.Core.Inventory;
using WinCare.Core.Rmm;
using WinCare.Core.Tickets;

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
    public DbSet<Script> Scripts => Set<Script>();
    public DbSet<ScriptSnippet> ScriptSnippets => Set<ScriptSnippet>();
    public DbSet<GlobalKey> GlobalKeys => Set<GlobalKey>();
    public DbSet<UrlAction> UrlActions => Set<UrlAction>();
    public DbSet<AgentHistory> AgentHistory => Set<AgentHistory>();
    public DbSet<Policy> Policies => Set<Policy>();
    public DbSet<Check> Checks => Set<Check>();
    public DbSet<CheckResult> CheckResults => Set<CheckResult>();
    public DbSet<CheckHistory> CheckHistory => Set<CheckHistory>();
    public DbSet<AutomatedTask> Tasks => Set<AutomatedTask>();
    public DbSet<TaskResult> TaskResults => Set<TaskResult>();
    public DbSet<TaskDispatch> TaskDispatches => Set<TaskDispatch>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<AlertTemplate> AlertTemplates => Set<AlertTemplate>();
    public DbSet<WinUpdate> WinUpdates => Set<WinUpdate>();
    public DbSet<PatchPolicy> PatchPolicies => Set<PatchPolicy>();
    public DbSet<PendingAction> PendingActions => Set<PendingAction>();
    public DbSet<CoreSettings> CoreSettings => Set<CoreSettings>();
    public DbSet<TicketQueue> TicketQueues => Set<TicketQueue>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<TicketAttachment> TicketAttachments => Set<TicketAttachment>();
    public DbSet<TicketAttachmentData> TicketAttachmentData => Set<TicketAttachmentData>();
    public DbSet<TimeEntry> TimeEntries => Set<TimeEntry>();
    public DbSet<SlaRule> SlaRules => Set<SlaRule>();
    public DbSet<TrayToken> TrayTokens => Set<TrayToken>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<AssetAssignment> AssetAssignments => Set<AssetAssignment>();
    public DbSet<Network> Networks => Set<Network>();
    public DbSet<IpRecord> IpRecords => Set<IpRecord>();
    public DbSet<Diagram> Diagrams => Set<Diagram>();
    public DbSet<Credential> Credentials => Set<Credential>();
    public DbSet<DocPage> DocPages => Set<DocPage>();
    public DbSet<DocAttachment> DocAttachments => Set<DocAttachment>();
    public DbSet<DocAttachmentData> DocAttachmentData => Set<DocAttachmentData>();

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

        builder.Entity<Script>(e =>
        {
            e.ToTable("scripts");
            e.Property(x => x.Name).HasMaxLength(255);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Category).HasMaxLength(100);
            e.Property(x => x.Shell).HasMaxLength(32);
            e.Property(x => x.DefaultArgs).HasColumnType("text[]");
            e.Property(x => x.EnvVars).HasColumnType("text[]");
            e.Property(x => x.Platforms).HasColumnType("text[]");
            e.Property(x => x.CreatedBy).HasMaxLength(256);
        });

        builder.Entity<ScriptSnippet>(e =>
        {
            e.ToTable("script_snippets");
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Shell).HasMaxLength(32);
        });

        builder.Entity<GlobalKey>(e =>
        {
            e.ToTable("global_keys");
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Name).IsUnique();
        });

        builder.Entity<UrlAction>(e =>
        {
            e.ToTable("url_actions");
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Pattern).HasMaxLength(2000);
        });

        builder.Entity<AgentHistory>(e =>
        {
            e.ToTable("agent_history");
            e.Property(x => x.Type).HasMaxLength(32);
            e.Property(x => x.Username).HasMaxLength(256);
            e.Property(x => x.ScriptName).HasMaxLength(255);
            e.Property(x => x.ScriptResults).HasColumnType("jsonb");
            e.HasIndex(x => new { x.AgentId, x.Time });
            e.HasOne(x => x.Agent).WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
        });

        ConfigureMonitoring(builder);

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

    private static void ConfigureMonitoring(ModelBuilder builder)
    {
        builder.Entity<Policy>(e =>
        {
            e.ToTable("policies");
            e.Property(x => x.Name).HasMaxLength(255);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Description).HasMaxLength(1000);
        });

        builder.Entity<Check>(e =>
        {
            e.ToTable("checks");
            e.Property(x => x.CheckType).HasMaxLength(32);
            e.Property(x => x.Name).HasMaxLength(255);
            e.Property(x => x.AlertSeverity).HasMaxLength(16);
            e.Property(x => x.Disk).HasMaxLength(64);
            e.Property(x => x.Ip).HasMaxLength(255);
            e.Property(x => x.SvcName).HasMaxLength(255);
            e.Property(x => x.LogName).HasMaxLength(32);
            e.Property(x => x.EventType).HasMaxLength(32);
            e.Property(x => x.EventSource).HasMaxLength(255);
            e.Property(x => x.FailWhen).HasMaxLength(16);
            e.HasIndex(x => x.AgentId);
            e.HasIndex(x => x.PolicyId);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Policy>().WithMany().HasForeignKey(x => x.PolicyId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Script>().WithMany().HasForeignKey(x => x.ScriptId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<CheckResult>(e =>
        {
            e.ToTable("check_results");
            e.HasIndex(x => new { x.AgentId, x.CheckId }).IsUnique();
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.AlertSeverity).HasMaxLength(16);
            e.Property(x => x.ExtraDetails).HasColumnType("jsonb");
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Check>().WithMany().HasForeignKey(x => x.CheckId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CheckHistory>(e =>
        {
            e.ToTable("check_history");
            e.Property(x => x.Status).HasMaxLength(16);
            e.HasIndex(x => new { x.CheckId, x.AgentId, x.Time });
            e.HasIndex(x => x.Time);
        });

        builder.Entity<AutomatedTask>(e =>
        {
            e.ToTable("tasks");
            e.Property(x => x.Name).HasMaxLength(255);
            e.Property(x => x.AlertSeverity).HasMaxLength(16);
            e.Property(x => x.Actions).HasColumnType("jsonb");
            e.Property(x => x.ScheduleType).HasMaxLength(32);
            e.Property(x => x.Time).HasMaxLength(5);
            e.HasIndex(x => x.AgentId);
            e.HasIndex(x => x.PolicyId);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Policy>().WithMany().HasForeignKey(x => x.PolicyId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Check>().WithMany().HasForeignKey(x => x.AssignedCheckId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<TaskResult>(e =>
        {
            e.ToTable("task_results");
            e.HasIndex(x => new { x.AgentId, x.TaskId }).IsUnique();
            e.Property(x => x.Status).HasMaxLength(16);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<AutomatedTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TaskDispatch>(e =>
        {
            e.ToTable("task_dispatches");
            e.HasIndex(x => new { x.TaskId, x.AgentId, x.Slot }).IsUnique();
            e.HasIndex(x => x.Slot);
        });

        builder.Entity<Alert>(e =>
        {
            e.ToTable("alerts");
            e.Property(x => x.AlertType).HasMaxLength(16);
            e.Property(x => x.Severity).HasMaxLength(16);
            e.Property(x => x.Message).HasMaxLength(2000);
            e.HasIndex(x => new { x.Resolved, x.CreatedAt });
            e.HasIndex(x => new { x.AgentId, x.CheckId, x.TaskId, x.Resolved });
            e.HasOne(x => x.Agent).WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AlertTemplate>(e =>
        {
            e.ToTable("alert_templates");
            e.Property(x => x.Name).HasMaxLength(255);
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.EmailRecipients).HasColumnType("text[]");
            e.Property(x => x.EmailSeverities).HasColumnType("text[]");
            e.Property(x => x.WebhookSeverities).HasColumnType("text[]");
            e.Property(x => x.DashboardSeverities).HasColumnType("text[]");
            e.Property(x => x.WebhookUrl).HasMaxLength(2000);
        });

        builder.Entity<WinUpdate>(e =>
        {
            e.ToTable("win_updates");
            e.Property(x => x.UpdateGuid).HasMaxLength(64);
            e.Property(x => x.Kb).HasMaxLength(32);
            e.Property(x => x.Severity).HasMaxLength(32);
            e.Property(x => x.Action).HasMaxLength(16);
            e.Property(x => x.Result).HasMaxLength(16);
            e.HasIndex(x => new { x.AgentId, x.UpdateGuid }).IsUnique();
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PatchPolicy>(e =>
        {
            e.ToTable("patch_policies");
            e.HasIndex(x => x.PolicyId).IsUnique();
            e.HasIndex(x => x.AgentId).IsUnique();
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Policy>().WithMany().HasForeignKey(x => x.PolicyId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PendingAction>(e =>
        {
            e.ToTable("pending_actions");
            e.Property(x => x.Type).HasMaxLength(32);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Details).HasColumnType("jsonb");
            e.HasIndex(x => new { x.AgentId, x.Status });
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CoreSettings>(e =>
        {
            e.ToTable("core_settings");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.TimeZone).HasMaxLength(64);
            e.Property(x => x.IncidentSeverities).HasColumnType("text[]");
            e.Property(x => x.IncidentPriority).HasMaxLength(16);
        });

        ConfigureTickets(builder);
        ConfigureInventory(builder);

        builder.Entity<Client>().HasOne<Policy>().WithMany().HasForeignKey(c => c.ServerPolicyId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Client>().HasOne<Policy>().WithMany().HasForeignKey(c => c.WorkstationPolicyId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Client>().HasOne<AlertTemplate>().WithMany().HasForeignKey(c => c.AlertTemplateId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Site>().HasOne<Policy>().WithMany().HasForeignKey(c => c.ServerPolicyId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Site>().HasOne<Policy>().WithMany().HasForeignKey(c => c.WorkstationPolicyId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Site>().HasOne<AlertTemplate>().WithMany().HasForeignKey(c => c.AlertTemplateId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Agent>().HasOne<Policy>().WithMany().HasForeignKey(a => a.PolicyId).OnDelete(DeleteBehavior.SetNull);
        builder.Entity<Agent>().HasOne<AlertTemplate>().WithMany().HasForeignKey(a => a.AlertTemplateId).OnDelete(DeleteBehavior.SetNull);
    }

    private static void ConfigureTickets(ModelBuilder builder)
    {
        builder.Entity<TicketQueue>(e =>
        {
            e.ToTable("ticket_queues");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Description).HasMaxLength(500);
            e.HasIndex(x => x.Name).IsUnique();
        });

        builder.Entity<Ticket>(e =>
        {
            e.ToTable("tickets");
            e.Property(x => x.Type).HasMaxLength(16);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(20000);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Priority).HasMaxLength(16);
            e.Property(x => x.RequesterName).HasMaxLength(200);
            e.Property(x => x.RequesterUsername).HasMaxLength(256);
            e.Property(x => x.RequesterEmail).HasMaxLength(256);
            e.Property(x => x.Source).HasMaxLength(16);
            e.Property(x => x.LastMessageAuthor).HasMaxLength(16);
            e.HasIndex(x => new { x.Status, x.UpdatedAt });
            e.HasIndex(x => new { x.AssignedToId, x.Status });
            e.HasIndex(x => new { x.AgentId, x.RequesterUsername });
            e.HasIndex(x => x.AlertId);
            e.HasOne(x => x.Queue).WithMany().HasForeignKey(x => x.QueueId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.AssignedToId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.CreatedById).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Alert>().WithMany().HasForeignKey(x => x.AlertId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<TicketMessage>(e =>
        {
            e.ToTable("ticket_messages");
            e.Property(x => x.AuthorType).HasMaxLength(16);
            e.Property(x => x.AuthorName).HasMaxLength(200);
            e.Property(x => x.Body).HasMaxLength(20000);
            e.HasIndex(x => new { x.TicketId, x.CreatedAt });
            e.HasOne<Ticket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TicketAttachment>(e =>
        {
            e.ToTable("ticket_attachments");
            e.Property(x => x.FileName).HasMaxLength(255);
            e.Property(x => x.ContentType).HasMaxLength(128);
            e.Property(x => x.UploadedBy).HasMaxLength(200);
            e.HasIndex(x => x.TicketId);
            e.HasIndex(x => x.MessageId);
            e.HasOne<Ticket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TicketMessage>().WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<TicketAttachmentData>(e =>
        {
            e.ToTable("ticket_attachment_data");
            e.HasKey(x => x.AttachmentId);
            e.HasOne<TicketAttachment>().WithOne().HasForeignKey<TicketAttachmentData>(x => x.AttachmentId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TimeEntry>(e =>
        {
            e.ToTable("time_entries");
            e.Property(x => x.Description).HasMaxLength(1000);
            e.HasIndex(x => x.TicketId);
            e.HasOne<Ticket>().WithMany().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SlaRule>(e =>
        {
            e.ToTable("sla_rules");
            e.HasKey(x => x.Priority);
            e.Property(x => x.Priority).HasMaxLength(16);
            e.HasData(SlaRule.Defaults());
        });

        builder.Entity<TrayToken>(e =>
        {
            e.ToTable("tray_tokens");
            e.Property(x => x.Username).HasMaxLength(256);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.ExpiresAt);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureInventory(ModelBuilder builder)
    {
        builder.Entity<Asset>(e =>
        {
            e.ToTable("assets");
            e.Property(x => x.Type).HasMaxLength(32);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Manufacturer).HasMaxLength(200);
            e.Property(x => x.Model).HasMaxLength(200);
            e.Property(x => x.SerialNumber).HasMaxLength(200);
            e.Property(x => x.AssetTag).HasMaxLength(100);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Location).HasMaxLength(200);
            e.Property(x => x.IpAddress).HasMaxLength(64);
            e.Property(x => x.MacAddress).HasMaxLength(32);
            e.Property(x => x.Notes).HasMaxLength(5000);
            e.HasIndex(x => x.AgentId).IsUnique();
            e.HasIndex(x => new { x.ClientId, x.Type });
            e.HasIndex(x => x.AssetTag);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Agent>().WithMany().HasForeignKey(x => x.AgentId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<Person>(e =>
        {
            e.ToTable("people");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.Phone).HasMaxLength(64);
            e.Property(x => x.Department).HasMaxLength(200);
            e.Property(x => x.JobTitle).HasMaxLength(200);
            e.Property(x => x.Username).HasMaxLength(256);
            e.HasIndex(x => new { x.ClientId, x.Username });
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AssetAssignment>(e =>
        {
            e.ToTable("asset_assignments");
            e.Property(x => x.AssignedBy).HasMaxLength(200);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.HasIndex(x => new { x.AssetId, x.AssignedAt });
            e.HasIndex(x => x.AssetId).IsUnique().HasFilter("\"UnassignedAt\" IS NULL").HasDatabaseName("IX_asset_assignments_open");
            e.HasIndex(x => x.PersonId);
            e.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Network>(e =>
        {
            e.ToTable("networks");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Cidr).HasMaxLength(64);
            e.Property(x => x.VlanName).HasMaxLength(100);
            e.Property(x => x.Gateway).HasMaxLength(64);
            e.Property(x => x.DnsServers).HasMaxLength(500);
            e.Property(x => x.DhcpRange).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(5000);
            e.HasIndex(x => x.ClientId);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<IpRecord>(e =>
        {
            e.ToTable("ip_records");
            e.Property(x => x.Address).HasMaxLength(64);
            e.Property(x => x.Hostname).HasMaxLength(200);
            e.Property(x => x.MacAddress).HasMaxLength(32);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.HasIndex(x => new { x.NetworkId, x.Address }).IsUnique();
            e.HasIndex(x => x.AssetId);
            e.HasOne<Network>().WithMany().HasForeignKey(x => x.NetworkId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<Diagram>(e =>
        {
            e.ToTable("diagrams");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.Property(x => x.UpdatedBy).HasMaxLength(200);
            e.HasIndex(x => x.ClientId);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<Credential>(e =>
        {
            e.ToTable("credentials");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Username).HasMaxLength(256);
            e.Property(x => x.Url).HasMaxLength(2000);
            e.Property(x => x.Notes).HasMaxLength(5000);
            e.Property(x => x.UpdatedBy).HasMaxLength(200);
            e.HasIndex(x => x.ClientId);
            e.HasIndex(x => x.AssetId);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<DocPage>(e =>
        {
            e.ToTable("doc_pages");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Body).HasMaxLength(200000);
            e.Property(x => x.UpdatedBy).HasMaxLength(200);
            e.HasIndex(x => x.ClientId);
            e.HasOne<Client>().WithMany().HasForeignKey(x => x.ClientId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Site>().WithMany().HasForeignKey(x => x.SiteId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<DocAttachment>(e =>
        {
            e.ToTable("doc_attachments");
            e.Property(x => x.OwnerType).HasMaxLength(16);
            e.Property(x => x.FileName).HasMaxLength(255);
            e.Property(x => x.ContentType).HasMaxLength(128);
            e.Property(x => x.UploadedBy).HasMaxLength(200);
            e.HasIndex(x => new { x.OwnerType, x.OwnerId });
        });

        builder.Entity<DocAttachmentData>(e =>
        {
            e.ToTable("doc_attachment_data");
            e.HasKey(x => x.AttachmentId);
            e.HasOne<DocAttachment>().WithOne().HasForeignKey<DocAttachmentData>(x => x.AttachmentId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
