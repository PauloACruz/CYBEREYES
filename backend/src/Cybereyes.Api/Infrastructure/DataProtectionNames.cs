namespace Cybereyes.Api.Infrastructure;

/// <summary>
/// Identificadores criptograficos legados: cifram dados ja gravados (senha SMTP, tokens de implantacao,
/// estado do SSO, cookies). Nao renomear com o produto nem ligar ao branding (ver ADR-019).
/// </summary>
public static class DataProtectionNames
{
    /// <summary>Discriminador do ASP.NET Data Protection; entra na derivacao de todas as subchaves.</summary>
    public const string ApplicationName = "WinCare";

    /// <summary>Purpose da senha SMTP gravada em core_settings.SmtpPasswordProtected.</summary>
    public const string SmtpPasswordPurpose = "WinCare.Settings.Smtp";

    /// <summary>Purpose do token de instalacao gravado em deployments.ProtectedToken.</summary>
    public const string DeploymentTokenPurpose = "WinCare.Deployments.Token";

    /// <summary>Purpose do cookie de estado do login OIDC.</summary>
    public const string SsoStatePurpose = "WinCare.Sso.State";
}
