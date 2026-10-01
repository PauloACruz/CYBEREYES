using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WinCare.Api.Inventory;
using WinCare.Core.Persistence;

namespace WinCare.Api.Tests;

public sealed partial class AgentTests
{
    private const string WindowsWmi = """
        {"comp_sys":[[{"Manufacturer":"Dell Inc.","Model":"OptiPlex 7090"}]],
         "bios":[[{"SerialNumber":"ABC1234"}]],
         "cpu":[[{"Name":"Intel(R) Core(TM) i5-10500"}]],
         "graphics":[[{"Caption":"Intel(R) UHD Graphics 630"}]],
         "disk":[[{"Caption":"SAMSUNG SSD","Size":"256060514304"}]],
         "network_config":[[{"IPEnabled":true,"IPAddress":["10.20.30.40","fe80::1"]}]]}
        """;

    private async Task UpdateAgentAsync(int pk, Action<WinCare.Core.Rmm.Agent> change)
    {
        using var scope = fixture.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<WinCareDbContext>();
        change(await db.Agents.SingleAsync(a => a.Id == pk));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task AgentAsset_HasHardware_SuggestsResponsible_AndKeepsAssignmentHistory()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente inventario", plat: "windows", monitoringType: "workstation");
        await UpdateAgentAsync(pk, a =>
        {
            a.WmiDetail = WindowsWmi;
            a.LoggedInUsername = @"EMPRESA\maria.souza";
            a.TotalRam = 16;
        });
        var maria = await (await admin.PostAsJsonAsync("/api/people", new { clientId, name = "Maria Souza", username = "maria.souza", active = true }))
            .Content.ReadFromJsonAsync<IdOnly>();
        var joao = await (await admin.PostAsJsonAsync("/api/people", new { clientId, name = "Joao Lima", active = true })).Content.ReadFromJsonAsync<IdOnly>();

        var assetId = (await admin.GetFromJsonAsync<JsonElement>($"/api/agents/{pk}/asset")).GetProperty("assetId").GetInt32();
        var sheet = await admin.GetFromJsonAsync<JsonElement>($"/api/assets/{assetId}");
        Assert.Equal("Dell Inc.", sheet.GetProperty("asset").GetProperty("manufacturer").GetString());
        Assert.Equal("OptiPlex 7090", sheet.GetProperty("asset").GetProperty("model").GetString());
        Assert.Equal("ABC1234", sheet.GetProperty("asset").GetProperty("serialNumber").GetString());
        Assert.Equal("Intel(R) Core(TM) i5-10500", sheet.GetProperty("hardware").GetProperty("cpus")[0].GetString());
        Assert.Equal(16, sheet.GetProperty("hardware").GetProperty("ramGb").GetInt32());
        Assert.Equal(maria!.Id, sheet.GetProperty("suggestedPerson").GetProperty("id").GetInt32());

        var edited = await admin.PutAsJsonAsync($"/api/assets/{assetId}", new
        {
            clientId, type = "laptop", name = "ignorado", status = "active", assetTag = "PAT-0001", macAddress = "aa-bb-cc-dd-ee-ff", ipAddress = "10.20.30.40",
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var asset = (await edited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("asset");
        Assert.Equal("mon-windows", asset.GetProperty("name").GetString());
        Assert.Equal("laptop", asset.GetProperty("type").GetString());
        Assert.Equal("AA:BB:CC:DD:EE:FF", asset.GetProperty("macAddress").GetString());

        await admin.PutAsJsonAsync($"/api/assets/{assetId}/responsible", new { personId = maria.Id });
        var after = await (await admin.PutAsJsonAsync($"/api/assets/{assetId}/responsible", new { personId = joao!.Id, notes = "Troca de setor" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Joao Lima", after.GetProperty("responsible").GetProperty("name").GetString());
        var history = after.GetProperty("history").EnumerateArray().ToList();
        Assert.Equal(2, history.Count);
        Assert.Equal(JsonValueKind.Null, history[0].GetProperty("unassignedAt").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, history[1].GetProperty("unassignedAt").ValueKind);

        var list = await admin.GetFromJsonAsync<JsonElement>($"/api/assets?clientId={clientId}&search=PAT-0001");
        Assert.Equal("Joao Lima", list.GetProperty("items")[0].GetProperty("responsible").GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/assets/{assetId}")).StatusCode);
    }

    [Fact]
    public async Task Network_NormalizesCidr_ValidatesIps_AndDiscoversAgentAddresses()
    {
        var (admin, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente rede", plat: "windows", monitoringType: "workstation");
        await UpdateAgentAsync(pk, a => a.WmiDetail = WindowsWmi);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/networks", new { clientId, name = "Errada", cidr = "10.20.30.0/40" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/networks", new { clientId, name = "Gateway fora", cidr = "10.20.30.0/24", gateway = "10.99.0.1" })).StatusCode);

        var created = await admin.PostAsJsonAsync("/api/networks", new { clientId, name = "LAN", cidr = "10.20.30.7/24", vlanId = 10, gateway = "10.20.30.1" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var network = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("10.20.30.0/24", network.GetProperty("cidr").GetString());
        var id = network.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/networks/{id}/ips", new { address = "10.20.31.5", kind = "static" })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync($"/api/networks/{id}/ips", new { address = "10.20.30.1", kind = "static", hostname = "gw" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/networks/{id}/ips", new { address = "10.20.30.1", kind = "reserved" })).StatusCode);

        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/networks/{id}");
        Assert.Equal(254, detail.GetProperty("totalHosts").GetInt64());
        var found = Assert.Single(detail.GetProperty("discovered").EnumerateArray());
        Assert.Equal("10.20.30.40", found.GetProperty("address").GetString());
        Assert.Equal("agent", found.GetProperty("source").GetString());
    }

    [Fact]
    public async Task Credential_IsEncryptedAtRest_ListHidesSecret_AndRevealIsAudited()
    {
        var (admin, clientId, _) = await NewSiteAsync("Cliente cofre");
        var created = await admin.PostAsJsonAsync("/api/credentials", new { clientId, name = "Firewall", username = "admin", secret = "S3nha-Do-Firewall", url = "https://10.0.0.1" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<IdOnly>())!.Id;

        using (var scope = fixture.Services.CreateScope())
        {
            var stored = await scope.ServiceProvider.GetRequiredService<WinCareDbContext>().Credentials.SingleAsync(c => c.Id == id);
            Assert.StartsWith("v1:", stored.SecretEncrypted, StringComparison.Ordinal);
            Assert.DoesNotContain("S3nha", stored.SecretEncrypted, StringComparison.Ordinal);
        }

        var list = await admin.GetStringAsync($"/api/credentials?clientId={clientId}");
        Assert.DoesNotContain("S3nha", list, StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/credentials", new { clientId, name = "Sem senha" })).StatusCode);

        var revealed = await (await admin.PostAsync($"/api/credentials/{id}/reveal", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("S3nha-Do-Firewall", revealed.GetProperty("secret").GetString());
        var audit = await admin.GetStringAsync("/api/audit?action=credential.reveal");
        Assert.Contains("Firewall", audit, StringComparison.Ordinal);
    }
}

public sealed class NetUtilTests
{
    [Theory]
    [InlineData("192.168.1.10/24", "192.168.1.0/24")]
    [InlineData("10.0.0.0/8", "10.0.0.0/8")]
    [InlineData("2001:db8::1/64", "2001:db8::/64")]
    public void ParseCidr_Normalizes(string input, string expected) => Assert.Equal(expected, NetUtil.ParseCidr(input)!.ToString());

    [Theory]
    [InlineData("192.168.1.0/33")]
    [InlineData("192.168.1.0")]
    [InlineData("abc/24")]
    public void ParseCidr_RejectsInvalid(string input) => Assert.Null(NetUtil.ParseCidr(input));

    [Fact]
    public void NormalizeMac_AcceptsCommonFormats()
    {
        Assert.Equal("00:1A:2B:3C:4D:5E", NetUtil.NormalizeMac("00-1a-2b-3c-4d-5e"));
        Assert.Null(NetUtil.NormalizeMac("00:1A:2B:3C:4D"));
    }
}
