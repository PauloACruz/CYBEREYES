using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Actions;

public sealed record RenameComputerRequest(
    [property: Required, StringLength(15)] string NewName,
    bool Restart,
    [property: StringLength(256)] string? DomainUser,
    [property: StringLength(256)] string? DomainPassword);

/// <summary>Resultado do script de renomear: o codigo de saida e a linha RESULTADO.</summary>
public sealed record RenameComputerResponse(long HistoryId, int Retcode, string Result, string Stdout, string Stderr);

/// <summary>Renomeia um computador Windows rodando pelo agente o script embutido win-conf-renomear-computador.ps1.</summary>
public static partial class RenameComputerEndpoints
{
    public const string ScriptName = "Renomear computador";
    private const int TimeoutSeconds = 120;
    private const string ResultPrefix = "RESULTADO:";

    private static readonly Lazy<string> ScriptBody = new(() =>
    {
        using var stream = typeof(RenameComputerEndpoints).Assembly.GetManifestResourceStream("Cybereyes.Scripts.win-conf-renomear-computador.ps1")
            ?? throw new InvalidOperationException("Script de renomear computador ausente do assembly");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });

    // Mesmas regras do script: ate 15 caracteres (NetBIOS), letras, numeros e hifen, sem hifen nas pontas e nao so numeros.
    [GeneratedRegex("^(?![0-9]+$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,13}[A-Za-z0-9])?$")]
    private static partial Regex ComputerName();

    public static void MapRenameComputerEndpoints(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/agents/{id:int}/rename", RenameAsync).WithTags("Acoes no agente")
            .RequireAuthorization(Policies.Permission(Permissions.AgentsControl));

    private static async Task<IResult> RenameAsync(int id, RenameComputerRequest request, ClaimsPrincipal principal, CybereyesDbContext db,
        IAgentRpc rpc, IAuditService audit, CancellationToken ct)
    {
        var agent = await AgentRef.FindAsync(db, id, ct);
        if (agent is null)
        {
            return Problems.NotFound("Agente");
        }
        if (!agent.IsWindows)
        {
            return Problems.BadRequest("Recurso disponivel somente para agentes Windows");
        }
        var name = request.NewName.Trim();
        if (!ComputerName().IsMatch(name))
        {
            return Problems.Validation("newName", "Use de 1 a 15 letras sem acento, numeros e hifen; sem hifen no inicio ou no fim e nao so numeros");
        }
        var user = string.IsNullOrWhiteSpace(request.DomainUser) ? null : request.DomainUser.Trim();
        var password = string.IsNullOrEmpty(request.DomainPassword) ? null : request.DomainPassword;
        if ((user is null) != (password is null))
        {
            return Problems.Validation(user is null ? "domainUser" : "domainPassword", "Informe o usuario e a senha do dominio");
        }

        List<string> args = ["-NovoNome", name, "-Confirmar"];
        if (request.Restart)
        {
            args.Add("-Reiniciar");
        }
        // A credencial vai so por variavel de ambiente: nao entra nos argumentos, no historico nem na auditoria.
        List<string> envVars = user is null ? [] : [$"MANUTENCAOTI_DOMINIO_USUARIO={user}", $"MANUTENCAOTI_DOMINIO_SENHA={password}"];

        var history = new AgentHistory
        {
            AgentId = id,
            Type = AgentHistoryType.ScriptRun,
            Command = string.Join(' ', args),
            Username = principal.Identity?.Name ?? "?",
            ScriptName = ScriptName,
        };
        db.AgentHistory.Add(history);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("agent.rename", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"{agent.Hostname}: renomear para {name}{(request.Restart ? " e reiniciar" : string.Empty)}", cancellationToken: ct);

        try
        {
            var reply = await rpc.RequestAsync(agent.AgentId, new Dictionary<string, object?>
            {
                ["func"] = "runscriptfull",
                ["timeout"] = TimeoutSeconds,
                ["script_args"] = args,
                ["payload"] = new Dictionary<string, string> { ["code"] = ScriptBody.Value, ["shell"] = "powershell" },
                ["run_as_user"] = false,
                ["env_vars"] = envVars,
                ["nushell_enable_config"] = false,
                ["deno_default_permissions"] = string.Empty,
                ["id"] = (int)history.Id,
            }, TimeSpan.FromSeconds(TimeoutSeconds + 5), ct);

            var result = CommandEndpoints.ParseScriptResult(reply);
            history.ScriptResults = JsonSerializer.Serialize(result);
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new RenameComputerResponse(history.Id, result.Retcode, ResultLine(result), result.Stdout, result.Stderr));
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    /// <summary>Linha RESULTADO do script, sem o prefixo; sem ela, o fim do stderr (falha antes de o script rodar).</summary>
    private static string ResultLine(ScriptResultDto result)
    {
        var line = result.Stdout.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith(ResultPrefix, StringComparison.Ordinal));
        if (line is not null)
        {
            return line[ResultPrefix.Length..].Trim();
        }
        var error = result.Stderr.Trim();
        return error.Length > 0 ? error[..Math.Min(error.Length, 500)] : $"O script terminou com o codigo {result.Retcode}";
    }
}
