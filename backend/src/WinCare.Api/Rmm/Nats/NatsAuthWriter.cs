using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WinCare.Core.Persistence;

namespace WinCare.Api.Rmm.Nats;

/// <summary>
/// Gera o arquivo de usuarios do NATS a partir do banco: o usuario da API e um usuario por agente
/// (usuario = agent_id, senha = hash bcrypt do token), com permissoes restritas aos assuntos do proprio agente.
/// </summary>
public sealed partial class NatsAuthWriter(IServiceScopeFactory scopes, IOptions<NatsSettings> options, ILogger<NatsAuthWriter> logger) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task WriteAsync(CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.AuthFile) || string.IsNullOrWhiteSpace(settings.Password))
        {
            return;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
            var agents = await db.Agents.AsNoTracking()
                .OrderBy(a => a.Id)
                .Select(a => new { a.AgentId, a.NatsPasswordHash })
                .ToListAsync(cancellationToken);

            var content = Build(settings, agents.Select(a => (a.AgentId, a.NatsPasswordHash)));
            var path = settings.AuthFile;
            if (File.Exists(path) && await File.ReadAllTextAsync(path, cancellationToken) == content)
            {
                return;
            }

            var temp = path + ".tmp";
            await File.WriteAllTextAsync(temp, content, cancellationToken);
            File.Move(temp, path, overwrite: true);
            LogWritten(logger, agents.Count);
        }
        finally
        {
            gate.Release();
        }
    }

    public void Dispose() => gate.Dispose();

    public static string Build(NatsSettings settings, IEnumerable<(string AgentId, string PasswordHash)> agents)
    {
        var sb = new StringBuilder();
        sb.AppendLine("authorization {");
        sb.AppendLine("  users = [");
        sb.Append(CultureInfo.InvariantCulture,
            $"    {{user: {Quote(settings.User)}, password: {Quote(settings.Password ?? string.Empty)}, permissions: {{publish: \">\", subscribe: \">\"}}}}");
        foreach (var (agentId, hash) in agents)
        {
            var id = Quote(agentId);
            sb.AppendLine(",");
            sb.Append(CultureInfo.InvariantCulture,
                $"    {{user: {id}, password: {Quote(hash)}, permissions: {{publish: {{allow: [{id}, {Quote(agentId + ".cmdoutput.>")}, {Quote(agentId + ".terminal.>")}]}}, subscribe: {{allow: [{id}]}}, allow_responses: {{expires: {Quote(settings.ResponseExpiration)}}}}}}}");
        }
        sb.AppendLine();
        sb.AppendLine("  ]");
        sb.AppendLine("}");
        return sb.ToString();
    }

    private static string Quote(string value) =>
        "\"" + value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    [LoggerMessage(Level = LogLevel.Information, Message = "Arquivo de usuarios do NATS atualizado com {Count} agentes")]
    private static partial void LogWritten(ILogger logger, int count);
}
