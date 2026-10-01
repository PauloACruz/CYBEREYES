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
    ];

    private static readonly HashSet<string> Known = Catalog.Select(p => p.Key).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string key) => Known.Contains(key);
}
