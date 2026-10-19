using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Cybereyes.Api.Assistant;
using Cybereyes.Core.Notifications;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;

namespace Cybereyes.Api.Tests;

public sealed partial class AgentTests
{
    private const string AnthropicKey = "sk-ant-api03-chave-de-teste-1234";

    private static object AssistantSettings(string? apiKey = null, bool chat = false, bool insights = false, string model = "claude-opus-5-5",
        string? agentId = null, string chatEffort = "low", string logEffort = "medium") => new
    {
        apiKey,
        model,
        agentId,
        chatEffort,
        logEffort,
        name = "Assistente Teste",
        chatEnabled = chat,
        logInsightsEnabled = insights,
        logInsightsIntervalHours = 24,
        logInsightsMinLevel = "error",
        logInsightsPush = true,
        logInsightsEmail = false,
    };

    /// <summary>Liga o assistente para o teste e desliga no fim: as configuracoes sao globais e valem para os outros testes da colecao.</summary>
    private async Task WithAssistantAsync(HttpClient admin, bool chat, bool insights, Func<Task> test, object? settings = null)
    {
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/assistant/settings", settings ?? AssistantSettings(AnthropicKey, chat, insights))).StatusCode);
        try
        {
            await test();
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(string.Empty));
            fixture.Assistant.ClearReplies();
        }
    }

    private static async Task<JsonElement> WaitTrayAsync(HttpClient tray, int ticketId, Func<JsonElement, bool> done)
    {
        JsonElement last = default;
        for (var i = 0; i < 100; i++)
        {
            last = await tray.GetFromJsonAsync<JsonElement>($"/api/tray/tickets/{ticketId}");
            if (done(last))
            {
                return last;
            }
            await Task.Delay(100);
        }
        throw new TimeoutException($"O chamado #{ticketId} nao chegou ao estado esperado: {last}");
    }

    private static List<JsonElement> Messages(JsonElement ticket) => ticket.GetProperty("messages").EnumerateArray().ToList();

    private static MultipartFormDataContent TrayTicket(string title, string description) =>
        new() { { new StringContent(title), "title" }, { new StringContent(description), "description" } };

    private static async Task<int> CreateFaqAsync(HttpClient admin, string question, string answer, params string[] tags)
    {
        var created = await admin.PostAsJsonAsync("/api/faq", new { clientId = (int?)null, question, answer, tags, enabled = true });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task AssistantSettings_KeepTheKeySecret_AndRequireItToTurnOn()
    {
        using var admin = await fixture.AdminClientAsync();
        var initial = await admin.GetFromJsonAsync<JsonElement>("/api/assistant/settings");
        Assert.False(initial.GetProperty("keySet").GetBoolean());
        Assert.Equal("claude-opus-5-5", initial.GetProperty("model").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(chat: true))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings("chave-qualquer"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync("/api/assistant/settings", new { apiKey = (string?)null, model = "gpt-5", name = "X Y", chatEnabled = false,
                logInsightsEnabled = false, logInsightsIntervalHours = 24, logInsightsMinLevel = "error", logInsightsPush = true, logInsightsEmail = false }))
            .StatusCode);

        await WithAssistantAsync(admin, chat: true, insights: false, async () =>
        {
            var saved = await admin.GetStringAsync("/api/assistant/settings");
            Assert.DoesNotContain(AnthropicKey, saved, StringComparison.Ordinal);
            var dto = JsonDocument.Parse(saved).RootElement;
            Assert.True(dto.GetProperty("keySet").GetBoolean());
            Assert.Equal("1234", dto.GetProperty("keyHint").GetString());
            Assert.True(dto.GetProperty("chatEnabled").GetBoolean());

            // Sem apiKey a chave gravada fica.
            var kept = await (await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(chat: true))).Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(kept.GetProperty("keySet").GetBoolean());

            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/assistant/test", new { apiKey = (string?)null })).StatusCode);
            var rejected = await admin.PostAsJsonAsync("/api/assistant/test", new { apiKey = FakeAssistant.RejectedKey });
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.Contains("recusou", (await rejected.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString(), StringComparison.Ordinal);

            using var tray = await TrayClientAsync((await RegisteredAgentAsync("Cliente assistente me")).Agent, "ana");
            var me = await tray.GetFromJsonAsync<JsonElement>("/api/tray/me");
            Assert.True(me.GetProperty("assistantEnabled").GetBoolean());
            Assert.Equal("Assistente Teste", me.GetProperty("assistantName").GetString());
        });

        var removed = await admin.GetFromJsonAsync<JsonElement>("/api/assistant/settings");
        Assert.False(removed.GetProperty("keySet").GetBoolean());
        Assert.False(removed.GetProperty("chatEnabled").GetBoolean());
    }

    [Fact]
    public async Task LinkedAgent_LendsItsInstructionsAndModel_AndEachFunctionUsesItsEffort()
    {
        using var admin = await fixture.AdminClientAsync();
        // Sem chave nao da para listar nem criar agentes.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/assistant/agents")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(AnthropicKey, model: "agent"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(AnthropicKey, chatEffort: "turbo"))).StatusCode);

        var (_, pk, _, agent, clientId, _) = await RegisteredAgentAsync("Cliente assistente agente", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, "lucia");
        using (var seed = fixture.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            db.SystemLogs.Add(new SystemLog { Time = DateTimeOffset.UtcNow.AddHours(-1), AgentId = pk, ClientId = clientId, Level = LogLevels.Error,
                Source = "Teste do agente vinculado", Message = "Falha de teste" });
            await db.SaveChangesAsync();
        }
        await WithAssistantAsync(admin, chat: true, insights: false, async () =>
        {
            var created = await admin.PostAsJsonAsync("/api/assistant/agents", new { name = "Suporte N1 (teste)", model = "claude-sonnet-5-5" });
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var linked = await created.Content.ReadFromJsonAsync<JsonElement>();
            var agentId = linked.GetProperty("id").GetString()!;
            Assert.Equal("claude-sonnet-5-5", linked.GetProperty("model").GetString());
            Assert.Contains(fixture.Assistant.Agents, a => a.Id == agentId && a.System!.Contains("Nunca peca senhas", StringComparison.Ordinal));
            var listed = await admin.GetFromJsonAsync<List<JsonElement>>("/api/assistant/agents");
            Assert.Contains(listed!, a => a.GetProperty("id").GetString() == agentId);

            // Instrucoes proprias da "empresa", editadas no Console da Anthropic.
            lock (fixture.Assistant.Agents)
            {
                var i = fixture.Assistant.Agents.FindIndex(a => a.Id == agentId);
                fixture.Assistant.Agents[i] = fixture.Assistant.Agents[i] with { System = "Atendimento das 8h as 18h; chame o usuario de voce." };
            }
            var saved = await (await admin.PutAsJsonAsync("/api/assistant/settings",
                AssistantSettings(chat: true, model: "agent", agentId: agentId, chatEffort: "high", logEffort: "max"))).Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(agentId, saved.GetProperty("agentId").GetString());
            Assert.Equal("agent", saved.GetProperty("model").GetString());
            Assert.Equal("high", saved.GetProperty("chatEffort").GetString());

            var test = await (await admin.PostAsJsonAsync("/api/assistant/test", new { apiKey = (string?)null, model = "agent", agentId })).Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("usa o modelo claude-sonnet-5-5", test.GetProperty("message").GetString(), StringComparison.Ordinal);

            var calls = fixture.Assistant.Calls.Count;
            fixture.Assistant.Enqueue(new { action = "ask_details", reply = "Pode contar quando começou?", faqId = (int?)null, title = (string?)null, priority = "medium", summary = "-" });
            var ticket = await tray.PostAsync("/api/tray/tickets", TrayTicket("Computador lento", "Computador lento desde ontem"));
            var ticketId = (await ticket.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
            await WaitTrayAsync(tray, ticketId, t => Messages(t).Any(m => m.GetProperty("authorType").GetString() == "assistant"));

            var call = fixture.Assistant.Calls[calls];
            Assert.Equal("claude-sonnet-5-5", call.Model);
            Assert.Equal("high", call.Effort);
            Assert.Contains("<instrucoes_do_agente nome=\"Suporte N1 (teste)\">", call.System, StringComparison.Ordinal);
            Assert.Contains("Atendimento das 8h as 18h", call.System, StringComparison.Ordinal);
            Assert.Contains("Seu trabalho a cada mensagem", call.System, StringComparison.Ordinal);

            // Modelo escolhido sobrescreve o do agente; a analise de logs usa o proprio esforco.
            await admin.PutAsJsonAsync("/api/assistant/settings",
                AssistantSettings(chat: true, insights: true, model: "claude-haiku-5-5", agentId: agentId, chatEffort: "high", logEffort: "max"));
            using var scope = fixture.Services.CreateScope();
            fixture.Assistant.Enqueue(new { summary = "ok", items = Array.Empty<object>(), suggestions = Array.Empty<object>() });
            var report = await scope.ServiceProvider.GetRequiredService<LogInsightRunner>().RunAsync(manual: true, CancellationToken.None);
            Assert.NotNull(report);
            var analysis = fixture.Assistant.Calls[^1];
            Assert.Equal("claude-haiku-5-5", analysis.Model);
            Assert.Equal("max", analysis.Effort);
            Assert.Contains("Atendimento das 8h as 18h", analysis.System, StringComparison.Ordinal);
            Assert.Equal("claude-haiku-5-5", report.Model);

            // Agente sumido na Anthropic: o assistente segue com as instrucoes e o modelo padrao.
            lock (fixture.Assistant.Agents)
            {
                fixture.Assistant.Agents.RemoveAll(a => a.Id == agentId);
            }
            await admin.PutAsJsonAsync("/api/assistant/settings", AssistantSettings(chat: true, model: "agent", agentId: agentId));
            var before = fixture.Assistant.Calls.Count;
            fixture.Assistant.Enqueue(new { action = "ask_details", reply = "Mais detalhes?", faqId = (int?)null, title = (string?)null, priority = "medium", summary = "-" });
            var other = await tray.PostAsync("/api/tray/tickets", TrayTicket("Sem som", "Sem som no fone"));
            var otherId = (await other.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
            await WaitTrayAsync(tray, otherId, t => Messages(t).Any(m => m.GetProperty("authorType").GetString() == "assistant"));
            var fallback = fixture.Assistant.Calls[before];
            Assert.Equal("claude-opus-5-5", fallback.Model);
            Assert.DoesNotContain("instrucoes_do_agente", fallback.System, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task Faq_NormalizesTags_AndFiltersByTagAndSearch()
    {
        using var admin = await fixture.AdminClientAsync();
        var created = await admin.PostAsJsonAsync("/api/faq", new
        {
            clientId = (int?)null, question = "Como limpar a fila da impressora do teste de FAQ?", answer = "1. Abra Impressoras\n2. Cancele tudo",
            tags = new[] { " Orientar ", "Impressora", "orientar" }, enabled = true,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var entry = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = entry.GetProperty("id").GetInt32();
        Assert.Equal(new[] { "orientar", "impressora" }, entry.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!).ToArray());
        Assert.True(entry.GetProperty("guides").GetBoolean());

        var byTag = await admin.GetFromJsonAsync<List<JsonElement>>("/api/faq?tag=impressora&search=teste%20de%20FAQ");
        Assert.Contains(byTag!, f => f.GetProperty("id").GetInt32() == id);
        Assert.DoesNotContain(await admin.GetFromJsonAsync<List<JsonElement>>("/api/faq?tag=rede") ?? [], f => f.GetProperty("id").GetInt32() == id);

        var updated = await (await admin.PutAsJsonAsync($"/api/faq/{id}", new
        {
            clientId = (int?)null, question = "Como limpar a fila da impressora do teste de FAQ?", answer = "Passos novos", tags = new[] { "impressora" }, enabled = true,
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(updated.GetProperty("guides").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/faq/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/faq/{id}")).StatusCode);
    }

    [Fact]
    public async Task TrayAssistant_SendsTheGuideStepsFromTheFaq_AndResolvesWhenTheUserConfirms()
    {
        using var admin = await fixture.AdminClientAsync();
        var guide = await CreateFaqAsync(admin, "Impressora nao imprime (teste do assistente)", "1. Desligue a impressora\n2. Ligue de novo\n3. Imprima uma pagina de teste",
            "orientar", "impressora");
        var reference = await CreateFaqAsync(admin, "Trocar o toner (teste do assistente)", "Somente a equipe troca o toner", "impressora");
        var (_, _, _, agent, _, _) = await RegisteredAgentAsync("Cliente assistente faq", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, "maria");

        await WithAssistantAsync(admin, chat: true, insights: false, async () =>
        {
            var calls = fixture.Assistant.Calls.Count;
            fixture.Assistant.Enqueue(new
            {
                action = "guide", reply = "Olá, maria! Esse problema costuma ter solução rápida.", faqId = guide, title = "Impressora parou de imprimir",
                priority = "medium", summary = "Impressora nao imprime desde ontem.",
            });
            fixture.Assistant.Enqueue(new { action = "resolved", reply = "Que bom que deu certo!", faqId = (int?)guide, title = (string?)null, priority = "low", summary = "Resolvido com o FAQ." });

            var created = await tray.PostAsync("/api/tray/tickets", TrayTicket("Nao imprime desde ontem", "Nao imprime desde ontem, aparece erro na fila"));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var summary = await created.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(summary.GetProperty("chatEnabled").GetBoolean());
            var ticketId = summary.GetProperty("id").GetInt32();

            var guided = await WaitTrayAsync(tray, ticketId, t => Messages(t).Any(m => m.GetProperty("authorType").GetString() == "assistant"));
            var reply = Messages(guided).Single(m => m.GetProperty("authorType").GetString() == "assistant");
            Assert.Equal("Assistente Teste", reply.GetProperty("authorName").GetString());
            Assert.Contains("1. Desligue a impressora\n2. Ligue de novo", reply.GetProperty("body").GetString(), StringComparison.Ordinal);
            Assert.StartsWith("Olá, maria!", reply.GetProperty("body").GetString(), StringComparison.Ordinal);
            Assert.Equal("waiting_user", guided.GetProperty("status").GetString());
            Assert.Equal("Impressora parou de imprimir", guided.GetProperty("title").GetString());
            Assert.True(guided.GetProperty("chatEnabled").GetBoolean());

            var call = fixture.Assistant.Calls[calls];
            Assert.Contains($"<entrada id=\"{guide}\" orientar=\"sim\"", call.System, StringComparison.Ordinal);
            Assert.Contains($"<entrada id=\"{reference}\" orientar=\"nao\"", call.System, StringComparison.Ordinal);
            Assert.Contains("aparece erro na fila", call.Prompt, StringComparison.Ordinal);
            Assert.Equal(AnthropicKey, call.ApiKey);

            var notes = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/tickets/{ticketId}/messages");
            Assert.Contains(notes!, m => m.GetProperty("internal").GetBoolean() && m.GetProperty("body").GetString()!.Contains($"FAQ #{guide}", StringComparison.Ordinal));
            Assert.DoesNotContain(Messages(guided), m => m.GetProperty("body").GetString()!.Contains("Orientei", StringComparison.Ordinal));

            Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync($"/api/tray/tickets/{ticketId}/messages", new { body = "Funcionou, obrigada" })).StatusCode);
            var resolved = await WaitTrayAsync(tray, ticketId, t => t.GetProperty("status").GetString() == "resolved");
            Assert.Contains(Messages(resolved), m => m.GetProperty("body").GetString() == "Que bom que deu certo!");
            Assert.Contains("Funcionou, obrigada", fixture.Assistant.Calls[calls + 1].Prompt, StringComparison.Ordinal);

            // A solucao fica registrada como a do botao Resolver, sem tecnico.
            var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/tickets/{ticketId}");
            Assert.Equal("solution", detail.GetProperty("resolutionKind").GetString());
            Assert.Contains($"FAQ #{guide}", detail.GetProperty("resolution").GetString(), StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task TrayAssistant_AsksForTheDescription_KeepsUnguidedFaqInternal_AndStopsWhenATechnicianTakesOver()
    {
        using var admin = await fixture.AdminClientAsync();
        var reference = await CreateFaqAsync(admin, "VPN do escritorio (teste do assistente)", "Resposta interna: reiniciar o concentrador", "rede");
        var (_, _, _, agent, _, _) = await RegisteredAgentAsync("Cliente assistente vpn", monitoringType: "workstation");
        using var tray = await TrayClientAsync(agent, "joana");

        await WithAssistantAsync(admin, chat: true, insights: false, async () =>
        {
            var calls = fixture.Assistant.Calls.Count;
            var created = await tray.PostAsync("/api/tray/tickets", TrayTicket("Problema na VPN", ""));
            var ticketId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

            // Sem descricao o assistente pede os detalhes na hora, sem chamar o modelo.
            var greeted = await tray.GetFromJsonAsync<JsonElement>($"/api/tray/tickets/{ticketId}");
            var greeting = Assert.Single(Messages(greeted));
            Assert.Equal("assistant", greeting.GetProperty("authorType").GetString());
            Assert.Contains("descreva o problema", greeting.GetProperty("body").GetString(), StringComparison.Ordinal);
            Assert.Equal(calls, fixture.Assistant.Calls.Count);

            // "guide" com uma entrada sem a tag orientar vira encaminhamento: a resposta interna nao vai ao cliente.
            fixture.Assistant.Enqueue(new
            {
                action = "guide", reply = "Vou encaminhar para a equipe técnica.", faqId = reference, title = (string?)null, priority = "high",
                summary = "VPN nao conecta.",
            });
            Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync($"/api/tray/tickets/{ticketId}/messages", new { body = "A VPN nao conecta" })).StatusCode);
            var handed = await WaitTrayAsync(tray, ticketId, t => Messages(t).Count(m => m.GetProperty("authorType").GetString() == "assistant") == 2);
            Assert.DoesNotContain(Messages(handed), m => m.GetProperty("body").GetString()!.Contains("concentrador", StringComparison.Ordinal));
            Assert.True(handed.GetProperty("chatEnabled").GetBoolean());
            var notes = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/tickets/{ticketId}/messages");
            Assert.Contains(notes!, m => m.GetProperty("internal").GetBoolean() &&
                m.GetProperty("body").GetString()!.Contains("sem a tag orientar", StringComparison.Ordinal) &&
                m.GetProperty("body").GetString()!.Contains("Alta", StringComparison.Ordinal));

            // Encaminhado, o assistente nao responde mais; um tecnico que assume um chamado em atendimento tambem o tira da conversa.
            var second = await tray.PostAsync("/api/tray/tickets", TrayTicket("Outro problema", ""));
            var secondId = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
            var adminId = (await admin.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetString();
            await admin.PutAsJsonAsync($"/api/tickets/{secondId}/assign", new { userId = adminId });
            var before = fixture.Assistant.Calls.Count;
            Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync($"/api/tray/tickets/{ticketId}/messages", new { body = "Alguma novidade?" })).StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await tray.PostAsJsonAsync($"/api/tray/tickets/{secondId}/messages", new { body = "Detalhes do outro" })).StatusCode);
            await Task.Delay(500);
            Assert.Equal(before, fixture.Assistant.Calls.Count);
        });
    }

    [Fact]
    public async Task LogInsights_GroupRecurringErrors_MergeTheAnalysis_AndNotifyTheTeam()
    {
        using var admin = await fixture.AdminClientAsync();
        var (_, pk, _, _, clientId, _) = await RegisteredAgentAsync("Cliente assistente logs", plat: "windows", monitoringType: "workstation");
        const string Source = "Servico de teste do assistente";
        var adminId = Guid.Parse((await admin.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetString()!);
        var now = DateTimeOffset.UtcNow;
        using (var scope = fixture.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CybereyesDbContext>();
            // Mesmo erro com numeros diferentes: cai num grupo so. Dois no dia anterior contam como janela anterior.
            for (var i = 0; i < 5; i++)
            {
                db.SystemLogs.Add(new SystemLog { Time = now.AddHours(-i - 1), AgentId = pk, ClientId = clientId, Level = LogLevels.Error, Source = Source,
                    EventId = 7031, Message = $"O servico Spooler terminou inesperadamente. Isso ocorreu {i + 1} vez(es)." });
            }
            db.SystemLogs.Add(new SystemLog { Time = now.AddHours(-30), AgentId = pk, ClientId = clientId, Level = LogLevels.Error, Source = Source, EventId = 7031,
                Message = "O servico Spooler terminou inesperadamente. Isso ocorreu 9 vez(es)." });
            db.SystemLogs.Add(new SystemLog { Time = now.AddHours(-31), AgentId = pk, ClientId = clientId, Level = LogLevels.Error, Source = Source, EventId = 7031,
                Message = "O servico Spooler terminou inesperadamente. Isso ocorreu 8 vez(es)." });
            db.SystemLogs.Add(new SystemLog { Time = now.AddHours(-2), AgentId = pk, ClientId = clientId, Level = LogLevels.Warning, Source = Source, EventId = 1,
                Message = "Aviso que fica de fora" });
            db.PushSubscriptions.Add(new PushSubscription { UserId = adminId, Endpoint = "https://fcm.googleapis.com/fcm/send/insights-sim", P256dh = "x", Auth = "y" });
            db.PushSubscriptions.Add(new PushSubscription { UserId = adminId, Endpoint = "https://fcm.googleapis.com/fcm/send/insights-nao", P256dh = "x", Auth = "y",
                Insights = false });
            await db.SaveChangesAsync();
        }

        await WithAssistantAsync(admin, chat: false, insights: true, async () =>
        {
            using var scope = fixture.Services.CreateScope();
            var runner = scope.ServiceProvider.GetRequiredService<LogInsightRunner>();
            var settings = await scope.ServiceProvider.GetRequiredService<CybereyesDbContext>().CoreSettings.AsNoTracking().SingleAsync();
            var groups = await runner.GroupsAsync(settings, now.AddHours(-24), now.AddMinutes(1), TimeSpan.FromHours(24), CancellationToken.None);
            var index = groups.FindIndex(g => g.Source == Source);
            Assert.True(index >= 0, "grupo de teste nao encontrado");
            var group = groups[index];
            Assert.Equal(5, group.Count);
            Assert.Equal(2, group.PreviousCount);
            Assert.Equal(1, group.Agents);
            Assert.DoesNotContain(groups, g => g.Source == Source && g.Level == LogLevels.Warning);

            fixture.Assistant.Enqueue(new
            {
                summary = "O spooler de impressao falha todos os dias.",
                items = groups.Select((g, i) => new
                {
                    group = $"G{i + 1}", title = g.Source == Source ? "Spooler de impressao parando" : "Outro erro", severity = "alta",
                    officialDescription = "Evento 7031 do Service Control Manager: o servico terminou de forma inesperada.",
                    reference = "Microsoft Learn: Event ID 7031", probableCause = "Driver de impressora com defeito.",
                    resolution = new[] { "Atualize o driver", "Limpe a fila" }, platformActions = new[] { "Crie uma regra de alerta de log para o evento 7031" },
                }),
                suggestions = new[] { new { title = "Entrada no FAQ", detail = "Cadastre o passo a passo de limpar a fila com a tag orientar." } },
            });
            var report = await runner.RunAsync(manual: true, CancellationToken.None);
            Assert.NotNull(report);
            Assert.Equal("ok", report.Status);
            Assert.Contains("Mensagem de exemplo: O servico Spooler terminou", fixture.Assistant.Calls[^1].Prompt, StringComparison.Ordinal);
            Assert.Contains("<plataforma>", fixture.Assistant.Calls[^1].Prompt, StringComparison.Ordinal);

            var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/assistant/insights/{report.Id}");
            var item = detail.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("source").GetString() == Source);
            Assert.Equal("Spooler de impressao parando", item.GetProperty("title").GetString());
            Assert.Equal(5, item.GetProperty("count").GetInt32());
            Assert.Equal(2, item.GetProperty("previousCount").GetInt32());
            Assert.Equal(2, item.GetProperty("resolution").GetArrayLength());
            Assert.NotEmpty(item.GetProperty("hosts").EnumerateArray());
            Assert.Equal("Entrada no FAQ", detail.GetProperty("suggestions")[0].GetProperty("title").GetString());

            var list = await admin.GetFromJsonAsync<JsonElement>("/api/assistant/insights");
            Assert.Equal(report.Id, list.GetProperty("reports")[0].GetProperty("id").GetInt64());

            var pushed = await fixture.Pushes.WaitAsync("https://fcm.googleapis.com/fcm/send/insights-sim", m => m.Url.EndsWith($"analise={report.Id}", StringComparison.Ordinal));
            Assert.Contains("severidade alta", pushed.Title, StringComparison.Ordinal);
            Assert.Empty(fixture.Pushes.For("https://fcm.googleapis.com/fcm/send/insights-nao"));

            // A periodica nao roda de novo antes do intervalo; a falha do modelo fica registrada no relatorio.
            Assert.Null(await runner.RunAsync(manual: false, CancellationToken.None));
            fixture.Assistant.Enqueue(new AssistantException("Limite de uso da API da Anthropic atingido; tente mais tarde"));
            var failed = await runner.RunAsync(manual: true, CancellationToken.None);
            Assert.Equal("error", failed!.Status);
            Assert.Contains("Limite de uso", failed.Error, StringComparison.Ordinal);
        });
    }
}
