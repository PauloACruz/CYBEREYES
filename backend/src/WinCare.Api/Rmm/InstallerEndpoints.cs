using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WinCare.Api.Infrastructure;
using WinCare.Core.Audit;
using WinCare.Core.Persistence;
using WinCare.Core.Rmm;
using WinCare.Core.Security;

namespace WinCare.Api.Rmm;

public sealed record InstallerRequest(
    int SiteId,
    [property: Required, RegularExpression("^(auto|server|workstation)$")] string AgentType,
    [property: Required, RegularExpression("^(linux|windows|darwin)$")] string Plat,
    [property: RegularExpression("^(amd64|386|arm64|arm)$")] string? GoArch,
    [property: Range(1, 720)] int ExpiresHours);

public sealed record InstallerResponse(string Command, DateTimeOffset ExpiresAt, string Plat);

public sealed record DeploymentRequest(
    int SiteId,
    [property: Required, RegularExpression("^(auto|server|workstation)$")] string AgentType,
    [property: RegularExpression("^(amd64|386|arm64|arm)$")] string? GoArch,
    DateTimeOffset ExpiresAt);

public sealed record DeploymentDto(int Id, Guid Uid, int ClientId, string ClientName, int SiteId, string SiteName, string AgentType,
    string GoArch, DateTimeOffset ExpiresAt, DateTimeOffset CreatedAt, string CreatedBy, IReadOnlyDictionary<string, string> Commands);

public static class InstallerEndpoints
{
    private const string DeploymentPurpose = "WinCare.Deployments.Token";

    public static void MapInstallerEndpoints(this IEndpointRouteBuilder app)
    {
        var install = Policies.Permission(Permissions.AgentsInstall);
        app.MapPost("/api/agents/installer", CreateInstallerAsync).WithTags("Agentes").RequireAuthorization(install);

        var deployments = app.MapGroup("/api/deployments").WithTags("Implantacoes").RequireAuthorization(install);
        deployments.MapGet("/", ListDeploymentsAsync);
        deployments.MapPost("/", CreateDeploymentAsync);
        deployments.MapDelete("/{id:int}", DeleteDeploymentAsync);

        app.MapGet("/api/install/linux.sh", (HttpContext ctx, IConfiguration config) =>
            Results.Text(InstallScripts.Linux(PublicUrl(ctx, config)), "text/x-shellscript")).AllowAnonymous().ExcludeFromDescription();
        app.MapGet("/api/deploy/{uid:guid}/{plat}", DeployScriptAsync).AllowAnonymous().ExcludeFromDescription();
        app.MapGet("/api/agent/download/{plat}/{goarch}", Download).AllowAnonymous().ExcludeFromDescription();
    }

    public static string PublicUrl(HttpContext ctx, IConfiguration config) =>
        (config["App:PublicUrl"] is { Length: > 0 } url ? url : $"{ctx.Request.Scheme}://{ctx.Request.Host}").TrimEnd('/');

    private static async Task<IResult> CreateInstallerAsync(InstallerRequest request, HttpContext ctx, IConfiguration config,
        ClaimsPrincipal principal, WinCareDbContext db, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        var site = await db.Sites.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.SiteId, ct);
        if (site is null)
        {
            return Problems.Validation("siteId", "Site nao encontrado");
        }

        var token = AgentSecrets.NewInstallerToken();
        var expires = time.GetUtcNow().AddHours(request.ExpiresHours);
        db.InstallerTokens.Add(new InstallerToken { TokenHash = AgentSecrets.Hash(token), ExpiresAt = expires, CreatedBy = principal.Identity?.Name ?? "?" });
        await db.SaveChangesAsync(ct);

        var parameters = new InstallParameters(PublicUrl(ctx, config), site.ClientId, site.Id, token, request.AgentType);
        var goarch = request.GoArch ?? (request.Plat == "darwin" ? "arm64" : "amd64");
        var command = request.Plat switch
        {
            "linux" => InstallScripts.LinuxCommand(parameters),
            "darwin" => InstallScripts.MacCommand(parameters, goarch),
            _ => InstallScripts.Windows(parameters, goarch),
        };

        await audit.LogAsync("agent.installer-created", "site", site.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Instalador {request.Plat} gerado para o site {site.Name}", cancellationToken: ct);
        return TypedResults.Ok(new InstallerResponse(command, expires, request.Plat));
    }

