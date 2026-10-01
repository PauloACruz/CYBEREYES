using WinCare.Core.Security;

namespace WinCare.Api.Tests;

public sealed class ApiKeyGeneratorTests
{
    [Fact]
    public void Create_ReturnsKeyWhoseHashMatches_AndUniqueKeys()
    {
        var (key, prefix, hash) = ApiKeyGenerator.Create();
        var (other, _, _) = ApiKeyGenerator.Create();

        Assert.StartsWith(ApiKeyGenerator.KeyPrefix + prefix, key, StringComparison.Ordinal);
        Assert.Equal(hash, ApiKeyGenerator.Hash(key));
        Assert.NotEqual(key, other);
    }
}

public sealed class AgentStatusTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(1, "online")]
    [InlineData(10, "offline")]
    [InlineData(45, "overdue")]
    public void Compute_FollowsOfflineAndOverdueMinutes(int minutesAgo, string expected) =>
        Assert.Equal(expected, WinCare.Core.Rmm.AgentStatus.Compute(Now.AddMinutes(-minutesAgo), 4, 30, Now));

    [Fact]
    public void Compute_WithoutLastSeen_IsOffline() =>
        Assert.Equal("offline", WinCare.Core.Rmm.AgentStatus.Compute(null, 4, 30, Now));
}
