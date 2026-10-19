using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace Cybereyes.Api.Mcp;

/// <summary>Maquinas com o EYES: consulta do estado e acoes remotas (comando, script, servicos, energia, atualizacoes).</summary>
[McpServerToolType]
public sealed class AgentTools(PlatformApi api)
{
    /// <summary>Rotas GET /api/agents/{id}/{secao} que o get_agent_details aceita.</summary>
    public static readonly IReadOnlySet<string> DetailSections = new HashSet<string>(StringComparer.Ordinal)
    {
        "health", "checks", "tasks", "policies", "software", "services", "processes", "updates", "startup", "history", "pending-actions",
        "asset", "tickets",
    };

    /// <summary>
    /// O comando espera o resultado dentro da mesma chamada HTTP; acima disso o proxy da plataforma encerra a resposta.
    /// </summary>
    public const int MaxWaitSeconds = 300;

    [McpServerTool(Name = "list_agents", Title = "Listar maquinas", ReadOnly = true, OpenWorld = false)]
    [Description("Lista as maquinas (agentes EYES) com status online/offline, sistema, usuario logado, cliente e site.")]
    public Task<string> ListAgents(int? clientId = null, int? siteId = null,
        [Description("online, offline ou overdue")] string? status = null,
        [Description("Hostname, usuario logado, IP ou descricao")] string? search = null,
        int page = 1, [Description("Ate 200")] int pageSize = 50, CancellationToken ct = default) =>
        api.GetAsync("/api/agents", ct, ("clientId", clientId), ("siteId", siteId), ("status", status), ("search", search), ("page", page),
            ("pageSize", pageSize));

    [McpServerTool(Name = "get_agent", Title = "Ver maquina", ReadOnly = true, OpenWorld = false)]
    [Description("Resumo da maquina: hardware, sistema, discos, IPs, usuario logado, ultimo contato, versao do EYES.")]
    public Task<string> GetAgent(int agentId, CancellationToken ct = default) => api.GetAsync($"/api/agents/{agentId}", ct);

    [McpServerTool(Name = "get_agent_details", Title = "Detalhes da maquina", ReadOnly = true, OpenWorld = false)]
    [Description("Uma secao da maquina: health (nota de saude), checks (monitoramento e resultados), tasks (tarefas agendadas), policies, software (inventario), services (lista ao vivo), processes (ao vivo), updates (Windows Update), startup (inicializacao do Windows), history (comandos e scripts ja executados), pending-actions, asset (inventario e responsavel), tickets (chamados da maquina).")]
    public Task<string> GetAgentDetails(int agentId, string section, CancellationToken ct = default)
    {
        var name = section.Trim().ToLowerInvariant();
        if (!DetailSections.Contains(name))
        {
            throw new McpException($"Secao invalida: use {string.Join(", ", DetailSections.Order(StringComparer.Ordinal))}");
        }
        return api.GetAsync($"/api/agents/{agentId}/{name}", ct);
    }

    [McpServerTool(Name = "run_command", Title = "Executar comando", Destructive = true, OpenWorld = false)]
    [Description("Executa um comando na maquina e devolve a saida. Windows: shell cmd ou powershell; Linux/macOS: /bin/bash, /bin/sh ou /bin/zsh. Fica no historico da maquina e na auditoria.")]
    public Task<string> RunCommand(int agentId,
        [Description("cmd, powershell, /bin/bash, /bin/sh ou /bin/zsh")] string shell,
        string command,
        [Description("Segundos de espera, 10 a 300")] int timeoutSeconds = 60,
        [Description("true: roda na sessao do usuario logado (Windows), em vez de SYSTEM/root")] bool runAsUser = false,
        CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/command",
            new { shell, command, timeout = Math.Clamp(timeoutSeconds, 10, MaxWaitSeconds), runAsUser }, ct);

    [McpServerTool(Name = "run_script", Title = "Executar script da biblioteca", Destructive = true, OpenWorld = false)]
    [Description("Executa um script da biblioteca (ids em list_scripts) e devolve stdout, stderr e codigo de saida.")]
    public Task<string> RunScript(int agentId, int scriptId, string[]? args = null,
        [Description("Variaveis de ambiente no formato NOME=valor")] string[]? envVars = null,
        [Description("Segundos de espera, 5 a 300; sem valor, o padrao do script")] int? timeoutSeconds = null,
        bool runAsUser = false, CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/runscript",
            new { scriptId, args, envVars, timeout = timeoutSeconds is { } t ? Math.Clamp(t, 5, MaxWaitSeconds) : (int?)null, runAsUser }, ct);

