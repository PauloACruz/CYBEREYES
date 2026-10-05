using Cybereyes.Api.Rmm;

namespace Cybereyes.Api.Tests;

/// <summary>
/// Fixa os nomes combinados com o agente Go e com o app de bandeja (ADR-019). Os valores sao escritos por extenso de
/// proposito: se alguem renomear uma constante junto com o produto, este teste falha antes do agente real quebrar.
/// </summary>
public sealed class AgentContractTests
{
    [Fact]
    public void CareFuncs_KeepTheNamesTheAgentUnderstands()
    {
        Assert.Equal("wincare_catalog", AgentContract.CareCatalogFunc);
        Assert.Equal("wincare_run", AgentContract.CareRunFunc);
        Assert.Equal("wincare_cancel", AgentContract.CareCancelFunc);
        Assert.Equal("wincare_health", AgentContract.CareHealthFunc);
    }

    [Fact]
    public void RunIdPrefix_LogSource_AndTrayEvent_KeepTheirValues()
    {
        Assert.Equal("wc-", AgentContract.CareRunIdPrefix);
        Assert.Equal("wincare-agent", AgentContract.LogSourceAgent);
        Assert.Equal("selfServiceChanged", AgentContract.TraySelfServiceChangedEvent);
    }
}
