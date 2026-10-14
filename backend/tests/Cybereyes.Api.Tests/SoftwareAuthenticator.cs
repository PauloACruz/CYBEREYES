using System.Buffers.Binary;
using System.Buffers.Text;
using System.Formats.Cbor;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cybereyes.Api.Tests;

/// <summary>
/// Autenticador WebAuthn em software para os testes: faz o papel da biometria do celular. Gera uma chave ES256 (P-256), devolve
/// atestado "none" e assina as entradas com contador crescente, no formato JSON que o navegador manda para a API.
/// </summary>
public sealed class SoftwareAuthenticator(string origin) : IDisposable
{
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly byte[] credentialId = RandomNumberGenerator.GetBytes(32);
    private byte[] userHandle = [];
    private uint counter;

    public string CredentialId => Base64Url.EncodeToString(credentialId);

    /// <summary>Resposta a navigator.credentials.create() para as opcoes devolvidas pela API.</summary>
    public JsonObject Create(JsonElement options)
    {
        var rpId = options.GetProperty("rp").GetProperty("id").GetString()!;
        userHandle = Base64Url.DecodeFromChars(options.GetProperty("user").GetProperty("id").GetString());
        var clientData = ClientData("webauthn.create", options.GetProperty("challenge").GetString()!);

        var parameters = key.ExportParameters(includePrivateParameters: false);
        var cose = new CborWriter(CborConformanceMode.Ctap2Canonical);
        cose.WriteStartMap(5);
        cose.WriteInt32(1);
        cose.WriteInt32(2); // kty: EC2
        cose.WriteInt32(3);
        cose.WriteInt32(-7); // alg: ES256
        cose.WriteInt32(-1);
        cose.WriteInt32(1); // crv: P-256
        cose.WriteInt32(-2);
        cose.WriteByteString(parameters.Q.X!);
        cose.WriteInt32(-3);
        cose.WriteByteString(parameters.Q.Y!);
        cose.WriteEndMap();

        var idLength = new byte[2];
        BinaryPrimitives.WriteUInt16BigEndian(idLength, (ushort)credentialId.Length);
        // Flags: usuario presente (0x01), verificado (0x04) e com credencial atestada (0x40).
        byte[] authData = [.. AuthDataHeader(rpId, 0x45, counter), .. new byte[16], .. idLength, .. credentialId, .. cose.Encode()];

        var attestation = new CborWriter(CborConformanceMode.Ctap2Canonical);
        attestation.WriteStartMap(3);
        attestation.WriteTextString("fmt");
        attestation.WriteTextString("none");
        attestation.WriteTextString("attStmt");
        attestation.WriteStartMap(0);
        attestation.WriteEndMap();
        attestation.WriteTextString("authData");
        attestation.WriteByteString(authData);
        attestation.WriteEndMap();

        return Credential(new JsonObject
        {
            ["clientDataJSON"] = Base64Url.EncodeToString(clientData),
            ["attestationObject"] = Base64Url.EncodeToString(attestation.Encode()),
            ["transports"] = new JsonArray("internal"),
        });
    }

    /// <summary>Resposta a navigator.credentials.get(): assina dados do autenticador + hash do clientDataJSON.</summary>
    public JsonObject Get(JsonElement options)
    {
        var rpId = options.GetProperty("rpId").GetString()!;
        var clientData = ClientData("webauthn.get", options.GetProperty("challenge").GetString()!);
        counter++;
        var authData = AuthDataHeader(rpId, 0x05, counter);
        var signature = key.SignData([.. authData, .. SHA256.HashData(clientData)], HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);

        return Credential(new JsonObject
        {
            ["clientDataJSON"] = Base64Url.EncodeToString(clientData),
            ["authenticatorData"] = Base64Url.EncodeToString(authData),
            ["signature"] = Base64Url.EncodeToString(signature),
            ["userHandle"] = Base64Url.EncodeToString(userHandle),
        });
    }

    private JsonObject Credential(JsonObject response) => new()
    {
        ["id"] = CredentialId,
        ["rawId"] = CredentialId,
        ["type"] = "public-key",
        ["authenticatorAttachment"] = "platform",
        ["response"] = response,
        ["clientExtensionResults"] = new JsonObject(),
    };

    private byte[] ClientData(string type, string challenge) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { type, challenge, origin, crossOrigin = false }));

    private static byte[] AuthDataHeader(string rpId, byte flags, uint signCount)
    {
        var count = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(count, signCount);
        return [.. SHA256.HashData(Encoding.UTF8.GetBytes(rpId)), flags, .. count];
    }

    public void Dispose() => key.Dispose();
}
