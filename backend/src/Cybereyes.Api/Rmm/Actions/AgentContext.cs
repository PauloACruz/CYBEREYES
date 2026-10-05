using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Core.Persistence;

namespace Cybereyes.Api.Rmm.Actions;

public sealed record AgentRef(int Id, string AgentId, string Hostname, string Plat, string? Description, string? PublicIp,
    string ClientName, string SiteName)
{
    public bool IsWindows => Plat == "windows";

    public static Task<AgentRef?> FindAsync(CybereyesDbContext db, int id, CancellationToken ct) =>
        db.Agents.AsNoTracking().Where(a => a.Id == id)
            .Select(a => new AgentRef(a.Id, a.AgentId, a.Hostname, a.Plat, a.Description, a.PublicIp, a.Site!.Client!.Name, a.Site.Name))
            .FirstOrDefaultAsync(ct);
}

/// <summary>Substitui variaveis {{agent.x}}, {{client.name}}, {{site.name}} e {{global.NOME}} em argumentos e URLs.</summary>
public static partial class Variables
{
    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\}\}")]
    private static partial Regex VariablePattern();

    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")]
    private static partial Regex SnippetPattern();

    public static async Task<Func<string, string>> ResolverAsync(CybereyesDbContext db, AgentRef agent, bool urlEncode, CancellationToken ct)
    {
        var globals = await db.GlobalKeys.AsNoTracking().ToDictionaryAsync(k => k.Name, k => k.Value, StringComparer.OrdinalIgnoreCase, ct);
        return text => VariablePattern().Replace(text, m =>
        {
            var value = (m.Groups[1].Value.ToLowerInvariant(), m.Groups[2].Value.ToLowerInvariant()) switch
            {
                ("agent", "hostname") => agent.Hostname,
                ("agent", "agent_id") => agent.AgentId,
                ("agent", "description") => agent.Description ?? string.Empty,
                ("agent", "public_ip") => agent.PublicIp ?? string.Empty,
                ("agent", "id") => agent.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ("client", "name") => agent.ClientName,
                ("site", "name") => agent.SiteName,
                ("global", _) => globals.GetValueOrDefault(m.Groups[2].Value),
                _ => null,
            };
            return value is null ? m.Value : urlEncode ? Uri.EscapeDataString(value) : value;
        });
    }

    public static async Task<string> ExpandSnippetsAsync(CybereyesDbContext db, string body, CancellationToken ct)
    {
        var names = SnippetPattern().Matches(body).Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();
        if (names.Count == 0)
        {
            return body;
        }

        var snippets = await db.ScriptSnippets.AsNoTracking().Where(s => names.Contains(s.Name)).ToDictionaryAsync(s => s.Name, s => s.Code, ct);
        return SnippetPattern().Replace(body, m => snippets.TryGetValue(m.Groups[1].Value, out var code) ? code : m.Value);
    }
}
