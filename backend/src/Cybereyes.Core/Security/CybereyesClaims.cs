namespace Cybereyes.Core.Security;

public static class CybereyesClaims
{
    public const string Permission = "ce_perm";
    public const string Superuser = "ce_superuser";
    public const string Enriched = "ce_enriched";
    public const string AuthMethods = "amr";
    public const string Mfa = "mfa";
    public const string ApiKeyScheme = "ApiKey";
    public const string AgentTokenScheme = "AgentToken";
    public const string AgentPk = "ce_agent_pk";
    public const string AgentIdentifier = "ce_agent_id";
    public const string Installer = "ce_installer";
    public const string TrayAgent = "ce_tray_agent";
    public const string TrayUser = "ce_tray_user";
}
