using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace Cybereyes.Api.Mcp;

/// <summary>Tarefa nova de um projeto, na criacao dele.</summary>
public sealed record ProjectTaskInput(
    [property: Description("O que precisa ser feito")] string Title,
    [property: Description("Responsavel: id de list_project_options ou \"me\"")] string? AssigneeId = null,
    [property: Description("Prazo AAAA-MM-DD")] string? DueDate = null,
    string? Description = null);

/// <summary>Projetos: tarefas com responsaveis, estacoes de clientes e setores, andamento documentado e ciclos recorrentes.</summary>
[McpServerToolType]
public sealed class ProjectTools(PlatformApi api)
{
    [McpServerTool(Name = "list_projects", Title = "Listar projetos", ReadOnly = true, OpenWorld = false)]
    [Description("Projetos com fase (scheduled, in_progress, late, paused, done, cancelled), responsavel, periodo do ciclo atual, progresso e quantas tarefas do usuario da chave estao abertas (myOpenTasks).")]
    public Task<string> ListProjects(
        [Description("open (padrao: ativos e pausados), all, active, paused, done ou cancelled")] string? status = null,
        int? clientId = null,
        [Description("Texto no nome ou na descricao")] string? search = null,
        [Description("true: so os projetos em que o usuario da chave e responsavel ou tem tarefa")] bool? mine = null,
        CancellationToken ct = default) =>
        api.GetAsync("/api/projects", ct, ("status", status), ("clientId", clientId), ("search", search), ("mine", mine));

    [McpServerTool(Name = "get_project", Title = "Ver projeto", ReadOnly = true, OpenWorld = false)]
    [Description("Projeto com estacoes (agents[].id e o agentRowId usado no andamento), tarefas, progresso e o que o usuario da chave pode fazer (can). notes=true traz tambem a documentacao do ciclo atual.")]
    public async Task<string> GetProject(int projectId, bool notes = false, CancellationToken ct = default)
    {
        var detail = await api.GetAsync($"/api/projects/{projectId}", ct);
        if (!notes)
        {
            return detail;
        }
        using var doc = JsonDocument.Parse(detail);
        var cycle = doc.RootElement.GetProperty("cycle").GetInt32();
        var list = await api.GetAsync($"/api/projects/{projectId}/notes", ct, ("cycle", cycle));
        return $"{{\"project\":{detail},\"notes\":{list}}}";
    }

    [McpServerTool(Name = "list_project_options", Title = "Responsaveis, clientes e estacoes para projetos", ReadOnly = true, OpenWorld = false)]
    [Description("Quem pode ser responsavel (users), clientes com setores (sites) e estacoes (agents, com clientId e siteId) para montar um projeto.")]
    public Task<string> ListProjectOptions(CancellationToken ct = default) => api.GetAsync("/api/projects/options", ct);

    [McpServerTool(Name = "create_project", Title = "Criar projeto", OpenWorld = false)]
    [Description("Cria um projeto. Escopo opcional (clientIds, siteIds, agentIds; os clientes das estacoes e setores entram sozinhos); sem escopo e um projeto interno so com tarefas. Recorrente exige startDate, e o prazo precisa cair antes do proximo ciclo.")]
    public async Task<string> CreateProject(
        [Description("2 a 200 caracteres")] string name,
        string? description = null,
        [Description("Responsavel: id de list_project_options ou \"me\"")] string? ownerId = null,
        [Description("none (padrao), daily, weekly, monthly ou yearly")] string? recurrence = null,
        [Description("A cada quantos periodos (1 a 365)")] int? recurrenceInterval = null,
        [Description("Inicio do (primeiro) ciclo, AAAA-MM-DD")] string? startDate = null,
        [Description("Prazo do (primeiro) ciclo, AAAA-MM-DD")] string? dueDate = null,
        int[]? clientIds = null,
        [Description("Setores (sites) de list_project_options")] int[]? siteIds = null,
        [Description("Estacoes (ids de agentes) de list_project_options")] int[]? agentIds = null,
        ProjectTaskInput[]? tasks = null,
        CancellationToken ct = default)
    {
        string? me = null;
        async Task<string?> Resolve(string? id)
        {
            if (!string.Equals(id?.Trim(), "me", StringComparison.OrdinalIgnoreCase))
            {
                return string.IsNullOrWhiteSpace(id) ? null : id.Trim();
            }
            if (me is null)
            {
                using var doc = JsonDocument.Parse(await api.GetAsync("/api/auth/me", ct));
                me = doc.RootElement.GetProperty("id").GetString();
            }
            return me;
        }
        var taskBodies = new List<object>();
        foreach (var t in tasks ?? [])
        {
            taskBodies.Add(new { title = t.Title, description = t.Description, assigneeId = await Resolve(t.AssigneeId), dueDate = t.DueDate });
        }
        return await api.PostAsync("/api/projects", new
        {
            name, description, ownerId = await Resolve(ownerId), recurrence = recurrence ?? "none", recurrenceInterval, startDate, dueDate,
            clientIds = clientIds ?? [], siteIds = siteIds ?? [], agentIds = agentIds ?? [], tasks = taskBodies,
        }, ct);
    }

