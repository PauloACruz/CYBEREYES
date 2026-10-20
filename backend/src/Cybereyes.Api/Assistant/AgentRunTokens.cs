using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Assistant;

/// <summary>
/// Quem age numa execucao do agente de IA: o tecnico que pediu, com as permissoes dele limitadas as do agente, e o agente
/// que executa (coautoria na auditoria). <see cref="ClientIds"/> nulo: o tecnico ve todos os clientes.
/// </summary>
public sealed record AgentRunIdentity(Guid UserId, string Username, string AgentName, IReadOnlyList<string> Permissions,
    IReadOnlyList<int>? ClientIds, DateTimeOffset ExpiresAt);

/// <summary>
/// Credenciais de uma execucao do agente. Valem so dentro do processo: o agente chama o MCP e as rotas pela propria maquina
/// (127.0.0.1), entao a outra replica nunca recebe uma delas. Duram o tempo da execucao e somem ao terminar.
/// </summary>
public sealed class AgentRunTokens(TimeProvider time)
{
    public const string Prefix = "cyr_";

    private readonly ConcurrentDictionary<string, AgentRunIdentity> tokens = new(StringComparer.Ordinal);

    public string Issue(AgentRunIdentity identity)
    {
        foreach (var expired in tokens.Where(t => t.Value.ExpiresAt <= time.GetUtcNow()).Select(t => t.Key).ToList())
        {
            tokens.TryRemove(expired, out _);
        }
        var token = Prefix + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        tokens[token] = identity;
        return token;
    }

    public void Revoke(string token) => tokens.TryRemove(token, out _);

    public static bool IsRunToken(string value) => value.StartsWith(Prefix, StringComparison.Ordinal);

    /// <summary>Principal ja com as permissoes da execucao: a transformacao de claims nao acrescenta as do tecnico.</summary>
    public ClaimsPrincipal? Authenticate(string token, string scheme)
    {
        if (!tokens.TryGetValue(token, out var run) || run.ExpiresAt <= time.GetUtcNow())
        {
            return null;
        }
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, run.UserId.ToString()),
            new(ClaimTypes.Name, run.Username),
            new(CybereyesClaims.Enriched, "1"),
            new(CybereyesClaims.AiAgent, run.AgentName),
        };
        claims.AddRange(run.Permissions.Select(p => new Claim(CybereyesClaims.Permission, p)));
        if (run.ClientIds is { } clientIds)
        {
            claims.Add(new Claim(CybereyesClaims.ClientScope, "1"));
            claims.AddRange(clientIds.Select(id => new Claim(CybereyesClaims.Client, id.ToString(CultureInfo.InvariantCulture))));
        }
        return new ClaimsPrincipal(new ClaimsIdentity(claims, scheme));
    }
}
