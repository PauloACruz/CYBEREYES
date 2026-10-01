using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace WinCare.Api.Rmm;

[Authorize]
public sealed class ConsoleHub : Hub;

public interface IAgentNotifier
{
    Task StatusChangedAsync(string agentId, string status, DateTimeOffset? lastSeen, CancellationToken ct = default);

    Task AgentsChangedAsync(CancellationToken ct = default);
}

public sealed class AgentNotifier(IHubContext<ConsoleHub> hub) : IAgentNotifier
{
    public Task StatusChangedAsync(string agentId, string status, DateTimeOffset? lastSeen, CancellationToken ct = default) =>
        hub.Clients.All.SendAsync("agentStatusChanged", new { agentId, status, lastSeen }, ct);

    public Task AgentsChangedAsync(CancellationToken ct = default) => hub.Clients.All.SendAsync("agentsChanged", ct);
}
