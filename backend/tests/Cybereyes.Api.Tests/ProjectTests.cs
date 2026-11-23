using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Cybereyes.Api.Projects;
using Cybereyes.Core.Projects;
using Microsoft.Extensions.DependencyInjection;

namespace Cybereyes.Api.Tests;

public sealed class ProjectScheduleTests
{
    [Fact]
    public void Advance_KeepsTheCadence_AndClampsTheEndOfTheMonth()
    {
        var jan31 = new DateOnly(2030, 1, 31);
        Assert.Equal(new DateOnly(2030, 2, 28), ProjectRecurrence.Advance(jan31, ProjectRecurrence.Monthly, 1));
        Assert.Equal(new DateOnly(2030, 3, 31), ProjectRecurrence.Advance(jan31, ProjectRecurrence.Monthly, 2));
        Assert.Equal(new DateOnly(2030, 2, 14), ProjectRecurrence.Advance(jan31, ProjectRecurrence.Weekly, 2));
        Assert.Equal(new DateOnly(2030, 2, 3), ProjectRecurrence.Advance(jan31, ProjectRecurrence.Daily, 3));
        Assert.Equal(new DateOnly(2031, 1, 31), ProjectRecurrence.Advance(jan31, ProjectRecurrence.Yearly, 1));
        Assert.Equal(jan31, ProjectRecurrence.Advance(jan31, ProjectRecurrence.None, 1));
    }

    [Fact]
    public void CyclesToAdvance_SkipsCyclesThatWouldAlreadyHaveEnded()
    {
        var start = new DateOnly(2030, 1, 10);
        // Concluido antes ou dentro do proximo ciclo: so um periodo.
        Assert.Equal(1, ProjectEndpoints.CyclesToAdvance(start, ProjectRecurrence.Monthly, 1, new DateOnly(2030, 1, 20)));
        Assert.Equal(1, ProjectEndpoints.CyclesToAdvance(start, ProjectRecurrence.Monthly, 1, new DateOnly(2030, 3, 9)));
        // Concluido com tres meses de atraso: o proximo e o ciclo que contem hoje (10/04), nao o de fevereiro.
        Assert.Equal(3, ProjectEndpoints.CyclesToAdvance(start, ProjectRecurrence.Monthly, 1, new DateOnly(2030, 4, 15)));
    }

    [Fact]
    public void Phase_ComesFromTheStatusAndTheCycleDates()
    {
        var today = new DateOnly(2030, 5, 10);
        Project P(string status, DateOnly? start, DateOnly? due) => new() { Name = "x", CreatedByName = "x", Status = status, StartDate = start, DueDate = due };
        Assert.Equal("scheduled", ProjectEndpoints.Phase(P(ProjectStatus.Active, today.AddDays(1), null), today));
        Assert.Equal("late", ProjectEndpoints.Phase(P(ProjectStatus.Active, today.AddDays(-5), today.AddDays(-1)), today));
        Assert.Equal("in_progress", ProjectEndpoints.Phase(P(ProjectStatus.Active, today, today), today));
        Assert.Equal("in_progress", ProjectEndpoints.Phase(P(ProjectStatus.Active, null, null), today));
        Assert.Equal("paused", ProjectEndpoints.Phase(P(ProjectStatus.Paused, today.AddDays(1), null), today));
        Assert.Equal("done", ProjectEndpoints.Phase(P(ProjectStatus.Done, null, today.AddDays(-9)), today));
    }

    [Fact]
    public void Subject_ListsTheNames_AndSummarizesTheRest()
    {
        Assert.Equal("PC-01, PC-02", ProjectEndpoints.Subject(["PC-01", "PC-02"]));
        var many = Enumerable.Range(1, 100).Select(i => $"ESTACAO-{i:000}").ToList();
        var subject = ProjectEndpoints.Subject(many);
        Assert.True(subject.Length <= 300);
        Assert.StartsWith("ESTACAO-001, ESTACAO-002", subject, StringComparison.Ordinal);
        Assert.Matches(@" e mais \d+$", subject);
    }
}

