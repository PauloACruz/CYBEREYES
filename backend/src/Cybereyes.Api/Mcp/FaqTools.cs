using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace Cybereyes.Api.Mcp;

/// <summary>FAQ: consultar as solucoes conhecidas antes de atender e registrar as novas depois de resolver.</summary>
[McpServerToolType]
public sealed class FaqTools(PlatformApi api)
{
    [McpServerTool(Name = "search_faq", Title = "Pesquisar FAQ", ReadOnly = true, OpenWorld = false)]
    [Description("Perguntas frequentes com a solucao passo a passo. Pesquise antes de investigar um problema: a resposta pode ja estar aqui. guides=true quer dizer que o passo a passo pode ir ao usuario como esta.")]
    public Task<string> SearchFaq(
        [Description("Texto na pergunta, na resposta ou na categoria")] string? search = null,
        [Description("Nome exato da categoria")] string? category = null,
        [Description("Inclui as entradas so deste cliente, alem das gerais")] int? clientId = null,
        [Description("published (padrao), proposed (sugestoes aguardando revisao) ou all")] string? status = null,
        CancellationToken ct = default) =>
        api.GetAsync("/api/faq", ct, ("search", search), ("category", category), ("clientId", clientId),
            ("status", status is null ? "published" : status == "all" ? null : status));

    [McpServerTool(Name = "get_faq", Title = "Ler entrada do FAQ", ReadOnly = true, OpenWorld = false)]
    [Description("Entrada do FAQ com a resposta completa e as metricas (aberturas no app, avaliacoes e usos).")]
    public Task<string> GetFaq(int faqId, CancellationToken ct = default) => api.GetAsync($"/api/faq/{faqId}", ct);

    [McpServerTool(Name = "create_faq", Title = "Registrar entrada no FAQ", OpenWorld = false)]
    [Description("Registra um problema e a solucao no FAQ. Depois de resolver algo que pode se repetir, registre como sugestao (status proposed, o padrao) para a equipe revisar; use published so quando o usuario pedir. Generalize o texto: sem nomes de pessoas, maquinas, IPs ou senhas.")]
    public Task<string> CreateFaq(
        [Description("O problema como o usuario descreve, 3 a 300 caracteres")] string question,
        [Description("Passos numerados, um por linha")] string answer,
        [Description("Assunto curto, por exemplo Impressoras ou E-mail")] string? category = null,
        [Description("Palavras-chave em minusculas")] string[]? tags = null,
        [Description("true: um usuario comum consegue seguir os passos sozinho; o assistente do chat pode envia-los (tag orientar)")] bool guides = false,
        [Description("true: aparece na ajuda do app EYES para os usuarios")] bool @public = false,
        [Description("So para este cliente; sem ele vale para todos")] int? clientId = null,
        [Description("Chamado de onde veio a solucao")] int? ticketId = null,
        [Description("proposed (padrao) ou published")] string? status = null,
        CancellationToken ct = default) =>
        api.PostAsync("/api/faq", new
        {
            clientId, question, answer, category, tags = Tags(tags, guides), enabled = true, status = status ?? "proposed", @public,
            sourceTicketId = ticketId,
        }, ct);

    [McpServerTool(Name = "update_faq", Title = "Editar entrada do FAQ", Idempotent = true, OpenWorld = false)]
    [Description("Corrige uma entrada do FAQ ou publica uma sugestao (status published). Campos omitidos ficam como estao. Exige permissao de editar a documentacao.")]
    public async Task<string> UpdateFaq(int faqId, string? question = null, string? answer = null, string? category = null, string[]? tags = null,
        bool? guides = null, bool? @public = null, bool? enabled = null,
        [Description("published ou proposed")] string? status = null,
        CancellationToken ct = default)
    {
        using var current = JsonDocument.Parse(await api.GetAsync($"/api/faq/{faqId}", ct));
        var c = current.RootElement;
        var currentTags = c.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!).Where(t => t != Core.Assistant.FaqTags.Guide).ToArray();
        return await api.PutAsync($"/api/faq/{faqId}", new
        {
            clientId = c.GetProperty("clientId").ValueKind == JsonValueKind.Number ? c.GetProperty("clientId").GetInt32() : (int?)null,
            question = question ?? c.GetProperty("question").GetString(),
            answer = answer ?? c.GetProperty("answer").GetString(),
            category = category ?? (c.GetProperty("category").ValueKind == JsonValueKind.String ? c.GetProperty("category").GetString() : null),
            tags = Tags(tags ?? currentTags, guides ?? c.GetProperty("guides").GetBoolean()),
            enabled = enabled ?? c.GetProperty("enabled").GetBoolean(),
            status,
            @public,
        }, ct);
    }

    [McpServerTool(Name = "faq_used", Title = "Contar uso do FAQ", OpenWorld = false)]
    [Description("Registra que a resposta de uma entrada foi usada no atendimento (por exemplo, enviada ao usuario com reply_ticket). Alimenta as metricas do FAQ.")]
    public Task<string> FaqUsed(int faqId, CancellationToken ct = default) => api.PostAsync($"/api/faq/{faqId}/used", null, ct);

    private static string[] Tags(IEnumerable<string>? tags, bool guides)
    {
        var list = (tags ?? []).Where(t => !string.Equals(t, Core.Assistant.FaqTags.Guide, StringComparison.OrdinalIgnoreCase)).ToList();
        return guides ? [Core.Assistant.FaqTags.Guide, .. list] : [.. list];
    }
}
