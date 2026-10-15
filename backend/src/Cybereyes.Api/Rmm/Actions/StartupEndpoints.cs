using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Nats;
using Cybereyes.Api.Rmm.Procedures;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Actions;

/// <summary>Programa da inicializacao: chave Run (maquina 64/32 bits ou usuario) ou arquivo da pasta Inicializar.</summary>
public sealed record StartupItemDto(string Scope, string Location, string Name, string? User, string? Command, string? File, string? Description,
    string? Publisher, bool Enabled, DateTimeOffset? DisabledAt);

/// <summary>Itens e os usuarios com sessao aberta (os sem sessao nao tem o registro carregado e ficam de fora).</summary>
public sealed record StartupListDto(IReadOnlyList<StartupItemDto> Items, IReadOnlyList<string> Users);

public sealed record StartupChangeRequest(
    [property: Required, StringLength(200)] string Scope,
    [property: Required, StringLength(20)] string Location,
    [property: Required, StringLength(260, MinimumLength = 1)] string Name,
    bool Enabled);

/// <summary>
/// Programas da inicializacao do Windows pelo script embutido win-conf-inicializacao.ps1: lista e habilita ou desabilita como o
/// Gerenciador de Tarefas (StartupApproved), sem apagar a entrada. Roda pelo runscriptfull, entao vale para qualquer versao do EYES.
/// </summary>
public static partial class StartupEndpoints
{
    public const string ScriptName = "Programas da inicializacao";
    private const int TimeoutSeconds = 90;
    private const string JsonPrefix = "JSONB64:";
    private const string ResultPrefix = "RESULTADO:";
    private static readonly HashSet<string> Locations = new(StringComparer.Ordinal) { "Run", "Run32", "StartupFolder" };

    private static readonly Lazy<string> ScriptBody = new(() =>
    {
        using var stream = typeof(StartupEndpoints).Assembly.GetManifestResourceStream("Cybereyes.Scripts.win-conf-inicializacao.ps1")
            ?? throw new InvalidOperationException("Script da inicializacao ausente do assembly");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });

    [GeneratedRegex("^(HKLM|S-1-5-21-[0-9-]+)$")]
    private static partial Regex Scope();

