using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

/// <summary>Canal files com o EYES real (contrato, secao 7): navegar, enviar em blocos com retomada, baixar com Range e zip.</summary>
[Collection(ApiCollection.Name)]
public sealed class RemoteFilesE2ETests(ApiFixture fixture)
{
    [EyesFact]
    public async Task Remote_FilesUploadResumeDownloadAndZip()
    {
        await using var agent = await RealAgent.StartAsync(fixture, "Cliente arquivos real");
        var http = agent.Http;
        var created = await http.PostAsJsonAsync($"/api/agents/{agent.Pk}/remote/sessions", new { channels = new[] { "files" } });
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync() + "\n" + agent.Eyes.Log);
        using var session = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var sid = session.RootElement.GetProperty("sessionId").GetString()!;
        var root = Directory.CreateTempSubdirectory("cybereyes-arquivos-").FullName;
        try
        {
            var mkdir = await http.PostAsJsonAsync($"/api/remote/sessions/{sid}/files/mkdir", new { path = root + "/Pasta" });
            Assert.True(mkdir.StatusCode == HttpStatusCode.NoContent, await mkdir.Content.ReadAsStringAsync() + "\n" + agent.Eyes.Log);

            // Envio de 2,5 MB em blocos de 1 MiB, com uma "queda" no meio e retomada pelo POST de novo.
            var content = RandomNumberGenerator.GetBytes(2_500_000);
            var dest = root + "/Pasta/relatório.bin";
            var begin = await http.PostAsJsonAsync($"/api/remote/sessions/{sid}/uploads", new { path = dest, size = content.Length, overwrite = false });
            Assert.Equal(HttpStatusCode.Created, begin.StatusCode);
            var upload = await begin.Content.ReadFromJsonAsync<JsonElement>();
            var transfer = upload.GetProperty("transferId").GetUInt32();
            Assert.Equal(200, (int)(await PutAsync(http, sid, transfer, content, 0, 1 << 20)).StatusCode);

            var resumed = await (await http.PostAsJsonAsync($"/api/remote/sessions/{sid}/uploads", new { path = dest, size = content.Length, overwrite = false }))
                .Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(transfer, resumed.GetProperty("transferId").GetUInt32());
            Assert.Equal(1 << 20, resumed.GetProperty("received").GetInt64());

            // Bloco fora de ordem: 416 com o que ja chegou.
            var wrong = await PutAsync(http, sid, transfer, content, 2 << 20, content.Length - (2 << 20));
            Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, wrong.StatusCode);

            Assert.Equal(200, (int)(await PutAsync(http, sid, transfer, content, 1 << 20, 1 << 20)).StatusCode);
            Assert.Equal(200, (int)(await PutAsync(http, sid, transfer, content, 2 << 20, content.Length - (2 << 20))).StatusCode);
            var complete = await http.PostAsync($"/api/remote/sessions/{sid}/uploads/{transfer}/complete", null);
            Assert.True(complete.IsSuccessStatusCode, await complete.Content.ReadAsStringAsync() + "\n" + agent.Eyes.Log);
            var done = await complete.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(content)), done.GetProperty("sha256").GetString());
            Assert.Equal(content, await File.ReadAllBytesAsync(dest));

            // Mesmo destino sem overwrite: 409 FILE_EXISTS.
            var again = await http.PostAsJsonAsync($"/api/remote/sessions/{sid}/uploads", new { path = dest, size = 10, overwrite = false });
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
            Assert.Contains("FILE_EXISTS", await again.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            // Lista com a pasta e o arquivo.
            var list = await http.GetFromJsonAsync<JsonElement>($"/api/remote/sessions/{sid}/files/list?path={Uri.EscapeDataString(root + "/Pasta")}");
            Assert.Equal("relatório.bin", list[0].GetProperty("name").GetString());
            Assert.Equal(content.Length, list[0].GetProperty("size").GetInt64());

            // Download inteiro e com Range.
            var full = await http.GetAsync($"/api/remote/sessions/{sid}/download?path={Uri.EscapeDataString(dest)}");
            Assert.Equal(HttpStatusCode.OK, full.StatusCode);
            Assert.Equal("relatório.bin", full.Content.Headers.ContentDisposition?.FileNameStar);
            Assert.Equal(content, await full.Content.ReadAsByteArrayAsync());
            using var ranged = new HttpRequestMessage(HttpMethod.Get, $"/api/remote/sessions/{sid}/download?path={Uri.EscapeDataString(dest)}");
            ranged.Headers.Range = new RangeHeaderValue(2_000_000, null);
            var partial = await http.SendAsync(ranged);
            Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
            Assert.Equal(content[2_000_000..], await partial.Content.ReadAsByteArrayAsync());

            // Pasta vira zip.
            var zip = await http.GetAsync($"/api/remote/sessions/{sid}/download?path={Uri.EscapeDataString(root + "/Pasta")}");
            Assert.Equal("application/zip", zip.Content.Headers.ContentType?.MediaType);
            using (var archive = new ZipArchive(new MemoryStream(await zip.Content.ReadAsByteArrayAsync())))
            {
                var entry = archive.GetEntry("Pasta/relatório.bin")!;
                using var data = new MemoryStream();
                await using (var s = entry.Open())
                {
                    await s.CopyToAsync(data);
                }
                Assert.Equal(content, data.ToArray());
            }

            // Arquivo inexistente e caminho com "..".
            Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"/api/remote/sessions/{sid}/download?path={Uri.EscapeDataString(root + "/nada.txt")}")).StatusCode);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await http.GetAsync($"/api/remote/sessions/{sid}/files/list?path={Uri.EscapeDataString(root + "/../etc")}")).StatusCode);

            var delete = await http.PostAsJsonAsync($"/api/remote/sessions/{sid}/files/delete", new { path = root + "/Pasta", recursive = true });
            Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
            Assert.False(Directory.Exists(root + "/Pasta"));

            Assert.Equal(HttpStatusCode.NoContent, (await http.DeleteAsync($"/api/remote/sessions/{sid}")).StatusCode);
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient http, string sid, uint transfer, byte[] content, int from, int length)
    {
        var body = new ByteArrayContent(content, from, length);
        body.Headers.ContentRange = new ContentRangeHeaderValue(from, from + length - 1, content.Length);
        return http.PutAsync($"/api/remote/sessions/{sid}/uploads/{transfer}", body);
    }
}
