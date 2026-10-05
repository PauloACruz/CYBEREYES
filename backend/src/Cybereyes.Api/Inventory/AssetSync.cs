using Microsoft.EntityFrameworkCore;
using Cybereyes.Core.Inventory;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Inventory;

/// <summary>
/// Mantem um ativo para cada agente: cria os que faltam, atualiza nome, local, tipo e dados de fabrica vindos do agente
/// e marca como baixados os ativos cujo agente foi excluido. Campos de cadastro manual nunca sao sobrescritos.
/// </summary>
public static class AssetSync
{
    public static async Task SyncAsync(CybereyesDbContext db, int? agentId, TimeProvider time, CancellationToken ct)
    {
        var agents = await db.Agents.AsNoTracking().Where(a => agentId == null || a.Id == agentId)
            .Select(a => new { a.Id, a.Hostname, a.SiteId, a.Site!.ClientId, a.MonitoringType, a.Plat, a.WmiDetail, a.TotalRam, a.OperatingSystem })
            .ToListAsync(ct);
        var ids = agents.Select(a => a.Id).ToList();
        var assets = await db.Assets.Where(x => x.AgentId != null && ids.Contains(x.AgentId.Value)).ToDictionaryAsync(x => x.AgentId!.Value, ct);
        var now = time.GetUtcNow();

        foreach (var agent in agents)
        {
            var hw = Hardware.Parse(agent.WmiDetail, agent.Plat, agent.TotalRam, agent.OperatingSystem, null, null);
            var type = agent.MonitoringType == MonitoringType.Workstation ? AssetType.Workstation : AssetType.Server;
            if (!assets.TryGetValue(agent.Id, out var asset))
            {
                asset = new Asset { Name = agent.Hostname, AgentId = agent.Id, FromAgent = true, Type = type, CreatedAt = now };
                db.Assets.Add(asset);
            }
            var changed = asset.Id == 0;
            changed |= Set(asset.Name, agent.Hostname, v => asset.Name = v);
            changed |= Set(asset.ClientId, agent.ClientId, v => asset.ClientId = v);
            changed |= Set(asset.SiteId, agent.SiteId, v => asset.SiteId = v);
            if (asset.Type != AssetType.Laptop)
            {
                changed |= Set(asset.Type, type, v => asset.Type = v);
            }
            if (hw is not null)
            {
                var manufacturer = Clip(hw.Manufacturer) ?? (hw.Manufacturer is null && hw.Model is null ? Clip(hw.MakeModel) : null);
                if (manufacturer is not null)
                {
                    changed |= Set(asset.Manufacturer, manufacturer, v => asset.Manufacturer = v);
                }
                if (Clip(hw.Model) is { } model)
                {
                    changed |= Set(asset.Model, model, v => asset.Model = v);
                }
                if (Clip(hw.SerialNumber) is { } serial)
                {
                    changed |= Set(asset.SerialNumber, serial, v => asset.SerialNumber = v);
                }
            }
            if (changed)
            {
                asset.UpdatedAt = now;
            }
        }

        if (agentId is null)
        {
            await db.Assets.Where(x => x.FromAgent && x.AgentId == null && x.Status != AssetStatus.Retired)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, AssetStatus.Retired).SetProperty(x => x.UpdatedAt, now), ct);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Outra replica criou o mesmo ativo ao mesmo tempo (indice unico em AgentId); a proxima rodada atualiza.
            db.ChangeTracker.Clear();
        }
    }

    private static string? Clip(string? value)
    {
        var text = value?.Trim();
        return string.IsNullOrEmpty(text) ? null : text.Length > 200 ? text[..200] : text;
    }

    private static bool Set<T>(T current, T value, Action<T> apply)
    {
        if (EqualityComparer<T>.Default.Equals(current, value))
        {
            return false;
        }
        apply(value);
        return true;
    }
}

public sealed partial class AssetSyncService(IServiceScopeFactory scopes, TimeProvider time, ILogger<AssetSyncService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await AssetSync.SyncAsync(scope.ServiceProvider.GetRequiredService<CybereyesDbContext>(), null, time, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogFailed(logger, ex);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falha ao sincronizar ativos dos agentes")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}
