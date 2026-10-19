using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace Cybereyes.Api.Mcp;

/// <summary>Contexto da plataforma: quem sou, clientes, painel, alertas, logs, scripts, documentacao, inventario e leitura geral.</summary>
[McpServerToolType]
public sealed class PlatformTools(PlatformApi api)
{
    [McpServerTool(Name = "whoami", Title = "Quem sou", ReadOnly = true, OpenWorld = false)]
    [Description("Usuario dono da chave de API e suas permissoes (o que as ferramentas podem fazer).")]
    public Task<string> WhoAmI(CancellationToken ct = default) => api.GetAsync("/api/auth/me", ct);

    [McpServerTool(Name = "list_clients", Title = "Clientes e sites", ReadOnly = true, OpenWorld = false)]
    [Description("Clientes com seus sites e contagem de maquinas.")]
    public Task<string> ListClients(CancellationToken ct = default) => api.GetAsync("/api/clients", ct);

    [McpServerTool(Name = "dashboard_overview", Title = "Painel", ReadOnly = true, OpenWorld = false)]
    [Description("Visao geral: maquinas online/offline, alertas, chamados, SLA e saude no periodo.")]
    public Task<string> DashboardOverview(int? clientId = null, [Description("Dias do periodo, padrao 30")] int? days = null,
        CancellationToken ct = default) =>
        api.GetAsync("/api/dashboard/overview", ct, ("clientId", clientId), ("days", days));

    [McpServerTool(Name = "list_alerts", Title = "Listar alertas", ReadOnly = true, OpenWorld = false)]
    [Description("Alertas de monitoramento (checks, tarefas, maquina offline, logs).")]
    public Task<string> ListAlerts([Description("active (padrao), resolved ou all")] string? status = null,
        [Description("info, warning ou error")] string? severity = null,
        int? clientId = null, int? agentId = null, int page = 1, CancellationToken ct = default) =>
        api.GetAsync("/api/alerts", ct, ("status", status), ("severity", severity), ("clientId", clientId), ("agentId", agentId), ("page", page));

    [McpServerTool(Name = "alert_action", Title = "Resolver ou adiar alertas", Idempotent = true, OpenWorld = false)]
    [Description("resolve encerra os alertas; snooze silencia ate a data informada.")]
    public Task<string> AlertAction(int[] alertIds, [Description("resolve ou snooze")] string action,
        [Description("Para snooze: ate quando (ISO 8601)")] DateTimeOffset? until = null, CancellationToken ct = default) =>
        api.PostAsync("/api/alerts/bulk", new { ids = alertIds, action, until }, ct);

    [McpServerTool(Name = "search_logs", Title = "Pesquisar logs", ReadOnly = true, OpenWorld = false)]
    [Description("Eventos coletados das maquinas (Visualizador de Eventos do Windows, journal do Linux, syslog de dispositivos), mais recentes primeiro.")]
    public Task<string> SearchLogs(int? agentId = null, int? clientId = null,
        [Description("critical, error, warning ou info")] string? level = null,
        [Description("Origem/provedor do evento")] string? source = null,
        [Description("Texto na mensagem")] string? search = null,
        [Description("Inicio (ISO 8601)")] DateTimeOffset? from = null,
        [Description("Fim (ISO 8601)")] DateTimeOffset? to = null,
        [Description("Ate 500, padrao 100")] int limit = 100, CancellationToken ct = default) =>
        api.GetAsync("/api/logs", ct, ("agentId", agentId), ("clientId", clientId), ("level", level), ("source", source), ("search", search),
            ("from", from), ("to", to), ("limit", Math.Clamp(limit, 1, 500)));

    [McpServerTool(Name = "logs_summary", Title = "Resumo dos logs", ReadOnly = true, OpenWorld = false)]
    [Description("Contagem de eventos por nivel e as origens mais frequentes no periodo.")]
    public Task<string> LogsSummary(int? agentId = null, int? clientId = null, DateTimeOffset? from = null, DateTimeOffset? to = null,
        CancellationToken ct = default) =>
        api.GetAsync("/api/logs/summary", ct, ("agentId", agentId), ("clientId", clientId), ("from", from), ("to", to));

    [McpServerTool(Name = "list_scripts", Title = "Biblioteca de scripts", ReadOnly = true, OpenWorld = false)]
    [Description("Scripts da biblioteca (sem o corpo): id, nome, descricao, shell, plataformas e argumentos padrao.")]
    public Task<string> ListScripts(CancellationToken ct = default) => api.GetAsync("/api/scripts", ct);

    [McpServerTool(Name = "get_script", Title = "Ver script", ReadOnly = true, OpenWorld = false)]
    [Description("Script com o corpo, para conferir o que ele faz antes de executar.")]
    public Task<string> GetScript(int scriptId, CancellationToken ct = default) => api.GetAsync($"/api/scripts/{scriptId}", ct);

    [McpServerTool(Name = "search_docs", Title = "Pesquisar documentacao", ReadOnly = true, OpenWorld = false)]
    [Description("Paginas da documentacao dos clientes (procedimentos, configuracoes, contatos). Credenciais do cofre nunca sao devolvidas.")]
    public Task<string> SearchDocs(int? clientId = null, string? search = null, CancellationToken ct = default) =>
        api.GetAsync("/api/doc-pages", ct, ("clientId", clientId), ("search", search));

    [McpServerTool(Name = "get_doc_page", Title = "Ler pagina da documentacao", ReadOnly = true, OpenWorld = false)]
    [Description("Conteudo de uma pagina da documentacao.")]
    public Task<string> GetDocPage(int pageId, CancellationToken ct = default) => api.GetAsync($"/api/doc-pages/{pageId}", ct);

    [McpServerTool(Name = "list_assets", Title = "Inventario", ReadOnly = true, OpenWorld = false)]
    [Description("Ativos do inventario (computadores, impressoras, rede, licencas) com responsavel e garantia.")]
    public Task<string> ListAssets(int? clientId = null, int? siteId = null, string? type = null, string? status = null, string? search = null,
        int page = 1, int pageSize = 50, CancellationToken ct = default) =>
        api.GetAsync("/api/assets", ct, ("clientId", clientId), ("siteId", siteId), ("type", type), ("status", status), ("search", search),
            ("page", page), ("pageSize", pageSize));

    [McpServerTool(Name = "api_get", Title = "Ler qualquer rota da API", ReadOnly = true, OpenWorld = false)]
    [Description("Leitura (GET) de qualquer rota JSON da API do Cybereyes que nao tenha ferramenta propria, com as permissoes da chave. Ex.: /api/agents/12/checks, /api/procedures?agentId=12, /api/snmp/devices, /api/webapps/overview, /api/policies. A referencia das rotas fica em docs/api do repositorio.")]
    public Task<string> ApiGet([Description("Caminho comecando em /api/, com a query string se precisar")] string path, CancellationToken ct = default)
    {
        var trimmed = path.Trim();
        if (!trimmed.StartsWith("/api/", StringComparison.Ordinal) || trimmed.Contains("..", StringComparison.Ordinal) ||
            trimmed.Contains("//", StringComparison.Ordinal) || trimmed.Contains('\\', StringComparison.Ordinal) ||
            trimmed.StartsWith(McpSetup.Route, StringComparison.OrdinalIgnoreCase))
        {
            throw new McpException("Informe um caminho da API que comece com /api/ (sem host, '..' ou '//')");
        }
        return api.GetAsync(trimmed, ct);
    }
}
