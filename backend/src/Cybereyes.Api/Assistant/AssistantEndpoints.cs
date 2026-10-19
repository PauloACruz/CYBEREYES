using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Cybereyes.Api.Infrastructure;
using Cybereyes.Api.Rmm.Monitoring;
using Cybereyes.Api.Tickets;
using Cybereyes.Core.Assistant;
using Cybereyes.Core.Audit;
using Cybereyes.Core.Persistence;
using Cybereyes.Core.Rmm;
using Cybereyes.Core.Security;

namespace Cybereyes.Api.Assistant;

/// <summary>Configuracao do assistente. ApiKey nulo mantem a chave gravada; vazio apaga.</summary>
public sealed record AssistantSettingsRequest(
    [property: StringLength(500)] string? ApiKey,
    [property: Required] string Model,
    [property: Required, StringLength(100, MinimumLength = 2)] string Name,
    bool ChatEnabled,
    bool LogInsightsEnabled,
    [property: Range(1, 168)] int LogInsightsIntervalHours,
    [property: Required] string LogInsightsMinLevel,
    bool LogInsightsPush,
    bool LogInsightsEmail,
    [property: StringLength(100)] string? AgentId = null,
    string ChatEffort = "low",
    string LogEffort = "medium",
    bool AgentEnabled = true,
    bool NativeEnabled = true,
    [property: StringLength(20000)] string? Instructions = null,
    bool FaqLearn = true);

/// <summary>Cria na conta da Anthropic um agente com as instrucoes iniciais do Cybereyes, para editar depois no Console.</summary>
public sealed record CreateAgentRequest([property: StringLength(200)] string? Name, string? Model);

public sealed record AssistantAgentDto(string Id, string Name, string? Description, string Model, long Version);

/// <summary>Testa a chave informada ou, sem ela, a gravada; com Model "agent", o modelo do agente informado (ou do gravado).</summary>
public sealed record AssistantTestRequest([property: StringLength(500)] string? ApiKey, string? Model, [property: StringLength(100)] string? AgentId = null);

public sealed record LogInsightSummaryDto(long Id, DateTimeOffset CreatedAt, DateTimeOffset WindowStart, DateTimeOffset WindowEnd, string Status, bool Manual,
    string Model, string Summary, int EventCount, int GroupCount, int AgentCount, string? Error);

public static class AssistantEndpoints
{
    private static readonly string[] InsightLevels = [LogLevels.Warning, LogLevels.Error, LogLevels.Critical];

    public static void MapAssistantEndpoints(this IEndpointRouteBuilder app)
    {
        var settings = Policies.Permission(Permissions.SettingsManage);
        var assistant = app.MapGroup("/api/assistant").WithTags("Assistente de IA");
        assistant.MapGet("/settings", GetSettingsAsync).RequireAuthorization(settings);
        assistant.MapPut("/settings", SaveSettingsAsync).RequireAuthorization(settings);
        assistant.MapPost("/test", TestAsync).RequireAuthorization(settings);
        assistant.MapGet("/agents", ListAgentsAsync).RequireAuthorization(settings);
        assistant.MapPost("/agents", CreateAgentAsync).RequireAuthorization(settings);
        assistant.MapGet("/insights", ListInsightsAsync).RequireAuthorization(Policies.Permission(Permissions.LogsView));
        assistant.MapGet("/insights/{id:long}", InsightAsync).RequireAuthorization(Policies.Permission(Permissions.LogsView));
        assistant.MapPost("/insights/run", RunInsightsAsync).RequireAuthorization(settings);

    }

    // Configuracao

