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

    public static IReadOnlyList<PermissionInfo> Catalog { get; } =
    [
        new(UsersView, "Usuarios", "Ver usuarios"),
        new(UsersManage, "Usuarios", "Criar, editar e excluir usuarios"),
        new(RolesManage, "Usuarios", "Gerenciar papeis e permissoes"),
        new(ApiKeysManage, "Integracoes", "Gerenciar chaves de API"),
        new(AuditView, "Auditoria", "Ver registros de auditoria"),
        new(SettingsManage, "Configuracoes", "Alterar configuracoes globais"),
    ];

    private static readonly HashSet<string> Known = Catalog.Select(p => p.Key).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string key) => Known.Contains(key);
}
