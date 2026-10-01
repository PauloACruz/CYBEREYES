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