    private static object SettingsDto(CoreSettings s) => new
    {
        keySet = s.AnthropicKeyProtected is not null,
        keyHint = s.AnthropicKeyHint,
        model = s.AssistantModel,
        name = s.AssistantName,
        agentId = s.AssistantAgentId,
        agentEnabled = s.AssistantAgentEnabled,
        nativeEnabled = s.AssistantNativeEnabled,
        instructions = s.AssistantInstructions,
        chatEffort = s.AssistantChatEffort,
        logEffort = s.AssistantLogEffort,
        efforts = AssistantModels.Efforts,
        chatEnabled = s.AssistantChatEnabled,
        faqLearn = s.FaqLearnFromTickets,
        s.LogInsightsEnabled,
        s.LogInsightsIntervalHours,
        s.LogInsightsMinLevel,
        s.LogInsightsPush,
        s.LogInsightsEmail,
        s.LogInsightsLastRunAt,
        smtpConfigured = !string.IsNullOrWhiteSpace(s.SmtpHost) && !string.IsNullOrWhiteSpace(s.SmtpFrom),
        models = AssistantModels.All,
    };

    private static async Task<IResult> GetSettingsAsync(CybereyesDbContext db, CancellationToken ct) =>
        TypedResults.Ok(SettingsDto(await SettingsStore.GetAsync(db, ct)));

    /// <summary>Chave da Anthropic: comeca com sk-ant- e nao tem espacos.</summary>
    public static bool ValidKey(string key) => key.StartsWith("sk-ant-", StringComparison.Ordinal) && key.Length >= 20 && !key.Any(char.IsWhiteSpace);

    /// <summary>ID de agente da Anthropic: letras, numeros, "_" e "-".</summary>
    public static bool ValidAgentId(string id) => id.Length is > 0 and <= 100 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');

    private static async Task<IResult> SaveSettingsAsync(AssistantSettingsRequest r, CybereyesDbContext db, IDataProtectionProvider protection,
        AssistantProfiles profiles, IAuditService audit, CancellationToken ct)
    {
        var agentId = string.IsNullOrWhiteSpace(r.AgentId) ? null : r.AgentId.Trim();
        if (agentId is not null && !ValidAgentId(agentId))
        {
            return Problems.Validation("agentId", "Agente invalido");
        }
        if (!AssistantModels.All.Contains(r.Model) && !(r.Model == AssistantModels.FromAgent && agentId is not null))
        {
            return Problems.Validation("model", agentId is null && r.Model == AssistantModels.FromAgent ? "Escolha um agente para usar o modelo dele" : "Modelo invalido");
        }
        if (r.Model == AssistantModels.FromAgent && !r.AgentEnabled)
        {
            return Problems.Validation("model", "Ative o agente da Anthropic para usar o modelo dele");
        }
        if ((r.ChatEnabled || r.LogInsightsEnabled) && !r.NativeEnabled && !(r.AgentEnabled && agentId is not null))
        {
            return Problems.Validation("nativeEnabled", "Ative o agente nativo ou o agente da Anthropic para ligar o assistente");
        }
        if (!AssistantModels.Efforts.Contains(r.ChatEffort) || !AssistantModels.Efforts.Contains(r.LogEffort))
        {
            return Problems.Validation("chatEffort", "Nivel de esforco invalido");
        }
        if (!InsightLevels.Contains(r.LogInsightsMinLevel))
        {
            return Problems.Validation("logInsightsMinLevel", "Nivel invalido");
        }
        var key = r.ApiKey?.Trim();
        if (key is { Length: > 0 } && !ValidKey(key))
        {
            return Problems.Validation("apiKey", "A chave da Anthropic comeca com sk-ant-");
        }
        var s = await SettingsStore.GetAsync(db, ct);
        var keyChange = key switch
        {
            null => null,
            "" => "removida",
            _ => "trocada",
        };
        if (key is not null)
        {
            s.AnthropicKeyProtected = key.Length == 0 ? null : AssistantKey.Protect(key, protection);
            s.AnthropicKeyHint = key.Length == 0 ? null : key[^4..];
        }
        if ((r.ChatEnabled || r.LogInsightsEnabled) && s.AnthropicKeyProtected is null)
        {
            return Problems.Validation("apiKey", "Cadastre a chave da API da Anthropic antes de ligar o assistente");
        }
        s.AssistantModel = r.Model;
        s.AssistantName = r.Name.Trim();
        s.AssistantAgentId = agentId;
        s.AssistantAgentEnabled = r.AgentEnabled;
        s.AssistantNativeEnabled = r.NativeEnabled;
        s.AssistantInstructions = string.IsNullOrWhiteSpace(r.Instructions) ? null : r.Instructions.Trim();
        s.AssistantChatEffort = r.ChatEffort;
        s.AssistantLogEffort = r.LogEffort;
        s.AssistantChatEnabled = r.ChatEnabled;
        s.FaqLearnFromTickets = r.FaqLearn;
        s.LogInsightsEnabled = r.LogInsightsEnabled;
        s.LogInsightsIntervalHours = r.LogInsightsIntervalHours;
        s.LogInsightsMinLevel = r.LogInsightsMinLevel;
        s.LogInsightsPush = r.LogInsightsPush;
        s.LogInsightsEmail = r.LogInsightsEmail;
        await db.SaveChangesAsync(ct);
        profiles.Forget();
        await audit.LogAsync("assistant.updated", "settings", "1",
            keyChange is null ? "Assistente de IA alterado" : $"Assistente de IA alterado (chave da API {keyChange})", cancellationToken: ct);
        return TypedResults.Ok(SettingsDto(s));
    }

