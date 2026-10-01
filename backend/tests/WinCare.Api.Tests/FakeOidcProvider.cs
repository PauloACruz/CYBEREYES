using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace WinCare.Api.Tests;

/// <summary>Provedor OIDC minimo para os testes: descoberta, JWKS, autorizacao (sem tela) e token com id_token RS256.</summary>
public sealed class FakeOidcProvider : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly RsaSecurityKey key = new(RSA.Create(2048)) { KeyId = "chave-teste" };
    private readonly ConcurrentDictionary<string, (string Nonce, string Challenge, string ClientId)> codes = new(StringComparer.Ordinal);

    public string Authority { get; private set; } = string.Empty;

    /// <summary>Claims do proximo login (sub, email, email_verified, preferred_username, name, amr).</summary>
    public Dictionary<string, object> NextUser { get; set; } = [];

    public string? TamperNonce { get; set; }

    private FakeOidcProvider(WebApplication app) => this.app = app;

    public static async Task<FakeOidcProvider> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        var provider = new FakeOidcProvider(app);
        provider.Map();
        await app.StartAsync();
        provider.Authority = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/');
        return provider;
    }

    private void Map()
    {
        app.MapGet("/.well-known/openid-configuration", () => Results.Json(new Dictionary<string, object>
        {
            ["issuer"] = Authority,
            ["authorization_endpoint"] = $"{Authority}/authorize",
            ["token_endpoint"] = $"{Authority}/token",
            ["jwks_uri"] = $"{Authority}/jwks",
            ["response_types_supported"] = new[] { "code" },
            ["subject_types_supported"] = new[] { "public" },
            ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
        }));
        app.MapGet("/jwks", () =>
        {
            var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(key.Rsa.ExportParameters(false)) { KeyId = key.KeyId });
            return Results.Json(new { keys = new[] { new { kty = jwk.Kty, kid = jwk.Kid, use = "sig", alg = "RS256", n = jwk.N, e = jwk.E } } });
        });
        app.MapGet("/authorize", (HttpRequest req) =>
        {
            var q = req.Query;
            if (q["code_challenge_method"] != "S256" || string.IsNullOrEmpty(q["code_challenge"]))
            {
                return Results.BadRequest("PKCE obrigatorio");
            }
            var code = Guid.NewGuid().ToString("N");
            codes[code] = (q["nonce"]!, q["code_challenge"]!, q["client_id"]!);
            return Results.Redirect(QueryHelpers.AddQueryString(q["redirect_uri"]!, new Dictionary<string, string?> { ["code"] = code, ["state"] = q["state"] }));
        });
        app.MapPost("/token", async (HttpRequest req) =>
        {
            var form = await req.ReadFormAsync();
            if (!codes.TryRemove(form["code"].ToString(), out var issued))
            {
                return Results.BadRequest(new { error = "invalid_grant" });
            }
            var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"].ToString())));
            if (challenge != issued.Challenge || form["client_id"] != issued.ClientId || form["client_secret"] != "segredo-do-cliente")
            {
                return Results.BadRequest(new { error = "invalid_grant" });
            }
            var claims = new Dictionary<string, object>(NextUser) { ["nonce"] = TamperNonce ?? issued.Nonce };
            var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = Authority,
                Audience = issued.ClientId,
                Claims = claims,
                Expires = DateTime.UtcNow.AddMinutes(5),
                SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256),
            });
            return Results.Json(new { access_token = "x", token_type = "Bearer", id_token = token });
        });
    }

    public async ValueTask DisposeAsync() => await app.DisposeAsync();
}
