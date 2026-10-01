namespace WinCare.Core.Security;

public static class WinCareClaims
{
    public const string Permission = "wc_perm";
    public const string Superuser = "wc_superuser";
    public const string Enriched = "wc_enriched";
    public const string AuthMethods = "amr";
    public const string Mfa = "mfa";
    public const string ApiKeyScheme = "ApiKey";
}
