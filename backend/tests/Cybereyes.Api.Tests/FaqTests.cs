using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private static async Task<JsonElement> WaitFaqFromTicketAsync(HttpClient admin, int ticketId)
    {
        for (var i = 0; i < 100; i++)
        {
            var proposals = await admin.GetFromJsonAsync<List<JsonElement>>("/api/faq?status=proposed");
            var found = proposals!.FirstOrDefault(f => f.GetProperty("sourceTicketId").ValueKind == JsonValueKind.Number &&
                f.GetProperty("sourceTicketId").GetInt32() == ticketId);
            if (found.ValueKind == JsonValueKind.Object)
            {
                return found;
            }
            await Task.Delay(100);
        }
        throw new TimeoutException($"O assistente nao sugeriu entrada do FAQ para o chamado #{ticketId}");
    }

    [Fact]
    public async Task Faq_ViewersSuggest_ManagersPublish_AndTheOverviewCountsCategoriesAndSuggestions()
    {
        using var admin = await fixture.AdminClientAsync();
        var created = await (await admin.PostAsJsonAsync("/api/faq", new
        {
            clientId = (int?)null, question = "Impressora offline (teste da area de FAQ)", answer = "1. Ligue a impressora\n2. Confira o cabo",
            tags = new[] { "orientar" }, category = "  Impressoras   do escritorio ", @public = true,
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("published", created.GetProperty("status").GetString());
        Assert.Equal("Impressoras do escritorio", created.GetProperty("category").GetString());
        Assert.True(created.GetProperty("public").GetBoolean());
        Assert.Equal("team", created.GetProperty("source").GetString());

        // Mesmo nome em outra grafia reaproveita a categoria existente.
        var second = await (await admin.PostAsJsonAsync("/api/faq", new
        {
            clientId = (int?)null, question = "Papel atolado (teste da area de FAQ)", answer = "Abra a tampa e puxe o papel", category = "impressoras DO escritorio",
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Impressoras do escritorio", second.GetProperty("category").GetString());
        Assert.False(second.GetProperty("public").GetBoolean());

        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Leitor do FAQ", isSuperuser = false, permissions = new[] { "docs.view" } });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        await fixture.CreateUserAsync(admin, "leitor.faq", "senha-leitor-faq-1", roleId);
        using var viewer = await fixture.SignedInClientAsync("leitor.faq", "senha-leitor-faq-1");

        // Quem so le o FAQ sugere: a entrada fica aguardando revisao, mesmo pedindo para publicar, e pode vir sem resposta.
        var suggestion = await viewer.PostAsJsonAsync("/api/faq", new
        {
            clientId = (int?)null, question = "Como mapear a pasta da rede? (teste da area de FAQ)", answer = (string?)null, status = "published",
        });
        Assert.Equal(HttpStatusCode.Created, suggestion.StatusCode);
        var proposed = await suggestion.Content.ReadFromJsonAsync<JsonElement>();
        var proposedId = proposed.GetProperty("id").GetInt32();
        Assert.Equal("proposed", proposed.GetProperty("status").GetString());
        Assert.Equal("Usuario leitor.faq", proposed.GetProperty("suggestedBy").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PutAsJsonAsync($"/api/faq/{proposedId}", new { question = "x x x", answer = "y" })).StatusCode);

        var overview = await viewer.GetFromJsonAsync<JsonElement>("/api/faq/overview");
        Assert.True(overview.GetProperty("proposed").GetInt32() >= 1);
        Assert.Contains(overview.GetProperty("categories").EnumerateArray(),
            c => c.GetProperty("name").GetString() == "Impressoras do escritorio" && c.GetProperty("count").GetInt32() >= 2);
        Assert.Contains("Impressoras do escritorio", overview.GetProperty("allCategories").EnumerateArray().Select(c => c.GetString()));

        var published = await viewer.GetFromJsonAsync<List<JsonElement>>("/api/faq?status=published&search=teste%20da%20area%20de%20FAQ");
        Assert.DoesNotContain(published!, f => f.GetProperty("id").GetInt32() == proposedId);
        var onlyPublic = await viewer.GetFromJsonAsync<List<JsonElement>>("/api/faq?public=true&search=teste%20da%20area%20de%20FAQ");
        Assert.Equal(new[] { created.GetProperty("id").GetInt32() }, onlyPublic!.Select(f => f.GetProperty("id").GetInt32()));
        var byCategory = await viewer.GetFromJsonAsync<List<JsonElement>>("/api/faq?category=Impressoras%20do%20escritorio");
        Assert.Equal(2, byCategory!.Count(f => f.GetProperty("question").GetString()!.Contains("teste da area de FAQ", StringComparison.Ordinal)));

        // Publicar exige resposta; depois a publicacao fica na auditoria.
        using var noAnswer = await admin.PutAsJsonAsync($"/api/faq/{proposedId}", new
        {
            clientId = (int?)null, question = "Como mapear a pasta da rede? (teste da area de FAQ)", answer = "", status = "published",
        });
        Assert.Equal(HttpStatusCode.BadRequest, noAnswer.StatusCode);
        var approved = await (await admin.PutAsJsonAsync($"/api/faq/{proposedId}", new
        {
            clientId = (int?)null, question = "Como mapear a pasta da rede? (teste da area de FAQ)", answer = "1. Abra o Explorador\n2. Clique em Mapear unidade",
            status = "published", category = "Rede",
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("published", approved.GetProperty("status").GetString());
        var audit = await admin.GetFromJsonAsync<JsonElement>("/api/audit?action=faq.publish&pageSize=5");
        Assert.Contains(audit.GetProperty("items").EnumerateArray(), a => a.GetProperty("message").GetString()!.Contains("mapear a pasta", StringComparison.Ordinal));

        // Um tecnico inseriu a resposta numa conversa.
        Assert.Equal(HttpStatusCode.NoContent, (await viewer.PostAsync($"/api/faq/{proposedId}/used", null)).StatusCode);
        Assert.Equal(1, (await viewer.GetFromJsonAsync<JsonElement>($"/api/faq/{proposedId}")).GetProperty("usedCount").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.GetAsync("/api/faq/999999")).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsJsonAsync("/api/faq/draft", new { question = "Teste" })).StatusCode);
        // Sem a chave da Anthropic o assistente nao escreve rascunhos.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/faq/draft", new { question = "Outlook nao abre" })).StatusCode);
    }

    [Fact]
    public async Task TrayFaq_ShowsPublicEntries_CountsViewsAndFeedback_AndTakesQuestionsFromUsers()
    {
        using var admin = await fixture.AdminClientAsync();
        var (_, _, _, agent, clientId, _) = await RegisteredAgentAsync("Cliente ajuda do app", monitoringType: "workstation");
        var (_, otherClient, _) = await NewSiteAsync("Cliente ajuda de outro");
        using var tray = await TrayClientAsync(agent, "rita.ajuda");

        async Task<int> EntryAsync(string question, bool isPublic, int? client = null, string status = "published")
        {
            var response = await admin.PostAsJsonAsync("/api/faq", new
            {
                clientId = client, question, answer = $"Passo a passo de {question}", category = "Ajuda do app", @public = isPublic, status,
            });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        }

        var general = await EntryAsync("Wi-Fi caindo (ajuda do app)", true);
        var mine = await EntryAsync("Sistema do cliente travou (ajuda do app)", true, clientId);
        var internalOnly = await EntryAsync("Reiniciar o servidor (ajuda do app)", false);
        var otherClients = await EntryAsync("VPN do outro cliente (ajuda do app)", true, otherClient);
        var draft = await EntryAsync("Ainda em revisao (ajuda do app)", true, status: "proposed");

        Assert.True((await tray.GetFromJsonAsync<JsonElement>("/api/tray/me")).GetProperty("faqEnabled").GetBoolean());
        var list = await tray.GetFromJsonAsync<JsonElement>("/api/tray/faq?search=ajuda%20do%20app");
        var ids = list.GetProperty("entries").EnumerateArray().Select(e => e.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(general, ids);
        Assert.Contains(mine, ids);
        Assert.DoesNotContain(internalOnly, ids);
        Assert.DoesNotContain(otherClients, ids);
        Assert.DoesNotContain(draft, ids);
        Assert.Contains("Ajuda do app", list.GetProperty("categories").EnumerateArray().Select(c => c.GetString()));
        Assert.Equal(HttpStatusCode.NotFound, (await tray.GetAsync($"/api/tray/faq/{internalOnly}")).StatusCode);

        var entry = await tray.GetFromJsonAsync<JsonElement>($"/api/tray/faq/{general}");
        Assert.Equal("Passo a passo de Wi-Fi caindo (ajuda do app)", entry.GetProperty("answer").GetString());
        await tray.GetAsync($"/api/tray/faq/{general}");
        Assert.Equal(HttpStatusCode.NoContent, (await tray.PostAsJsonAsync($"/api/tray/faq/{general}/feedback", new { helpful = true })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await tray.PostAsJsonAsync($"/api/tray/faq/{general}/feedback", new { helpful = false })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tray.PostAsJsonAsync($"/api/tray/faq/{otherClients}/feedback", new { helpful = true })).StatusCode);
        var counted = await admin.GetFromJsonAsync<JsonElement>($"/api/faq/{general}");
        Assert.Equal(2, counted.GetProperty("views").GetInt32());
        Assert.Equal(1, counted.GetProperty("helpfulCount").GetInt32());
        Assert.Equal(1, counted.GetProperty("notHelpfulCount").GetInt32());

        // A pergunta do usuario vira uma sugestao do cliente da maquina, sem resposta.
        var asked = await tray.PostAsJsonAsync("/api/tray/faq/suggestions", new { question = "  Como  trocar o papel de parede? " });
        Assert.Equal(HttpStatusCode.Created, asked.StatusCode);
        var askedId = (await asked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var suggestion = await admin.GetFromJsonAsync<JsonElement>($"/api/faq/{askedId}");
        Assert.Equal("Como trocar o papel de parede?", suggestion.GetProperty("question").GetString());
        Assert.Equal("proposed", suggestion.GetProperty("status").GetString());
        Assert.Equal("requester", suggestion.GetProperty("source").GetString());
        Assert.Equal("rita.ajuda em mon-linux", suggestion.GetProperty("suggestedBy").GetString());
        Assert.Equal(clientId, suggestion.GetProperty("clientId").GetInt32());
        Assert.Equal("", suggestion.GetProperty("answer").GetString());

        for (var i = 1; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync("/api/tray/faq/suggestions", new { question = $"Pergunta {i} do limite" })).StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await tray.PostAsJsonAsync("/api/tray/faq/suggestions", new { question = "Mais uma" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await tray.PostAsJsonAsync("/api/tray/faq/suggestions", new { question = "" })).StatusCode);
    }

    [Fact]
    public async Task FaqLearn_TheAssistantSuggestsAnEntryFromAResolvedTicket_AndWritesDraftsOnRequest()
    {
        using var admin = await fixture.AdminClientAsync();
        var existing = await CreateFaqAsync(admin, "Outlook pede senha toda hora (teste do aprendizado)", "1. Feche o Outlook\n2. Remova a senha salva", "email");
        await WithAssistantAsync(admin, chat: false, insights: false, async () =>
        {
            var calls = fixture.Assistant.Calls.Count;
            fixture.Assistant.Enqueue(new
            {
                action = "create", reason = "Problema comum de impressao.", duplicateOf = (int?)null,
                question = "A impressora mostra a mensagem Offline", answer = "1. Desligue a impressora\n2. Ligue de novo\n3. Abra um chamado se continuar",
                category = "Impressoras", tags = new[] { "impressora", "orientar" }, guides = true, @public = true, clientSpecific = false,
            });
            var ticket = await (await admin.PostAsJsonAsync("/api/tickets", new
            {
                title = "Impressora do RH offline", description = "A impressora aparece offline para a Joana", requesterName = "Joana",
            })).Content.ReadFromJsonAsync<JsonElement>();
            var ticketId = ticket.GetProperty("id").GetInt32();
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/resolve", new
            {
                kind = "solution", resolution = "Reiniciei a impressora e voltou", @internal = false,
            })).StatusCode);

            var learned = await WaitFaqFromTicketAsync(admin, ticketId);
            Assert.Equal("assistant", learned.GetProperty("source").GetString());
            Assert.Equal("Assistente Teste", learned.GetProperty("suggestedBy").GetString());
            Assert.Equal("A impressora mostra a mensagem Offline", learned.GetProperty("question").GetString());
            Assert.Equal(new[] { "orientar", "impressora" }, learned.GetProperty("tags").EnumerateArray().Select(t => t.GetString()));
            Assert.True(learned.GetProperty("public").GetBoolean());
            Assert.Equal(JsonValueKind.Null, learned.GetProperty("clientId").ValueKind);

            var call = fixture.Assistant.Calls[calls];
            Assert.Contains("Reiniciei a impressora e voltou", call.Prompt, StringComparison.Ordinal);
            Assert.Contains($"<entrada id=\"{existing}\" situacao=\"publicada\"", call.Prompt, StringComparison.Ordinal);
            Assert.Contains("vira uma entrada nova do FAQ", call.System, StringComparison.Ordinal);

            // Corrigir a solucao do mesmo chamado nao gera outra sugestao nem outra chamada ao modelo.
            await admin.PostAsJsonAsync($"/api/tickets/{ticketId}/resolve", new { kind = "solution", resolution = "Reiniciei a impressora", @internal = true });
            await Task.Delay(300);
            Assert.Equal(calls + 1, fixture.Assistant.Calls.Count);

            // O sugerido nao vai para o atendimento do chat enquanto nao for publicado.
            var proposals = await admin.GetFromJsonAsync<List<JsonElement>>("/api/faq?status=proposed&search=mensagem%20Offline");
            Assert.Single(proposals!);

            fixture.Assistant.Enqueue(new
            {
                action = "skip", reason = "Ja existe uma entrada.", duplicateOf = existing, question = "Outlook pede a senha", answer = "1. Abra o Outlook",
                category = (string?)null, tags = Array.Empty<string>(), guides = false, @public = true, clientSpecific = false,
            });
            var draft = await (await admin.PostAsJsonAsync("/api/faq/draft", new { question = "Outlook pede a senha", context = "Depois da troca de senha" }))
                .Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("create", draft.GetProperty("action").GetString());
            Assert.Equal(existing, draft.GetProperty("duplicateOf").GetInt32());
            Assert.Equal("Outlook pede senha toda hora (teste do aprendizado)", draft.GetProperty("duplicateQuestion").GetString());
            // Sem orientar, a entrada nao aparece para os usuarios.
            Assert.False(draft.GetProperty("public").GetBoolean());
            Assert.Contains("Depois da troca de senha", fixture.Assistant.Calls[^1].Prompt, StringComparison.Ordinal);
            Assert.Contains("pediu um rascunho", fixture.Assistant.Calls[^1].System, StringComparison.Ordinal);

            fixture.Assistant.Enqueue(new Cybereyes.Api.Assistant.AssistantException("A Anthropic esta sobrecarregada"));
            Assert.Equal(HttpStatusCode.BadGateway, (await admin.PostAsJsonAsync("/api/faq/draft", new { ticketId })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/faq/draft", new { ticketId = 999999 })).StatusCode);
        });
    }

    [Fact]
    public async Task Mcp_FaqTools_SearchSuggestPublishAndCountUses()
    {
        using var admin = await fixture.AdminClientAsync();
        using var mcp = await McpClientAsync(admin, "agente.ia.faq", "docs.view", "docs.manage");

        var created = JsonDocument.Parse(await McpToolAsync(mcp, "create_faq", new
        {
            question = "Teams sem som na chamada (teste do MCP)", answer = "1. Confira o dispositivo de audio\n2. Reinicie o Teams",
            category = "Programas", tags = new[] { "teams" }, guides = true, @public = true,
        })).RootElement;
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal("proposed", created.GetProperty("status").GetString());
        Assert.Equal(new[] { "orientar", "teams" }, created.GetProperty("tags").EnumerateArray().Select(t => t.GetString()));

        Assert.DoesNotContain($"\"id\":{id},", await McpToolAsync(mcp, "search_faq", new { search = "teste do MCP" }), StringComparison.Ordinal);
        Assert.Contains($"\"id\":{id},", await McpToolAsync(mcp, "search_faq", new { search = "teste do MCP", status = "proposed" }), StringComparison.Ordinal);

        var updated = JsonDocument.Parse(await McpToolAsync(mcp, "update_faq", new { faqId = id, status = "published" })).RootElement;
        Assert.Equal("published", updated.GetProperty("status").GetString());
        Assert.Equal("Programas", updated.GetProperty("category").GetString());
        Assert.True(updated.GetProperty("guides").GetBoolean());
        Assert.True(updated.GetProperty("public").GetBoolean());
        Assert.Contains($"\"id\":{id},", await McpToolAsync(mcp, "search_faq", new { search = "teste do MCP" }), StringComparison.Ordinal);

        await McpToolAsync(mcp, "faq_used", new { faqId = id });
        Assert.Equal(1, JsonDocument.Parse(await McpToolAsync(mcp, "get_faq", new { faqId = id })).RootElement.GetProperty("usedCount").GetInt32());
    }
}
