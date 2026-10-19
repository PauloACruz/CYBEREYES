using ModelContextProtocol.Protocol;

namespace Cybereyes.Api.Mcp;

/// <summary>
/// Servidor MCP do Cybereyes em /api/mcp (Streamable HTTP, sem sessao, para funcionar com varias replicas da API).
/// Autentica com uma chave de API (X-API-KEY ou Authorization: Bearer): o agente de IA age como o usuario dono da chave.
/// </summary>
public static class McpSetup
{
    public const string Route = "/api/mcp";

    public const string Instructions = """
        Cybereyes e a plataforma de suporte de TI da equipe: maquinas monitoradas pelo agente EYES (Windows, Linux e macOS),
        alertas, logs, scripts, inventario, documentacao dos clientes, o FAQ de problemas conhecidos e o service desk (chamados).
        Voce age como o usuario dono da chave de API: as ferramentas so fazem o que as permissoes dele permitem
        (whoami mostra quais sao) e tudo fica na auditoria em nome dele.

        Atendimento de um chamado:
        1. Leia o chamado inteiro com get_ticket (a conversa traz o que o usuario ja informou e as notas da equipe).
        2. Assuma com assign_ticket userId="me" antes de agir, para ninguem duplicar o trabalho.
        3. Procure a solucao no FAQ (search_faq com palavras do problema e o clientId do chamado): se houver entrada com
           guides=true, mande o passo a passo ao usuario como esta e registre o uso com faq_used.
           Investigue antes de mudar algo: get_agent, get_agent_details (health, checks, services, processes, software,
           updates, history), search_logs e list_alerts da maquina, search_docs do cliente.
        4. Acoes que mudam a maquina (run_command, run_script, service_action, kill_process, install_software,
           windows_updates, power_action) devem ser as menores que resolvem. Antes, registre o diagnostico e o plano em nota
           interna (reply_ticket internal=true). Nao reinicie nem desligue a maquina sem o pedido ou a concordancia do usuario,
           e prefira scripts revisados da biblioteca (list_scripts, get_script) a comandos improvisados.
        5. Fale com o usuario por reply_ticket (internal=false), em portugues do Brasil, com passos claros. Para esperar uma
           resposta dele, use set_ticket_status status="waiting_user".
        6. Ao terminar, resolve_ticket com kind="solution" (resolveu de vez) ou kind="workaround" (solucao de contorno) e o
           texto do que foi feito; apontar o tempo com add_ticket_time ajuda nos relatorios. Se o problema pode se repetir e
           o FAQ nao tem a solucao, registre-a com create_faq (fica como sugestao para a equipe revisar).
        Se nao der para resolver, deixe uma nota interna com o que foi verificado e tire o chamado de voce (assign_ticket "none").

        As respostas sao o JSON das rotas da API; datas em UTC (ISO 8601). Um erro HTTP 403 quer dizer que falta permissao
        ao usuario da chave; nao tente contornar. api_get le qualquer outra rota GET da API.
        """;

    public static IServiceCollection AddCybereyesMcp(this IServiceCollection services)
    {
        services.AddScoped<PlatformApi>();
        services.AddHttpClient(PlatformApi.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(AgentTools.MaxWaitSeconds + 30));
        services.AddMcpServer(o =>
            {
                o.ServerInfo = new Implementation { Name = "cybereyes", Title = "Cybereyes", Version = "1.0.0" };
                o.ServerInstructions = Instructions;
            })
            .WithHttpTransport(o => o.Stateless = true)
            .WithTools<TicketTools>()
            .WithTools<AgentTools>()
            .WithTools<PlatformTools>()
            .WithTools<FaqTools>();
        return services;
    }

    public static void MapCybereyesMcp(this IEndpointRouteBuilder app) =>
        app.MapMcp(Route).RequireAuthorization().ExcludeFromDescription();
}
