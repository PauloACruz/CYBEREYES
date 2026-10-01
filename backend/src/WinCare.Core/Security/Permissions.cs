namespace WinCare.Core.Security;

public sealed record PermissionInfo(string Key, string Group, string Description);

public static class Permissions
{
    public const string UsersView = "users.view";
    public const string UsersManage = "users.manage";
    public const string RolesManage = "roles.manage";
    public const string ApiKeysManage = "apikeys.manage";
    public const string AuditView = "audit.view";
    public const string SettingsManage = "settings.manage";
    public const string ClientsView = "clients.view";
    public const string ClientsManage = "clients.manage";
    public const string AgentsView = "agents.view";
    public const string AgentsManage = "agents.manage";
    public const string AgentsInstall = "agents.install";
    public const string AgentsRun = "agents.run";
    public const string AgentsControl = "agents.control";
    public const string ScriptsView = "scripts.view";
    public const string ScriptsManage = "scripts.manage";
    public const string ChecksManage = "checks.manage";
    public const string PoliciesManage = "policies.manage";
    public const string AlertsView = "alerts.view";
    public const string AlertsManage = "alerts.manage";
    public const string PatchesManage = "patches.manage";
    public const string SoftwareManage = "software.manage";
    public const string AgentsRemote = "agents.remote";
    public const string TicketsView = "tickets.view";
    public const string TicketsManage = "tickets.manage";
    public const string InventoryView = "inventory.view";
    public const string InventoryManage = "inventory.manage";
    public const string DocsView = "docs.view";
    public const string DocsManage = "docs.manage";
    public const string CredentialsReveal = "credentials.reveal";
    public const string CredentialsManage = "credentials.manage";
    public const string WinCareRun = "wincare.run";
    public const string LogsView = "logs.view";
    public const string SnmpView = "snmp.view";
    public const string SnmpManage = "snmp.manage";
    public const string ReportsView = "reports.view";
    public const string ReportsManage = "reports.manage";

    public static IReadOnlyList<PermissionInfo> Catalog { get; } =
    [
        new(UsersView, "Usuarios", "Ver usuarios"),
        new(UsersManage, "Usuarios", "Criar, editar e excluir usuarios"),
        new(RolesManage, "Usuarios", "Gerenciar papeis e permissoes"),
        new(ApiKeysManage, "Integracoes", "Gerenciar chaves de API"),
        new(AuditView, "Auditoria", "Ver registros de auditoria"),
        new(SettingsManage, "Configuracoes", "Alterar configuracoes globais"),
        new(ClientsView, "Clientes", "Ver clientes e sites"),
        new(ClientsManage, "Clientes", "Criar, editar e excluir clientes e sites"),
        new(AgentsView, "Agentes", "Ver agentes e seus detalhes"),
        new(AgentsManage, "Agentes", "Excluir agentes e alterar suas configuracoes"),
        new(AgentsInstall, "Agentes", "Gerar instaladores e implantacoes de agentes"),
        new(AgentsRun, "Agentes", "Executar comandos, scripts e abrir terminal"),
        new(AgentsControl, "Agentes", "Encerrar processos, controlar servicos, editar registro, reiniciar e desligar"),
        new(ScriptsView, "Scripts", "Ver a biblioteca de scripts"),
        new(ScriptsManage, "Scripts", "Criar, editar e excluir scripts e snippets"),
        new(ChecksManage, "Monitoramento", "Criar, editar e excluir checks e tarefas"),
        new(PoliciesManage, "Monitoramento", "Gerenciar e atribuir politicas"),
        new(AlertsView, "Alertas", "Ver alertas"),
        new(AlertsManage, "Alertas", "Resolver e silenciar alertas, editar templates"),
        new(PatchesManage, "Atualizacoes", "Aprovar e instalar atualizacoes do Windows"),
        new(SoftwareManage, "Software", "Instalar software nos agentes"),
        new(AgentsRemote, "Agentes", "Acesso remoto pelo MeshCentral (tela, terminal e arquivos)"),
        new(TicketsView, "Chamados", "Ver chamados, conversas, anexos e apontamentos"),
        new(TicketsManage, "Chamados", "Criar, atribuir, responder e apontar horas em chamados"),
        new(InventoryView, "Inventario", "Ver ativos, pessoas e fichas das maquinas"),
        new(InventoryManage, "Inventario", "Cadastrar ativos e pessoas e atribuir responsaveis"),
        new(DocsView, "Documentacao", "Ver redes, IPs, diagramas, paginas e lista de credenciais"),
        new(DocsManage, "Documentacao", "Editar redes, IPs, diagramas, paginas e anexos"),
        new(CredentialsReveal, "Documentacao", "Revelar senhas guardadas no cofre"),
        new(CredentialsManage, "Documentacao", "Cadastrar e alterar credenciais do cofre"),
        new(WinCareRun, "Agentes", "Executar e cancelar modulos de manutencao WinCare"),
        new(LogsView, "Logs", "Ver logs de sistema das maquinas e traps SNMP"),
        new(SnmpView, "SNMP", "Ver dispositivos SNMP, interfaces, sensores e graficos"),
        new(SnmpManage, "SNMP", "Cadastrar dispositivos SNMP, sensores e coletores"),
        new(ReportsView, "Relatorios", "Gerar, visualizar e baixar relatorios"),
        new(ReportsManage, "Relatorios", "Criar e alterar agendamentos e excluir relatorios gerados"),
    ];

    private static readonly HashSet<string> Known = Catalog.Select(p => p.Key).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string key) => Known.Contains(key);
}