    [McpServerTool(Name = "service_action", Title = "Iniciar, parar ou reiniciar servico", Destructive = true, OpenWorld = false)]
    [Description("Inicia, para ou reinicia um servico da maquina (nome interno do servico, veja get_agent_details section=services).")]
    public Task<string> ServiceAction(int agentId, string serviceName, [Description("start, stop ou restart")] string action,
        CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/services/{PlatformApi.Segment(serviceName)}/action", new { action }, ct);

    [McpServerTool(Name = "kill_process", Title = "Encerrar processo", Destructive = true, OpenWorld = false)]
    [Description("Encerra um processo pelo PID (veja get_agent_details section=processes).")]
    public Task<string> KillProcess(int agentId, int pid, CancellationToken ct = default) =>
        api.DeleteAsync($"/api/agents/{agentId}/processes/{pid}", ct);

    [McpServerTool(Name = "power_action", Title = "Reiniciar, desligar ou ligar maquina", Destructive = true, OpenWorld = false)]
    [Description("reboot reinicia e shutdown desliga a maquina agora (o usuario perde o que nao salvou: so com pedido explicito). wake liga pela rede (Wake-on-LAN) usando outra maquina online do mesmo site.")]
    public Task<string> PowerAction(int agentId, [Description("reboot, shutdown ou wake")] string action, CancellationToken ct = default) =>
        action.Trim().ToLowerInvariant() switch
        {
            "reboot" => api.PostAsync($"/api/agents/{agentId}/reboot", null, ct),
            "shutdown" => api.PostAsync($"/api/agents/{agentId}/shutdown", null, ct),
            "wake" => api.PostAsync($"/api/agents/{agentId}/wake", null, ct),
            _ => throw new McpException("Acao invalida: use reboot, shutdown ou wake"),
        };

    [McpServerTool(Name = "run_checks", Title = "Rodar checks agora", OpenWorld = false)]
    [Description("Pede a maquina para rodar todos os checks de monitoramento agora; os resultados chegam em segundos (get_agent_details section=checks).")]
    public Task<string> RunChecks(int agentId, CancellationToken ct = default) => api.PostAsync($"/api/agents/{agentId}/checks/run", null, ct);

    [McpServerTool(Name = "run_task", Title = "Rodar tarefa agendada", Destructive = true, OpenWorld = false)]
    [Description("Executa agora uma tarefa agendada da maquina (ids em get_agent_details section=tasks).")]
    public Task<string> RunTask(int agentId, int taskId, CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/tasks/{taskId}/run", null, ct);

    [McpServerTool(Name = "refresh_software", Title = "Atualizar lista de programas", ReadOnly = true, OpenWorld = false)]
    [Description("Le ao vivo os programas instalados na maquina e atualiza o inventario.")]
    public Task<string> RefreshSoftware(int agentId, CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/software/refresh", null, ct);

    [McpServerTool(Name = "install_software", Title = "Instalar programa", Destructive = true, OpenWorld = false)]
    [Description("Instala um pacote na maquina Windows (nome do pacote do catalogo). Roda em segundo plano: acompanhe em get_agent_details section=pending-actions.")]
    public Task<string> InstallSoftware(int agentId, [Description("Nome do pacote, ex.: googlechrome, 7zip")] string package,
        CancellationToken ct = default) =>
        api.PostAsync($"/api/agents/{agentId}/software/install", new { package }, ct);

    [McpServerTool(Name = "windows_updates", Title = "Windows Update", Destructive = true, OpenWorld = false)]
    [Description("scan procura atualizacoes do Windows; install instala agora as aprovadas (pode reiniciar a maquina conforme a politica). A lista fica em get_agent_details section=updates.")]
    public Task<string> WindowsUpdates(int agentId, [Description("scan ou install")] string action, CancellationToken ct = default) =>
        action.Trim().ToLowerInvariant() switch
        {
            "scan" => api.PostAsync($"/api/agents/{agentId}/updates/scan", null, ct),
            "install" => api.PostAsync($"/api/agents/{agentId}/updates/install", null, ct),
            _ => throw new McpException("Acao invalida: use scan ou install"),
        };
}