    [McpServerTool(Name = "add_project_task", Title = "Incluir tarefa no projeto", OpenWorld = false)]
    [Description("Inclui uma tarefa com responsavel e prazo. O responsavel recebe um aviso no celular.")]
    public async Task<string> AddProjectTask(int projectId, string title,
        [Description("Responsavel: id de list_project_options ou \"me\"")] string? assigneeId = null,
        [Description("Prazo AAAA-MM-DD")] string? dueDate = null,
        string? description = null, CancellationToken ct = default)
    {
        if (string.Equals(assigneeId?.Trim(), "me", StringComparison.OrdinalIgnoreCase))
        {
            using var doc = JsonDocument.Parse(await api.GetAsync("/api/auth/me", ct));
            assigneeId = doc.RootElement.GetProperty("id").GetString();
        }
        return await api.PostAsync($"/api/projects/{projectId}/tasks", new { title, description, assigneeId, dueDate }, ct);
    }

    [McpServerTool(Name = "update_project_progress", Title = "Registrar andamento do projeto", Idempotent = true, OpenWorld = false)]
    [Description("Muda a situacao de estacoes (agentRowIds = agents[].id de get_project, nao o id do agente) e/ou tarefas (taskIds) e grava um registro na documentacao.")]
    public Task<string> UpdateProjectProgress(int projectId,
        [Description("pending, in_progress, done, problem ou skipped (nao se aplica)")] string status,
        long[]? agentRowIds = null, long[]? taskIds = null,
        [Description("Observacao: o que foi feito ou encontrado")] string? note = null,
        CancellationToken ct = default) =>
        api.PutAsync($"/api/projects/{projectId}/progress", new { agentRowIds = agentRowIds ?? [], taskIds = taskIds ?? [], status, note }, ct);

    [McpServerTool(Name = "add_project_note", Title = "Documentar projeto", OpenWorld = false)]
    [Description("Escreve na documentacao do projeto, sobre o projeto todo, uma estacao (projectAgentId = agents[].id) ou uma tarefa. Com status, tambem muda a situacao dela e o texto vira a observacao.")]
    public Task<string> AddProjectNote(int projectId, string body, long? projectAgentId = null, long? projectTaskId = null,
        [Description("pending, in_progress, done, problem ou skipped")] string? status = null, CancellationToken ct = default) =>
        api.PostAsync($"/api/projects/{projectId}/notes", new { body, projectAgentId, projectTaskId, status }, ct);

    [McpServerTool(Name = "set_project_status", Title = "Pausar, retomar, cancelar ou reabrir projeto", Idempotent = true, OpenWorld = false)]
    [Description("active (retomar ou reabrir), paused ou cancelled. Para concluir, use close_project_cycle.")]
    public Task<string> SetProjectStatus(int projectId, string status, CancellationToken ct = default) =>
        api.PutAsync($"/api/projects/{projectId}/status", new { status }, ct);

    [McpServerTool(Name = "close_project_cycle", Title = "Concluir ciclo ou projeto", Destructive = true, OpenWorld = false)]
    [Description("Conclui o ciclo atual e guarda o resultado no historico. Recorrente: estacoes e tarefas voltam a pendentes e as datas avancam (finish=true encerra o projeto em vez disso). Sem repeticao: o projeto fica concluido. Confira antes com get_project o que ainda esta pendente.")]
    public Task<string> CloseProjectCycle(int projectId, [Description("Como foi o ciclo e o que ficou pendente")] string? summary = null,
        bool finish = false, CancellationToken ct = default) =>
        api.PostAsync($"/api/projects/{projectId}/cycles", new { summary, finish }, ct);
}
