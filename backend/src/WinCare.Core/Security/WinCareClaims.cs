namespace WinCare.Core.Security;

public static class WinCareClaims
{
    public const string Permission = "wc_perm";
    public const string Superuser = "wc_superuser";
    public const string Enriched = "wc_enriched";
    public const string AuthMethods = "amr";
    public const string Mfa = "mfa";
    public const string ApiKeyScheme = "ApiKey";
    public const string AgentTokenScheme = "AgentToken";
    public const string AgentPk = "wc_agent_pk";
    public const string AgentIdentifier = "wc_agent_id";
    public const string Installer = "wc_installer";
    public const string TrayAgent = "wc_tray_agent";
    public const string TrayUser = "wc_tray_user";
}