    private static async Task<IResult> TestAsync(AssistantTestRequest r, CybereyesDbContext db, IDataProtectionProvider protection, IAssistantModel model,
        CancellationToken ct)
    {
        var s = await SettingsStore.GetAsync(db, ct);
        var key = r.ApiKey?.Trim() is { Length: > 0 } typed ? typed : AssistantKey.Read(s, protection);
        if (key is null)
        {
            return Problems.Validation("apiKey", "Informe a chave da API da Anthropic");
        }
        if (!ValidKey(key))
        {
            return Problems.Validation("apiKey", "A chave da Anthropic comeca com sk-ant-");
        }
        var modelId = r.Model is { } m && (AssistantModels.All.Contains(m) || m == AssistantModels.FromAgent) ? m : s.AssistantModel;
        string? agentName = null;
        try
        {
            if (modelId == AssistantModels.FromAgent)
            {
                var agentId = string.IsNullOrWhiteSpace(r.AgentId) ? s.AssistantAgentId : r.AgentId.Trim();
                if (agentId is null || !ValidAgentId(agentId))
                {
                    return Problems.Validation("agentId", "Escolha um agente para usar o modelo dele");
                }
                var agent = await model.GetAgentAsync(key, agentId, ct);
                (modelId, agentName) = (agent.Model, agent.Name);
            }
            await model.VerifyAsync(key, modelId, ct);
        }
        catch (AssistantException ex)
        {
            return Problems.BadRequest(ex.Message);
        }
        return TypedResults.Ok(new
        {
            success = true,
            message = agentName is null
                ? $"Chave válida: o modelo {modelId} está disponível."
                : $"Chave válida: o agente {agentName} usa o modelo {modelId}, que está disponível.",
        });
    }

    // Agentes da conta da Anthropic

    private static async Task<IResult> ListAgentsAsync(CybereyesDbContext db, IDataProtectionProvider protection, IAssistantModel model, CancellationToken ct)
    {
        if (AssistantKey.Read(await SettingsStore.GetAsync(db, ct), protection) is not { } key)
        {
            return Problems.BadRequest("Cadastre a chave da API da Anthropic para listar os agentes");
        }
        try
        {
            return TypedResults.Ok((await model.ListAgentsAsync(key, ct)).Select(ToDto));
        }
        catch (AssistantException ex)
        {
            return Problems.BadRequest(ex.Message);
        }
    }

