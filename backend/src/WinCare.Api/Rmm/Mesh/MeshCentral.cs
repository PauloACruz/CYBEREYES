using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace WinCare.Api.Rmm.Mesh;

public sealed class MeshSettings
{
    public const string Section = "Mesh";

    /// <summary>Endereco publico do MeshCentral (ex.: https://mesh.empresa.com.br). Vazio desliga a integracao.</summary>
    public string? Url { get; set; }

    /// <summary>Usuario administrador do MeshCentral usado pela API.</summary>
    public string Username { get; set; } = "wincare";

    /// <summary>Arquivo com a chave de login (160 caracteres hex) gerada por "meshcentral --logintokenkey".</summary>
    public string? TokenKeyFile { get; set; }

    /// <summary>Chave de login informada diretamente (alternativa ao arquivo).</summary>
    public string? TokenKey { get; set; }

    public string DeviceGroup { get; set; } = "WinCare";

    /// <summary>Endereco interno usado pela API (ex.: http://meshcentral:4443, na rede do Docker). Vazio usa o publico.</summary>
    public string? InternalUrl { get; set; }

    public bool Enabled => !string.IsNullOrWhiteSpace(Url);
}

/// <summary>
/// Gera os tokens que o MeshCentral aceita (mesmo formato do encodeCookie do MeshCentral): JSON cifrado com AES-256-GCM
/// usando os primeiros 32 bytes da chave de login, montado como iv(12) + tag(16) + texto cifrado, em base64 com
/// "+" trocado por "@" e "/" por "$".
/// </summary>
public static class MeshTokens
{
    public static string Encode(byte[] key, object payload, TimeProvider time)
    {
        var node = JsonSerializer.SerializeToNode(payload)!.AsObject();
        node["time"] = time.GetUtcNow().ToUnixTimeSeconds();
        var plain = Encoding.UTF8.GetBytes(node.ToJsonString());
        var iv = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var cipher = new byte[plain.Length];
        using (var aes = new AesGcm(key.AsSpan(0, 32), 16))
        {
            aes.Encrypt(iv, plain, cipher, tag);
        }
        var all = new byte[12 + 16 + cipher.Length];
        iv.CopyTo(all, 0);
        tag.CopyTo(all, 12);
        cipher.CopyTo(all, 28);
        return Convert.ToBase64String(all).Replace('+', '@').Replace('/', '$');
    }