    private static async Task<IResult> ListDeploymentsAsync(HttpContext ctx, IConfiguration config, WinCareDbContext db, CancellationToken ct)
    {
        var url = PublicUrl(ctx, config);
        var rows = await db.Deployments.AsNoTracking()
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new { d.Id, d.Uid, d.Site!.ClientId, ClientName = d.Site.Client!.Name, d.SiteId, SiteName = d.Site.Name, d.MonitoringType,
                d.GoArch, d.ExpiresAt, d.CreatedAt, d.CreatedBy })
            .ToListAsync(ct);
        return TypedResults.Ok(rows.Select(d => new DeploymentDto(d.Id, d.Uid, d.ClientId, d.ClientName, d.SiteId, d.SiteName, d.MonitoringType,
            d.GoArch, d.ExpiresAt, d.CreatedAt, d.CreatedBy, DeploymentCommands(url, d.Uid))).ToList());
    }

    private static async Task<IResult> CreateDeploymentAsync(DeploymentRequest request, HttpContext ctx, IConfiguration config, ClaimsPrincipal principal,
        WinCareDbContext db, IDataProtectionProvider protection, IAuditService audit, TimeProvider time, CancellationToken ct)
    {
        if (request.ExpiresAt <= time.GetUtcNow())
        {
            return Problems.Validation("expiresAt", "A validade precisa estar no futuro");
        }
        var site = await db.Sites.AsNoTracking().Include(s => s.Client).FirstOrDefaultAsync(s => s.Id == request.SiteId, ct);
        if (site is null)
        {
            return Problems.Validation("siteId", "Site nao encontrado");
        }

        var token = AgentSecrets.NewInstallerToken();
        var createdBy = principal.Identity?.Name ?? "?";
        var expires = request.ExpiresAt.ToUniversalTime();
        var deployment = new Deployment
        {
            SiteId = site.Id,
            MonitoringType = request.AgentType,
            GoArch = request.GoArch ?? "amd64",
            ExpiresAt = expires,
            InstallerToken = new InstallerToken { TokenHash = AgentSecrets.Hash(token), ExpiresAt = expires, CreatedBy = createdBy },
            ProtectedToken = protection.CreateProtector(DeploymentPurpose).Protect(token),
            CreatedBy = createdBy,
        };
        db.Deployments.Add(deployment);
        await db.SaveChangesAsync(ct);

        await audit.LogAsync("deployment.created", "deployment", deployment.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Implantacao criada para o site {site.Name}", cancellationToken: ct);
        return TypedResults.Created($"/api/deployments/{deployment.Id}", new DeploymentDto(deployment.Id, deployment.Uid, site.ClientId, site.Client!.Name,
            site.Id, site.Name, deployment.MonitoringType, deployment.GoArch, deployment.ExpiresAt, deployment.CreatedAt, createdBy,
            DeploymentCommands(PublicUrl(ctx, config), deployment.Uid)));
    }

    private static async Task<IResult> DeleteDeploymentAsync(int id, WinCareDbContext db, IAuditService audit, CancellationToken ct)
    {
        var deployment = await db.Deployments.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (deployment is null)
        {
            return Problems.NotFound("Implantacao");
        }

        await db.InstallerTokens.Where(t => t.Id == deployment.InstallerTokenId).ExecuteDeleteAsync(ct);
        await audit.LogAsync("deployment.deleted", "deployment", id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "Implantacao excluida", cancellationToken: ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> DeployScriptAsync(Guid uid, string plat, HttpContext ctx, IConfiguration config, WinCareDbContext db,
        IDataProtectionProvider protection, TimeProvider time, CancellationToken ct)
    {
        var deployment = await db.Deployments.AsNoTracking().Include(d => d.Site)
            .FirstOrDefaultAsync(d => d.Uid == uid && d.ExpiresAt > time.GetUtcNow(), ct);
        if (deployment is null)
        {
            return Results.NotFound();
        }

        var token = protection.CreateProtector(DeploymentPurpose).Unprotect(deployment.ProtectedToken);
        var parameters = new InstallParameters(PublicUrl(ctx, config), deployment.Site!.ClientId, deployment.SiteId, token, deployment.MonitoringType);
        return plat switch
        {
            "linux" => Results.Text(InstallScripts.Linux(parameters.ApiUrl, parameters), "text/x-shellscript"),
            "darwin" => Results.Text("#!/usr/bin/env bash\nset -euo pipefail\n" + InstallScripts.MacCommand(parameters, "arm64") + "\n", "text/x-shellscript"),
            "windows" => Results.Text(InstallScripts.Windows(parameters, deployment.GoArch), "text/plain"),
            _ => Results.NotFound(),
        };
    }

    private static IResult Download(string plat, string goarch, IOptions<AgentSettings> options)
    {
        if (plat is not ("linux" or "windows" or "darwin") || goarch is not ("amd64" or "386" or "arm64" or "arm"))
        {
            return Results.NotFound();
        }

        var settings = options.Value;
        var fileName = settings.FileName(plat, goarch);
        if (settings.BinariesPath is { Length: > 0 } dir)
        {
            var path = Path.Combine(dir, fileName);
            if (File.Exists(path))
            {
                return Results.File(path, "application/octet-stream", fileName);
            }
        }
        return Results.Redirect($"{settings.DownloadBaseUrl.TrimEnd('/')}/v{settings.LatestVersion}/{fileName}");
    }

    private static Dictionary<string, string> DeploymentCommands(string url, Guid uid) => new()
    {
        ["linux"] = $"curl -fsSL '{url}/api/deploy/{uid}/linux' | sudo bash",
        ["darwin"] = $"curl -fsSL '{url}/api/deploy/{uid}/darwin' | sudo bash",
        ["windows"] = $"irm '{url}/api/deploy/{uid}/windows' | iex",
    };
}