    public static void MapStartupEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/agents/{id:int}/startup").WithTags("Acoes no agente");
        g.MapGet("/", ListAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsView));
        g.MapPut("/", ChangeAsync).RequireAuthorization(Policies.Permission(Permissions.AgentsControl));
    }

    private static async Task<IResult> ListAsync(int id, CybereyesDbContext db, IAgentRpc rpc, CancellationToken ct)
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
        try
        {
            var result = await RunAsync(rpc, agent.AgentId, [], 0, ct);
            return Parse(result) is { } list ? TypedResults.Ok(list) : Failure(result);
        }
        catch (AgentRpcTimeoutException)
        {
            return Problems.AgentTimeout();
        }
    }

    private static async Task<IResult> ChangeAsync(int id, StartupChangeRequest request, ClaimsPrincipal principal, CybereyesDbContext db, IAgentRpc rpc,
        IAuditService audit, ProcedureLog procedures, CancellationToken ct)
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
        if (!Scope().IsMatch(request.Scope) || !Locations.Contains(request.Location) || (request.Location == "Run32" && request.Scope != "HKLM") ||
            request.Name.Any(char.IsControl))
        {
            return Problems.BadRequest("Entrada da inicializacao invalida");
        }

        var action = request.Enabled ? "habilitar" : "desabilitar";
        var done = request.Enabled ? "habilitado" : "desabilitado";
        // O nome vai em base64 por variavel de ambiente: espacos, aspas e acentos nao passam pela linha de comando.
        List<string> envVars =
        [
            $"CYBEREYES_INICIO_ACAO={action}",
            $"CYBEREYES_INICIO_ESCOPO={request.Scope}",
            $"CYBEREYES_INICIO_LOCAL={request.Location}",
            $"CYBEREYES_INICIO_NOME_B64={Convert.ToBase64String(Encoding.UTF8.GetBytes(request.Name))}",
        ];
        var where = request.Scope == "HKLM" ? "todos os usuarios" : "usuario";
        var history = new AgentHistory
        {
            AgentId = id,
            Type = AgentHistoryType.ScriptRun,
            Command = $"{action} {request.Location} {request.Name} ({where})",
            Username = principal.Identity?.Name ?? "?",
            ScriptName = ScriptName,
        };
        db.AgentHistory.Add(history);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("agent.startup", "agent", id.ToString(CultureInfo.InvariantCulture),
            $"{agent.Hostname}: {request.Name} {done} na inicializacao", cancellationToken: ct);
        var procedure = await procedures.StartAsync(id, ProcedureKind.Startup, $"{request.Name} {done}", request.Scope == "HKLM" ? "Todos os usuários" : null,
            refType: ProcedureRef.History, refId: history.Id.ToString(CultureInfo.InvariantCulture), ct: ct);
        try
        {
            var result = await RunAsync(rpc, agent.AgentId, envVars, (int)history.Id, ct);
            history.ScriptResults = JsonSerializer.Serialize(result);
            await db.SaveChangesAsync(ct);
            var list = result.Retcode == 0 ? Parse(result) : null;
            await procedures.FinishAsync(procedure, list is null ? ProcedureStatus.Error : ProcedureStatus.Ok, ct: CancellationToken.None);
            return list is null ? Failure(result) : TypedResults.Ok(list);
        }
        catch (AgentRpcTimeoutException)
        {
            await procedures.FinishAsync(procedure, ProcedureStatus.Timeout, ct: CancellationToken.None);
            return Problems.AgentTimeout();
        }
        catch
        {
            await procedures.FinishAsync(procedure, ProcedureStatus.Error, ct: CancellationToken.None);
            throw;
        }
    }

    private static async Task<ScriptResultDto> RunAsync(IAgentRpc rpc, string agentId, List<string> envVars, int historyId, CancellationToken ct)
    {
        var reply = await rpc.RequestAsync(agentId, new Dictionary<string, object?>
        {
            ["func"] = "runscriptfull",
            ["timeout"] = TimeoutSeconds,
            ["script_args"] = Array.Empty<string>(),
            ["payload"] = new Dictionary<string, string> { ["code"] = ScriptBody.Value, ["shell"] = "powershell" },
            ["run_as_user"] = false,
            ["env_vars"] = envVars,
            ["nushell_enable_config"] = false,
            ["deno_default_permissions"] = string.Empty,
            ["id"] = historyId,
        }, TimeSpan.FromSeconds(TimeoutSeconds + 5), ct);
        return CommandEndpoints.ParseScriptResult(reply);
    }

    /// <summary>Lista da linha JSONB64 (JSON em UTF-8, em base64), ou nulo quando o script nao chegou a lista-la.</summary>
    internal static StartupListDto? Parse(ScriptResultDto result)
    {
        var line = result.Stdout.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith(JsonPrefix, StringComparison.Ordinal));
        if (line is null)
        {
            return null;
        }
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(line[JsonPrefix.Length..]));
            var list = JsonSerializer.Deserialize<StartupListDto>(json, JsonSerializerOptions.Web);
            if (list is null)
            {
                return null;
            }
            var items = (list.Items ?? []).OrderBy(i => i.User ?? string.Empty, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
            return new StartupListDto(items, list.Users ?? []);
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return null;
        }
    }

    /// <summary>O script recusou ou falhou (entrada sumiu, usuario saiu da sessao): 409 com a linha RESULTADO.</summary>
    private static IResult Failure(ScriptResultDto result)
    {
        var line = result.Stdout.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith(ResultPrefix, StringComparison.Ordinal));
        var message = line is not null
            ? line[ResultPrefix.Length..].Trim()
            : result.Stderr.Trim() is { Length: > 0 } error ? error[..Math.Min(error.Length, 500)] : $"O script terminou com o codigo {result.Retcode}";
        return Problems.Conflict(message);
    }
}
