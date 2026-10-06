using Cybereyes.Api.Infrastructure;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Rmm.Software;

/// <summary>Pesquisa de pacotes do Chocolatey e do winget para instalar pelo console.</summary>
public static class SoftwareCatalogEndpoints
{
    public static void MapSoftwareCatalogEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/software/catalog/{source}", async (string source, string? q, PackageCatalog catalog, CancellationToken ct) =>
        {
            if (source is not ("choco" or "winget"))
            {
                return Problems.NotFound("Catalogo");
            }
            var term = (q ?? string.Empty).Trim();
            if (!PackageCatalog.TermPattern().IsMatch(term))
            {
                return Problems.Validation("q", "Digite de 2 a 60 letras, numeros, espaco ou . _ + -");
            }
            try
            {
                var items = source == "choco" ? await catalog.SearchChocolateyAsync(term, ct) : await catalog.SearchWingetAsync(term, ct);
                return TypedResults.Ok(new { source, items });
            }
            catch (CatalogUnavailableException ex)
            {
                return Problems.Create(StatusCodes.Status502BadGateway, ex.Message, ErrorCodes.CatalogUnavailable);
            }
        }).WithTags("Atualizacoes e software").RequireAuthorization(Policies.Permission(Permissions.SoftwareManage));
    }
}
