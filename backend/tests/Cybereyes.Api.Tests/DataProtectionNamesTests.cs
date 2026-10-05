using Cybereyes.Api.Infrastructure;

namespace Cybereyes.Api.Tests;

/// <summary>
/// Fixa os identificadores do ASP.NET Data Protection (ADR-019). Trocar qualquer um deles torna ilegiveis a senha SMTP,
/// os tokens de implantacao, o estado do SSO e os cookies ja emitidos.
/// </summary>
public sealed class DataProtectionNamesTests
{
    [Fact]
    public void LegacyCryptoNames_AreUnchanged()
    {
        Assert.Equal("WinCare", DataProtectionNames.ApplicationName);
        Assert.Equal("WinCare.Settings.Smtp", DataProtectionNames.SmtpPasswordPurpose);
        Assert.Equal("WinCare.Deployments.Token", DataProtectionNames.DeploymentTokenPurpose);
        Assert.Equal("WinCare.Sso.State", DataProtectionNames.SsoStatePurpose);
    }
}