public sealed partial class AgentTests
{
    private const string PngHeader = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    private sealed record ProjectIdBody(int Id);

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {text}");
        return JsonSerializer.Deserialize<JsonElement>(text);
    }

    [Fact]
    public async Task Projects_StationsTasksDocumentationAndRecurringCycles()
    {
        var (admin, clientId, siteId) = await NewSiteAsync("Cliente projetos limpeza");
        var installer = await InstallerTokenAsync(admin, siteId);
        var (_, pc1, _) = await RegisterAgentAsync(installer, siteId, "proj-pc-01");
        var (_, pc2, _) = await RegisterAgentAsync(installer, siteId, "proj-pc-02");

        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Executor de projetos", isSuperuser = false, permissions = new[] { "projects.view" } });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        var executorId = await fixture.CreateUserAsync(admin, "executor.projeto", "senha-executor-projeto-1", roleId);
        using var executor = await fixture.SignedInClientAsync("executor.projeto", "senha-executor-projeto-1");

        // Recorrente exige o inicio; prazo antes do inicio ou depois do proximo ciclo e recusado.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/projects", new { name = "Sem inicio", recurrence = "monthly" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/projects", new
        {
            name = "Prazo invertido", startDate = "2030-01-31", dueDate = "2030-01-30",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/projects", new
        {
            name = "Prazo longo", recurrence = "monthly", startDate = "2030-01-31", dueDate = "2030-03-01",
        })).StatusCode);

        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/projects", new
        {
            name = "Limpeza fisica (teste de projetos)", description = "Limpeza das estacoes da matriz", recurrence = "monthly", recurrenceInterval = 1,
            startDate = "2030-01-31", dueDate = "2030-02-10", agentIds = new[] { pc1, pc2 }, siteIds = new[] { siteId },
            tasks = new object[]
            {
                new { title = "Separar material", assigneeId = executorId, dueDate = "2030-02-01" },
                new { title = "Avisar o cliente", assigneeId = (Guid?)null },
            },
        }), HttpStatusCode.Created);
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal("scheduled", created.GetProperty("phase").GetString());
        Assert.Equal(1, created.GetProperty("cycle").GetInt32());
        Assert.Equal("2030-02-28", created.GetProperty("nextStartDate").GetString());
        Assert.Equal(clientId, Assert.Single(created.GetProperty("clients").EnumerateArray()).GetProperty("id").GetInt32());
        Assert.Equal(siteId, Assert.Single(created.GetProperty("sites").EnumerateArray()).GetProperty("id").GetInt32());
        var agents = created.GetProperty("agents").EnumerateArray().ToList();
        Assert.Equal(new[] { "proj-pc-01", "proj-pc-02" }, agents.Select(a => a.GetProperty("hostname").GetString()));
        Assert.All(agents, a => Assert.Equal("pending", a.GetProperty("status").GetString()));
        var row1 = agents[0].GetProperty("id").GetInt64();
        var row2 = agents[1].GetProperty("id").GetInt64();
        var tasks = created.GetProperty("tasks").EnumerateArray().ToList();
        var ownTask = tasks[0].GetProperty("id").GetInt64();
        var otherTask = tasks[1].GetProperty("id").GetInt64();

        // Quem so ve projetos nao cria; como responsavel por uma tarefa, aparece em "meus" e registra o andamento.
        Assert.Equal(HttpStatusCode.Forbidden, (await executor.PostAsJsonAsync("/api/projects", new { name = "Projeto do executor" })).StatusCode);
        var mine = await executor.GetFromJsonAsync<List<JsonElement>>("/api/projects?mine=true");
        var listed = Assert.Single(mine!, p => p.GetProperty("id").GetInt32() == id);
        Assert.Equal(1, listed.GetProperty("myOpenTasks").GetInt32());
        Assert.Equal(2, listed.GetProperty("progress").GetProperty("agentsTotal").GetInt32());
        var asExecutor = await executor.GetFromJsonAsync<JsonElement>($"/api/projects/{id}");
        Assert.True(asExecutor.GetProperty("can").GetProperty("record").GetBoolean());
        Assert.False(asExecutor.GetProperty("can").GetProperty("manage").GetBoolean());
        Assert.Equal(new[] { true, false }, asExecutor.GetProperty("tasks").EnumerateArray().Select(t => t.GetProperty("canUpdate").GetBoolean()));

        Assert.Equal(HttpStatusCode.Forbidden, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new { taskIds = new[] { otherTask }, status = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new { taskIds = new[] { ownTask }, status = "done" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new
        {
            agentRowIds = new[] { row1, row2 }, status = "done", note = "Limpeza feita",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new { agentRowIds = new[] { row1 }, status = "feito" })).StatusCode);

        // Nota com mudanca de situacao e foto.
        var note = await JsonAsync(await executor.PostAsJsonAsync($"/api/projects/{id}/notes", new
        {
            projectAgentId = row1, status = "problem", body = "Teclado com tecla presa",
        }), HttpStatusCode.Created);
        var noteId = note.GetProperty("id").GetInt64();
        Assert.Equal("proj-pc-01", note.GetProperty("subject").GetString());
        using (var form = new MultipartFormDataContent())
        {
            var file = new ByteArrayContent(Convert.FromBase64String(PngHeader));
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "file", "teclado.png");
            var attachment = await JsonAsync(await executor.PostAsync($"/api/projects/{id}/notes/{noteId}/attachments", form), HttpStatusCode.Created);
            Assert.Equal("image/png", attachment.GetProperty("contentType").GetString());
            using var download = await executor.GetAsync($"/api/projects/{id}/attachments/{attachment.GetProperty("id").GetInt64()}");
            Assert.Equal(HttpStatusCode.OK, download.StatusCode);
            Assert.Equal("image/png", download.Content.Headers.ContentType?.MediaType);
        }
        var notes = await executor.GetFromJsonAsync<List<JsonElement>>($"/api/projects/{id}/notes?projectAgentId={row1}");
        var withPhoto = Assert.Single(notes!, n => n.GetProperty("id").GetInt64() == noteId);
        Assert.Single(withPhoto.GetProperty("attachments").EnumerateArray());
        Assert.True(withPhoto.GetProperty("canDelete").GetBoolean());

        var detail = await admin.GetFromJsonAsync<JsonElement>($"/api/projects/{id}");
        var progress = detail.GetProperty("progress");
        Assert.Equal(1, progress.GetProperty("agentsFinished").GetInt32());
        Assert.Equal(1, progress.GetProperty("tasksFinished").GetInt32());
        Assert.Equal(1, progress.GetProperty("problems").GetInt32());
        var first = detail.GetProperty("agents").EnumerateArray().First();
        Assert.Equal("problem", first.GetProperty("status").GetString());
        Assert.Equal("Teclado com tecla presa", first.GetProperty("note").GetString());
        Assert.Equal("Usuario executor.projeto", first.GetProperty("doneByName").GetString());

        // Conclui o ciclo: o resultado vai para o historico, tudo volta a pendente e as datas avancam um mes.
        var closed = await JsonAsync(await admin.PostAsJsonAsync($"/api/projects/{id}/cycles", new { summary = "Primeiro ciclo" }), HttpStatusCode.OK);
        Assert.Equal(2, closed.GetProperty("cycle").GetInt32());
        Assert.Equal("active", closed.GetProperty("status").GetString());
        Assert.Equal("2030-02-28", closed.GetProperty("startDate").GetString());
        Assert.Equal("2030-03-10", closed.GetProperty("dueDate").GetString());
        Assert.Equal("2030-03-01", closed.GetProperty("tasks")[0].GetProperty("dueDate").GetString());
        Assert.All(closed.GetProperty("agents").EnumerateArray().Concat(closed.GetProperty("tasks").EnumerateArray()),
            x => Assert.Equal("pending", x.GetProperty("status").GetString()));
        Assert.Equal(1, closed.GetProperty("closedCycles").GetInt32());

        var cycles = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/projects/{id}/cycles");
        var cycle = Assert.Single(cycles!);
        Assert.Equal(1, cycle.GetProperty("number").GetInt32());
        Assert.Equal("Primeiro ciclo", cycle.GetProperty("summary").GetString());
        var items = cycle.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(4, items.Count);
        var pc1Item = Assert.Single(items, i => i.GetProperty("title").GetString() == "proj-pc-01");
        Assert.Equal("problem", pc1Item.GetProperty("status").GetString());
        Assert.Equal("Cliente projetos limpeza / Matriz", pc1Item.GetProperty("detail").GetString());
        Assert.Contains(items, i => i.GetProperty("kind").GetString() == "task" && i.GetProperty("detail").GetString() == "Usuario executor.projeto");

        var cycleNotes = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/projects/{id}/notes?cycle=1");
        Assert.Contains(cycleNotes!, n => n.GetProperty("kind").GetString() == "event" && n.GetProperty("subject").GetString() == "Ciclo 1 concluido");
        Assert.Contains(cycleNotes!, n => n.GetProperty("kind").GetString() == "status" && n.GetProperty("subject").GetString() == "proj-pc-01, proj-pc-02");
        Assert.Empty((await admin.GetFromJsonAsync<List<JsonElement>>($"/api/projects/{id}/notes?cycle=2"))!);

        // Encerrar em vez de seguir: projeto concluido nao aceita andamento; reabrir desfaz o fechamento do ultimo ciclo.
        var finished = await JsonAsync(await admin.PostAsJsonAsync($"/api/projects/{id}/cycles", new { finish = true }), HttpStatusCode.OK);
        Assert.Equal("done", finished.GetProperty("status").GetString());
        Assert.Equal(2, finished.GetProperty("closedCycles").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new { taskIds = new[] { ownTask }, status = "done" })).StatusCode);
        Assert.DoesNotContain((await admin.GetFromJsonAsync<List<JsonElement>>("/api/projects"))!, p => p.GetProperty("id").GetInt32() == id);
        Assert.Contains((await admin.GetFromJsonAsync<List<JsonElement>>("/api/projects?status=done"))!, p => p.GetProperty("id").GetInt32() == id);
        var reopened = await JsonAsync(await admin.PutAsJsonAsync($"/api/projects/{id}/status", new { status = "active" }), HttpStatusCode.OK);
        Assert.Equal("active", reopened.GetProperty("status").GetString());
        Assert.Equal(1, reopened.GetProperty("closedCycles").GetInt32());

        // A estacao mostra os projetos de que faz parte.
        var agentProjects = await admin.GetFromJsonAsync<List<JsonElement>>($"/api/agents/{pc1}/projects");
        Assert.Equal(id, Assert.Single(agentProjects!).GetProperty("id").GetInt32());

        // Editar o escopo: a estacao que sai perde a situacao; a que fica mantem.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/projects/{id}/progress", new { agentRowIds = new[] { row1 }, status = "done" })).StatusCode);
        var edited = await JsonAsync(await admin.PutAsJsonAsync($"/api/projects/{id}", new
        {
            name = "Limpeza fisica (teste de projetos)", recurrence = "monthly", startDate = "2030-02-28", agentIds = new[] { pc1 }, ownerId = executorId,
        }), HttpStatusCode.OK);
        var remaining = Assert.Single(edited.GetProperty("agents").EnumerateArray());
        Assert.Equal(row1, remaining.GetProperty("id").GetInt64());
        Assert.Equal("done", remaining.GetProperty("status").GetString());
        Assert.Empty(edited.GetProperty("sites").EnumerateArray());
        Assert.Equal(executorId, edited.GetProperty("owner").GetProperty("id").GetGuid());

        // Como responsavel pelo projeto, o executor muda qualquer tarefa; excluir o projeto continua exigindo projects.manage.
        Assert.Equal(HttpStatusCode.NoContent, (await executor.PutAsJsonAsync($"/api/projects/{id}/progress", new { taskIds = new[] { otherTask }, status = "in_progress" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await executor.DeleteAsync($"/api/projects/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/projects/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/projects/{id}")).StatusCode);
    }

    [Fact]
    public async Task Projects_FollowTheClientScope_AndTasksWithoutClients()
    {
        var (admin, visibleClient, _) = await NewSiteAsync("Projetos escopo visivel");
        var (_, hiddenClient, _) = await NewSiteAsync("Projetos escopo oculto");

        var role = await admin.PostAsJsonAsync("/api/roles", new
        {
            name = "Gestor de projetos restrito", isSuperuser = false, permissions = new[] { "projects.view", "projects.manage" },
        });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        var user = await JsonAsync(await admin.PostAsJsonAsync("/api/users", new
        {
            username = "gestor.projetos", email = "gestor.projetos@exemplo.com", fullName = "Gestor Projetos", password = "senha-gestor-projetos-1",
            roleIds = new[] { roleId }, allClients = false, clientIds = new[] { visibleClient },
        }), HttpStatusCode.Created);
        var restrictedId = user.GetProperty("id").GetGuid();
        using var restricted = await fixture.SignedInClientAsync("gestor.projetos", "senha-gestor-projetos-1");

        async Task<int> CreateAsync(string name, params int[] clientIds) =>
            (await JsonAsync(await admin.PostAsJsonAsync("/api/projects", new { name, clientIds }), HttpStatusCode.Created)).GetProperty("id").GetInt32();
        var onlyVisible = await CreateAsync("Projeto do cliente visivel", visibleClient);
        var both = await CreateAsync("Projeto dos dois clientes", visibleClient, hiddenClient);
        var internalProject = await CreateAsync("Projeto interno sem cliente");

        var seen = (await restricted.GetFromJsonAsync<List<JsonElement>>("/api/projects?status=all"))!.Select(p => p.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(onlyVisible, seen);
        Assert.Contains(internalProject, seen);
        Assert.DoesNotContain(both, seen);
        Assert.Equal(HttpStatusCode.NotFound, (await restricted.GetAsync($"/api/projects/{both}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await restricted.GetAsync($"/api/projects/{both}/notes")).StatusCode);
        var options = await restricted.GetFromJsonAsync<JsonElement>("/api/projects/options");
        Assert.DoesNotContain(options.GetProperty("clients").EnumerateArray(), c => c.GetProperty("id").GetInt32() == hiddenClient);
        Assert.Contains(options.GetProperty("users").EnumerateArray(), u => u.GetProperty("id").GetGuid() == restrictedId);

        // Quem nao ve todos os clientes do projeto nao pode ser responsavel por ele.
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/projects/{both}/tasks", new { title = "Inventariar", assigneeId = restrictedId })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync($"/api/projects/{onlyVisible}/tasks", new { title = "Inventariar", assigneeId = restrictedId })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await restricted.PostAsJsonAsync("/api/projects", new { name = "Fora do escopo", clientIds = new[] { hiddenClient } })).StatusCode);

        // Projeto sem cliente: so tarefas com responsaveis.
        var task = await JsonAsync(await restricted.PostAsJsonAsync($"/api/projects/{internalProject}/tasks", new
        {
            title = "Documentar o procedimento", assigneeId = restrictedId, dueDate = "2020-01-01",
        }), HttpStatusCode.Created);
        var detail = await restricted.GetFromJsonAsync<JsonElement>($"/api/projects/{internalProject}");
        Assert.Empty(detail.GetProperty("agents").EnumerateArray());
        var only = Assert.Single(detail.GetProperty("tasks").EnumerateArray());
        Assert.Equal(task.GetProperty("id").GetInt64(), only.GetProperty("id").GetInt64());
        Assert.True(only.GetProperty("overdue").GetBoolean());
        Assert.Equal(1, detail.GetProperty("progress").GetProperty("overdueTasks").GetInt32());

        foreach (var id in new[] { onlyVisible, both, internalProject })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/projects/{id}")).StatusCode);
        }
    }
}

public sealed partial class AgentTests
{
    [Fact]
    public async Task Projects_NotifyWhoGetsTheProjectOrATask_AndRemindWhenTheCycleStarts()
    {
        using var admin = await fixture.AdminClientAsync();
        var role = await admin.PostAsJsonAsync("/api/roles", new { name = "Tecnico de projetos com push", isSuperuser = false, permissions = new[] { "projects.view" } });
        var roleId = (await role.Content.ReadFromJsonAsync<ApiFixture.IdBody>())!.Id;
        var tecId = await fixture.CreateUserAsync(admin, "tecnico.push.projeto", "senha-push-projeto-1", roleId);
        using var tec = await fixture.SignedInClientAsync("tecnico.push.projeto", "senha-push-projeto-1");
        var tecDevice = await SubscribeAsync(tec, "projeto-tecnico");
        var quietDevice = await SubscribeAsync(tec, "projeto-silencioso", projects: false);
        var adminDevice = await SubscribeAsync(admin, "projeto-admin");

        DateOnly today;
        using (var scope = fixture.Services.CreateScope())
        {
            today = await ProjectEndpoints.TodayAsync(scope.ServiceProvider.GetRequiredService<Cybereyes.Core.Persistence.CybereyesDbContext>(),
                TimeProvider.System, CancellationToken.None);
        }
        var tomorrow = today.AddDays(1).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

        // Quem fez a acao (o administrador, responsavel por um projeto que ele mesmo criou) nao recebe.
        var adminId = (await admin.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("id").GetGuid();
        var own = await JsonAsync(await admin.PostAsJsonAsync("/api/projects", new { name = "Projeto do proprio admin (push)", ownerId = adminId }),
            HttpStatusCode.Created);
        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/projects", new
        {
            name = "Troca de nobreaks (push)", ownerId = tecId, startDate = tomorrow,
            tasks = new object[] { new { title = "Separar os nobreaks", assigneeId = tecId, dueDate = tomorrow } },
        }), HttpStatusCode.Created);
        var id = created.GetProperty("id").GetInt32();
        var owner = await fixture.Pushes.WaitAsync(tecDevice, m => m.Title == "Projeto sob sua responsabilidade");
        Assert.Equal($"/projetos/{id}", owner.Url);
        Assert.StartsWith("Troca de nobreaks (push) · a partir de ", owner.Body, StringComparison.Ordinal);
        var task = await fixture.Pushes.WaitAsync(tecDevice, m => m.Title == "Tarefa atribuída a você");
        Assert.StartsWith("Separar os nobreaks · Troca de nobreaks (push) · prazo ", task.Body, StringComparison.Ordinal);

        var added = await JsonAsync(await admin.PostAsJsonAsync($"/api/projects/{id}/tasks", new { title = "Testar a autonomia", assigneeId = tecId }),
            HttpStatusCode.Created);
        var taskId = added.GetProperty("id").GetInt64();
        await fixture.Pushes.WaitAsync(tecDevice, m => m.Tag == $"projeto-{id}-tarefa-{taskId}");
        // Editar a tarefa sem trocar o responsavel nao avisa de novo.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/projects/{id}/tasks/{taskId}", new
        {
            title = "Testar a autonomia por 10 minutos", assigneeId = tecId,
        })).StatusCode);

        // Inicio movido para hoje: o lembrete sai uma vez, mesmo rodando o servico duas vezes.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/projects/{id}", new
        {
            name = "Troca de nobreaks (push)", ownerId = tecId, startDate = today.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        })).StatusCode);
        var reminders = fixture.Services.GetRequiredService<ProjectReminderService>();
        await reminders.RunOnceAsync(CancellationToken.None);
        await reminders.RunOnceAsync(CancellationToken.None);
        var reminder = await fixture.Pushes.WaitAsync(tecDevice, m => m.Tag == $"projeto-{id}-ciclo-1");
        Assert.Equal("Troca de nobreaks (push) começa hoje", reminder.Title);
        Assert.StartsWith("2 tarefas", reminder.Body, StringComparison.Ordinal);
        await Task.Delay(300);
        Assert.Single(fixture.Pushes.For(tecDevice), m => m.Tag == $"projeto-{id}-ciclo-1");
        Assert.Equal(1, fixture.Pushes.For(tecDevice).Count(m => m.Tag == $"projeto-{id}-tarefa-{taskId}"));
        Assert.DoesNotContain(fixture.Pushes.For(quietDevice), m => m.Url.StartsWith("/projetos/", StringComparison.Ordinal));
        Assert.DoesNotContain(fixture.Pushes.For(adminDevice), m => m.Url == $"/projetos/{own.GetProperty("id").GetInt32()}");

        foreach (var projectId in new[] { id, own.GetProperty("id").GetInt32() })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/projects/{projectId}")).StatusCode);
        }
    }

    [Fact]
    public async Task Mcp_ProjectTools_CreateRecordAndCloseAProject()
    {
        var (admin, _, siteId) = await NewSiteAsync("Cliente projetos MCP");
        var installer = await InstallerTokenAsync(admin, siteId);
        var (_, pk, _) = await RegisterAgentAsync(installer, siteId, "mcp-proj-pc");
        using var mcp = await McpClientAsync(admin, "agente.projetos", "projects.view", "projects.manage");

        var tools = (await McpAsync(mcp, "tools/list", new { })).GetProperty("tools").EnumerateArray().ToList();
        var close = tools.Single(t => t.GetProperty("name").GetString() == "close_project_cycle");
        Assert.True(close.GetProperty("annotations").GetProperty("destructiveHint").GetBoolean());
        Assert.Contains(tools, t => t.GetProperty("name").GetString() == "update_project_progress");

        var options = JsonDocument.Parse(await McpToolAsync(mcp, "list_project_options", new { })).RootElement;
        Assert.Contains(options.GetProperty("agents").EnumerateArray(), a => a.GetProperty("id").GetInt32() == pk);

        var created = JsonDocument.Parse(await McpToolAsync(mcp, "create_project", new
        {
            name = "Inventario fisico (MCP)", agentIds = new[] { pk }, ownerId = "me",
            tasks = new object[] { new { title = "Etiquetar os equipamentos", assigneeId = "me", dueDate = "2030-01-10" } },
        })).RootElement;
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal("Usuario agente.projetos", created.GetProperty("owner").GetProperty("name").GetString());
        var row = created.GetProperty("agents")[0].GetProperty("id").GetInt64();
        var taskId = created.GetProperty("tasks")[0].GetProperty("id").GetInt64();
        Assert.Equal("Usuario agente.projetos", created.GetProperty("tasks")[0].GetProperty("assignee").GetProperty("name").GetString());

        await McpToolAsync(mcp, "update_project_progress", new { projectId = id, status = "done", agentRowIds = new[] { row }, note = "Etiqueta 0042" });
        await McpToolAsync(mcp, "add_project_note", new { projectId = id, body = "Etiquetas impressas", projectTaskId = taskId, status = "done" });
        await McpToolAsync(mcp, "update_project_progress", new { projectId = id, status = "feito", taskIds = new[] { taskId } }, expectError: true);

        var withNotes = JsonDocument.Parse(await McpToolAsync(mcp, "get_project", new { projectId = id, notes = true })).RootElement;
        Assert.Equal(1, withNotes.GetProperty("project").GetProperty("progress").GetProperty("agentsFinished").GetInt32());
        Assert.Equal(1, withNotes.GetProperty("project").GetProperty("progress").GetProperty("tasksFinished").GetInt32());
        Assert.Contains(withNotes.GetProperty("notes").EnumerateArray(), n => n.GetProperty("body").GetString() == "Etiquetas impressas");

        var mine = JsonDocument.Parse(await McpToolAsync(mcp, "list_projects", new { mine = true })).RootElement;
        Assert.Contains(mine.EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);

        var done = JsonDocument.Parse(await McpToolAsync(mcp, "close_project_cycle", new { projectId = id, summary = "Tudo etiquetado" })).RootElement;
        Assert.Equal("done", done.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/projects/{id}")).StatusCode);
    }
}