    public static string? Decode(byte[] key, string token)
    {
        var bytes = Convert.FromBase64String(token.Replace('@', '+').Replace('$', '/'));
        var plain = new byte[bytes.Length - 28];
        using var aes = new AesGcm(key.AsSpan(0, 32), 16);
        aes.Decrypt(bytes.AsSpan(0, 12), bytes.AsSpan(28), bytes.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }

    /// <summary>O agente guarda o node id em hexadecimal; o MeshCentral usa "node//" + base64 com "@" e "$".</summary>
    public static string NodeId(string hex) =>
        "node//" + Convert.ToBase64String(Convert.FromHexString(hex)).Replace('/', '$').Replace('+', '@');

    public static string MeshUsername(string username)
    {
        var clean = new string(username.ToLowerInvariant().Where(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-').ToArray());
        return "wc-" + (clean.Length == 0 ? "usuario" : clean);
    }
}

public sealed class MeshException(string message) : Exception(message);

/// <summary>Cliente do MeshCentral pelo websocket control.ashx, autenticado com o token do usuario administrador.</summary>
public sealed class MeshClient(IOptions<MeshSettings> options, TimeProvider time)
{
    private byte[]? key;

    public bool Enabled => options.Value.Enabled && LoadKey() is not null;

    public byte[]? LoadKey()
    {
        if (key is not null)
        {
            return key;
        }
        var settings = options.Value;
        var hex = settings.TokenKey;
        if (string.IsNullOrWhiteSpace(hex) && settings.TokenKeyFile is { } file && File.Exists(file))
        {
            hex = File.ReadAllText(file).Trim();
        }
        if (hex is not { Length: 160 } || !hex.All(char.IsAsciiHexDigit))
        {
            return null;
        }
        return key = Convert.FromHexString(hex);
    }

    public string BaseUrl => options.Value.Url!.TrimEnd('/');

    public string InternalBaseUrl => (string.IsNullOrWhiteSpace(options.Value.InternalUrl) ? options.Value.Url! : options.Value.InternalUrl).TrimEnd('/');

    public string LoginToken(string meshUser) =>
        MeshTokens.Encode(LoadKey() ?? throw new MeshException("Chave do MeshCentral indisponivel"), new { a = 3, u = $"user//{meshUser.ToLowerInvariant()}" }, time);

    public async Task<List<JsonObject>> SendAsync(IReadOnlyList<JsonObject> commands, CancellationToken ct)
    {
        var adminToken = MeshTokens.Encode(LoadKey() ?? throw new MeshException("Chave do MeshCentral indisponivel"),
            new { userid = $"user//{options.Value.Username.ToLowerInvariant()}", domainid = string.Empty }, time);
        var uri = new Uri(InternalBaseUrl.Replace("https://", "wss://", StringComparison.OrdinalIgnoreCase).Replace("http://", "ws://", StringComparison.OrdinalIgnoreCase)
            + "/control.ashx?auth=" + Uri.EscapeDataString(adminToken));

        using var socket = new ClientWebSocket();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        await socket.ConnectAsync(uri, timeout.Token);

        var replies = new List<JsonObject>();
        foreach (var command in commands)
        {
            var responseId = Guid.NewGuid().ToString("N");
            command["responseid"] = responseId;
            var action = command["action"]!.GetValue<string>();
            await socket.SendAsync(Encoding.UTF8.GetBytes(command.ToJsonString()), WebSocketMessageType.Text, true, timeout.Token);
            while (true)
            {
                var message = await ReceiveAsync(socket, timeout.Token);
                var reply = JsonNode.Parse(message) as JsonObject;
                if (reply is null)
                {
                    continue;
                }
                var replyAction = reply["action"]?.GetValue<string>();
                if (reply["responseid"]?.GetValue<string>() == responseId || (replyAction == action && action is "meshes" or "users" or "nodes"))
                {
                    replies.Add(reply);
                    break;
                }
            }
        }
        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        return replies;
    }

    public async Task<JsonObject> SendAsync(JsonObject command, CancellationToken ct) => (await SendAsync([command], ct))[0];

    private static async Task<string> ReceiveAsync(ClientWebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new MeshException("O MeshCentral encerrou a conexao");
            }
            stream.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>Retorna o id do grupo de dispositivos (sem o prefixo mesh//), criando o grupo se nao existir.</summary>
    public async Task<string> EnsureDeviceGroupAsync(CancellationToken ct)
    {
        var name = options.Value.DeviceGroup;
        var meshes = await SendAsync(new JsonObject { ["action"] = "meshes" }, ct);
        var found = (meshes["meshes"] as JsonArray ?? []).OfType<JsonObject>()
            .FirstOrDefault(m => m["name"]?.GetValue<string>() == name && m["mtype"]?.GetValue<int>() == 2);
        if (found is not null)
        {
            return StripMeshId(found["_id"]!.GetValue<string>());
        }
        var created = await SendAsync(new JsonObject { ["action"] = "createmesh", ["meshname"] = name, ["meshtype"] = 2 }, ct);
        if (created["result"]?.GetValue<string>() != "ok")
        {
            throw new MeshException("Falha ao criar o grupo de dispositivos: " + created["result"]);
        }
        return StripMeshId(created["meshid"]!.GetValue<string>());
    }

    private static string StripMeshId(string id) => id.StartsWith("mesh//", StringComparison.Ordinal) ? id[6..] : id;
}