    private static async Task<IResult> CreateAgentAsync(CreateAgentRequest r, CybereyesDbContext db, IDataProtectionProvider protection, IAssistantModel model,
        IAuditService audit, CancellationToken ct)
    {
        var s = await SettingsStore.GetAsync(db, ct);
        if (AssistantKey.Read(s, protection) is not { } key)
        {
            return Problems.BadRequest("Cadastre a chave da API da Anthropic para criar o agente");
        }
        var modelId = r.Model is { } m && AssistantModels.All.Contains(m) ? m
            : AssistantModels.All.Contains(s.AssistantModel) ? s.AssistantModel : AssistantModels.Default;
        var name = string.IsNullOrWhiteSpace(r.Name) ? s.AssistantName : r.Name.Trim();
        AssistantAgent created;
        try
        {
            created = await model.CreateAgentAsync(key, name, AssistantChat.DefaultAgentDescription, modelId, AssistantChat.DefaultAgentInstructions, ct);
        }
        catch (AssistantException ex)
        {
            return Problems.BadRequest(ex.Message);
        }
        await audit.LogAsync("assistant.agent.create", "settings", "1", $"Agente {created.Name} ({created.Id}) criado na Anthropic", cancellationToken: ct);
        return TypedResults.Created($"/api/assistant/agents/{created.Id}", ToDto(created));
    }

    private static AssistantAgentDto ToDto(AssistantAgent a) => new(a.Id, a.Name, a.Description, a.Model, a.Version);

    // Analises de logs

    private static IResult? RestrictedInsights(CybereyesDbContext db) =>
        db.IsClientRestricted ? Problems.Forbidden("As análises juntam os logs de todos os clientes e ficam disponíveis só para quem vê todos eles") : null;

    private static async Task<IResult> ListInsightsAsync(CybereyesDbContext db, LogInsightTrigger trigger, CancellationToken ct)
    {
        if (RestrictedInsights(db) is { } denied)
        {
            return denied;
        }
        var s = await SettingsStore.GetAsync(db, ct);
        var reports = await db.LogInsightReports.AsNoTracking().OrderByDescending(r => r.CreatedAt).Take(30)
            .Select(r => new LogInsightSummaryDto(r.Id, r.CreatedAt, r.WindowStart, r.WindowEnd, r.Status, r.Manual, r.Model, r.Summary, r.EventCount,
                r.GroupCount, r.AgentCount, r.Error)).ToListAsync(ct);
        return TypedResults.Ok(new
        {
            configured = s.AnthropicKeyProtected is not null,
            enabled = s.LogInsightsEnabled,
            intervalHours = s.LogInsightsIntervalHours,
            running = trigger.Running,
            reports,
        });
    }

    private static async Task<IResult> InsightAsync(long id, CybereyesDbContext db, CancellationToken ct)
    {
        if (RestrictedInsights(db) is { } denied)
        {
            return denied;
        }
        var r = await db.LogInsightReports.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null)
        {
            return Problems.NotFound("Analise");
        }
        var content = JsonSerializer.Deserialize<InsightContent>(r.Content, JsonSerializerOptions.Web) ?? new InsightContent([], []);
        var items = await LogInsightRunner.WithCurrentMachinesAsync(db, content.Items, ct);
        return TypedResults.Ok(new
        {
            r.Id, r.CreatedAt, r.WindowStart, r.WindowEnd, r.Status, r.Manual, r.Model, r.Summary, r.EventCount, r.GroupCount, r.AgentCount,
            r.InputTokens, r.OutputTokens, r.Error, items, content.Suggestions,
        });
    }

    private static async Task<IResult> RunInsightsAsync(CybereyesDbContext db, LogInsightTrigger trigger, IAuditService audit, CancellationToken ct)
    {
        if (RestrictedInsights(db) is { } denied)
        {
            return denied;
        }
        var s = await SettingsStore.GetAsync(db, ct);
        if (s.AnthropicKeyProtected is null)
        {
            return Problems.BadRequest("Cadastre a chave da API da Anthropic em Configurações");
        }
        if (!AssistantProfiles.AnyAgentEnabled(s))
        {
            return Problems.BadRequest("Ative o agente nativo ou o agente da Anthropic em Configurações");
        }
        if (trigger.Running)
        {
            return Problems.Conflict("Já existe uma análise em andamento");
        }
        trigger.Request();
        await audit.LogAsync("assistant.insights.run", "settings", "1", "Analise de logs pedida manualmente", cancellationToken: ct);
        return TypedResults.Accepted((string?)null);
    }
}
