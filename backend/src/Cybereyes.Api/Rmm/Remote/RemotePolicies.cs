using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Rmm.Remote;

/// <summary>Politica efetiva de um agente, com todos os campos resolvidos (contrato, secao 8).</summary>
public sealed record EffectiveRemotePolicy(
    string Consent, int ConsentTimeoutSeconds, bool AllowAtLoginScreen, bool ClipboardToRemote, bool ClipboardToLocal,
    bool FilesUpload, bool FilesDownload, int MaxFileMb, int IdleMinutes, int MaxHours)
{
    private static readonly JsonSerializerOptions Camel = new(JsonSerializerDefaults.Web);

    /// <summary>Texto JSON enviado no campo policy do remote_start.</summary>
    public string ToAgentJson() => JsonSerializer.Serialize(this, Camel);
}

public static class RemotePolicies
{
    /// <summary>Resolve a politica do site do agente: site, depois cliente, depois global, depois os padroes.</summary>
    public static async Task<EffectiveRemotePolicy> ForSiteAsync(CybereyesDbContext db, int siteId, CancellationToken ct)
    {
        var clientId = await db.Sites.AsNoTracking().Where(s => s.Id == siteId).Select(s => s.ClientId).FirstOrDefaultAsync(ct);
        var rows = await db.RemotePolicies.AsNoTracking()
            .Where(p => p.Scope == RemotePolicyScope.Global
                || (p.Scope == RemotePolicyScope.Client && p.ScopeId == clientId)
                || (p.Scope == RemotePolicyScope.Site && p.ScopeId == siteId))
            .ToListAsync(ct);
        RemotePolicy? Pick(string scope) => rows.FirstOrDefault(r => r.Scope == scope);
        return Merge(RemotePolicy.Defaults(), Pick(RemotePolicyScope.Global), Pick(RemotePolicyScope.Client), Pick(RemotePolicyScope.Site));
    }

    /// <summary>Junta as camadas: o primeiro valor nao nulo a partir da mais especifica.</summary>
    public static EffectiveRemotePolicy Merge(RemotePolicy defaults, params RemotePolicy?[] layers)
    {
        T Get<T>(Func<RemotePolicy, T?> f, T fallback) where T : struct
        {
            for (var i = layers.Length - 1; i >= 0; i--)
            {
                if (layers[i] is { } l && f(l) is { } v)
                {
                    return v;
                }
            }
            return f(defaults) ?? fallback;
        }
        string GetConsent()
        {
            for (var i = layers.Length - 1; i >= 0; i--)
            {
                if (layers[i]?.Consent is { } c && RemoteConsent.IsValid(c))
                {
                    return c;
                }
            }
            return defaults.Consent ?? RemoteConsent.None;
        }
        return new EffectiveRemotePolicy(
            GetConsent(),
            Get(p => p.ConsentTimeoutSeconds, 60),
            Get(p => p.AllowAtLoginScreen, true),
            Get(p => p.ClipboardToRemote, true),
            Get(p => p.ClipboardToLocal, true),
            Get(p => p.FilesUpload, true),
            Get(p => p.FilesDownload, true),
            Get(p => p.MaxFileMb, 2048),
            Get(p => p.IdleMinutes, 30),
            Get(p => p.MaxHours, 8));
    }
}
