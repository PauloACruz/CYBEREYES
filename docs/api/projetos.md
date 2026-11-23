# API de Projetos

Menu **Projetos** (`/projetos`). Um projeto é um trabalho planejado, com tarefas e responsáveis, que pode ter um escopo de clientes,
setores (sites) e estações. Pode acontecer uma vez ou se repetir: por exemplo, a limpeza física mensal das estações do setor
Financeiro do cliente X. Cada estação e cada tarefa tem uma situação no ciclo atual. O andamento fica documentado em registros
com texto, fotos e arquivos. Um projeto também pode ser interno, sem cliente nem estação, só com tarefas e responsáveis.

Migration `Fase30Projetos`: tabelas `projects`, `project_clients`, `project_sites`, `project_agents`, `project_tasks`,
`project_cycles`, `project_notes`, `project_attachments` e `project_attachment_data`.

## Permissões

| Permissão | O que libera |
|---|---|
| `projects.view` | Ver projetos. O responsável pelo projeto e os responsáveis pelas tarefas também registram o andamento e documentam |
| `projects.manage` | Criar, editar, pausar, concluir, reabrir e excluir projetos e tarefas; registrar o andamento de qualquer projeto |

A migration dá `projects.manage` aos papéis que já tinham `tickets.manage` e `projects.view` aos que tinham `tickets.view`. O papel
Técnico criado numa instalação nova já vem com as duas.

Quem pode registrar:

- **Estação e documentação**: quem tem `projects.manage`, o responsável pelo projeto e quem é responsável por alguma tarefa dele.
- **Tarefa**: quem tem `projects.manage`, o responsável pelo projeto e o responsável pela tarefa.
- **Excluir um registro**: quem o escreveu ou quem tem `projects.manage`. Os acontecimentos automáticos não podem ser excluídos.

## Escopo de clientes

O projeto guarda os clientes envolvidos: os escolhidos e os das estações e setores escolhidos. Um usuário restrito a alguns
clientes só vê o projeto quando enxerga **todos** esses clientes. O projeto sem cliente (interno) não expõe dado de cliente e fica
visível para todos com `projects.view`.

O responsável pelo projeto ou por uma tarefa precisa enxergar todos os clientes do projeto. Caso contrário, a API responde 400 e
nomeia quem não tem acesso.

## Situação e fase

`status` guardado: `active`, `paused`, `done`, `cancelled`. A `phase` exibida é a situação ou, no projeto ativo, sai das datas do
ciclo:

| `phase` | Quando |
|---|---|
| `scheduled` | Ativo e o início do ciclo ainda não chegou |
| `late` | Ativo e o prazo do ciclo já passou |
| `in_progress` | Ativo, nos outros casos |
| `paused` / `done` / `cancelled` | A própria situação |

Situação de estação e tarefa (`ProjectItemStatus`): `pending`, `in_progress`, `done`, `problem`, `skipped` (não se aplica).
`done` e `skipped` contam como encerradas no progresso. "Hoje" é a data no fuso do console (Configurações).

## Repetição e ciclos

`recurrence`: `none`, `daily`, `weekly`, `monthly` ou `yearly`, a cada `recurrenceInterval` períodos (1 a 365). O projeto
recorrente exige `startDate`, e o prazo (`dueDate`) precisa cair antes do início do próximo ciclo.

`POST /api/projects/{id}/cycles` conclui o ciclo atual e grava o resultado de cada estação e tarefa em `project_cycles`. Depois disso:

- **Recorrente, sem `finish`**: o ciclo seguinte começa. Estações e tarefas voltam a `pending`, sem observação, e as datas do ciclo
  e das tarefas avançam o mesmo número de períodos. Se o ciclo foi concluído com atraso, os ciclos que já teriam terminado são
  pulados e o próximo é o que contém hoje. A repetição mensal no dia 31 cai no último dia dos meses mais curtos.
- **Sem repetição, ou com `finish: true`**: o projeto fica `done`, com tudo como estava.

Reabrir um projeto concluído (`PUT .../status` com `active`) desfaz o fechamento do último ciclo, que sai do histórico.

## Rotas

| Método | Rota | Permissão | Resposta |
|---|---|---|---|
| GET | `/api/projects` | `projects.view` | `ProjectSummaryDto[]` |
| GET | `/api/projects/options` | `projects.view` | `ProjectOptionsDto` |
| GET | `/api/projects/{id}` | `projects.view` | `ProjectDetailDto` |
| POST | `/api/projects` | `projects.manage` | 201 `ProjectDetailDto` |
| PUT | `/api/projects/{id}` | `projects.manage` | `ProjectDetailDto` |
| DELETE | `/api/projects/{id}` | `projects.manage` | 204 |
| PUT | `/api/projects/{id}/status` | `projects.manage` | `ProjectDetailDto` |
| POST | `/api/projects/{id}/tasks` | `projects.manage` | 201 `{ "id": 50 }` |
| PUT | `/api/projects/{id}/tasks/{taskId}` | `projects.manage` | 204 |
| DELETE | `/api/projects/{id}/tasks/{taskId}` | `projects.manage` | 204 |
| PUT | `/api/projects/{id}/progress` | `projects.view` e a regra acima | 204 |
| GET | `/api/projects/{id}/notes` | `projects.view` | `ProjectNoteDto[]` |
| POST | `/api/projects/{id}/notes` | `projects.view` e a regra acima | 201 `ProjectNoteDto` |
| DELETE | `/api/projects/{id}/notes/{noteId}` | autor ou `projects.manage` | 204 |
| POST | `/api/projects/{id}/notes/{noteId}/attachments` | autor do registro ou `projects.manage` | 201 `ProjectAttachmentDto` |
| GET | `/api/projects/{id}/attachments/{attachmentId}` | `projects.view` | arquivo |
| GET | `/api/projects/{id}/cycles` | `projects.view` | `ProjectCycleDto[]` |
| POST | `/api/projects/{id}/cycles` | `projects.manage` | `ProjectDetailDto` |
| GET | `/api/agents/{id}/projects` | `projects.view` | `AgentProjectDto[]` |

### GET /api/projects

Filtros: `status` (`open` = ativos e pausados, o padrão; `all`; ou uma situação), `clientId`, `search` (nome e descrição) e
`mine=true` (responsável pelo projeto ou por alguma tarefa). Ordem: prazo mais próximo primeiro, sem prazo por último. Até 500.

```json
[
  {
    "id": 7, "name": "Limpeza física", "status": "active", "phase": "in_progress",
    "owner": { "id": "3f7c...", "name": "Maria Silva" }, "recurrence": "monthly", "recurrenceInterval": 1, "cycle": 3,
    "startDate": "2026-11-01", "dueDate": "2026-11-10", "clients": [{ "id": 1, "name": "Clinica Central" }],
    "progress": { "agentsTotal": 12, "agentsFinished": 9, "tasksTotal": 2, "tasksFinished": 1, "problems": 1, "overdueTasks": 0 },
    "myOpenTasks": 1, "updatedAt": "2026-11-02T10:00:00Z"
  }
]
```

### GET /api/projects/options

Listas do formulário, já no escopo de quem consulta: usuários que podem ser responsáveis (ativos, com alguma permissão de projetos
ou superusuários), clientes com setores e estações (`id`, `hostname`, `clientId`, `siteId`, `description`, `status` online/offline/overdue).

### POST /api/projects e PUT /api/projects/{id}

```json
{
  "name": "Limpeza física", "description": "Limpeza das estações da recepção",
  "ownerId": "3f7c...", "recurrence": "monthly", "recurrenceInterval": 1,
  "startDate": "2026-11-01", "dueDate": "2026-11-10",
  "clientIds": [], "siteIds": [10], "agentIds": [100, 101],
  "tasks": [{ "title": "Comprar álcool isopropílico", "assigneeId": "9a1b...", "dueDate": "2026-10-30" }]
}
```

- Escopo opcional. Os clientes dos setores e das estações entram em `clients` sozinhos.
- `tasks` só vale na criação. Depois, use as rotas de tarefa.
- Na edição, a lista de estações substitui a anterior. A estação que sai perde a situação do ciclo atual, mas os registros
  continuam com o nome dela. A que fica mantém a situação e atualiza hostname e cliente. A de agente removido sai na próxima edição.
- Até 5000 estações e 500 tarefas por projeto.

### PUT /api/projects/{id}/status

`{ "status": "paused" }`. Aceita `active` (retomar ou reabrir), `paused` e `cancelled`. `done` é recusado: para concluir, use
`POST .../cycles`. Cada mudança gera um acontecimento na documentação.

### PUT /api/projects/{id}/progress

Muda a situação de várias estações e/ou tarefas de uma vez e grava **um** registro de andamento, com os nomes no assunto ("PC-01,
PC-02 e mais 10").

```json
{ "agentRowIds": [1, 2], "taskIds": [], "status": "done", "note": "Limpeza feita" }
```

`agentRowIds` são os `id` de `agents` no detalhe (a linha da estação no projeto), não o id do agente. A observação fica na estação
ou tarefa como a última, e o registro guarda quem fez e quando. Voltar para `pending` limpa quem fez e quando. Responde 409 se o
projeto estiver concluído ou cancelado.

### POST /api/projects/{id}/notes

Registro na documentação, sobre o projeto todo, uma estação (`projectAgentId`) ou uma tarefa (`projectTaskId`). Com `status`, também
muda a situação dela, e o `body` vira a observação.

```json
{ "body": "Teclado com tecla presa; trocar na próxima visita", "projectAgentId": 1, "status": "problem" }
```

Os anexos vão depois, um por envio, em `multipart/form-data` com o campo `file`: até 10 por registro e 10 MB cada. Imagens
(reconhecidas pela assinatura do arquivo) abrem no navegador; o resto baixa como arquivo.

`GET .../notes` filtra por `cycle`, `projectAgentId` e `projectTaskId`, do mais recente para o mais antigo, até 500. Cada registro
tem `kind`: `note` (escrito por alguém), `status` (mudança de situação) ou `event` (criação, pausa, retomada, ciclo concluído...).

### POST /api/projects/{id}/cycles

`{ "summary": "Tudo limpo, faltou o PC-07 (férias)", "finish": false }`. Veja [Repetição e ciclos](#repetição-e-ciclos). Cada
item de `GET .../cycles` traz `kind` (`agent` ou `task`), `title` (hostname ou tarefa), `detail` ("Cliente / Setor" ou o
responsável), `status`, `note`, `doneByName` e `doneAt`.

## Auditoria

`project.create`, `project.update`, `project.delete`, `project.status`, `project.cycle` e `project.note.delete`. O andamento do dia
a dia fica nos registros do próprio projeto.

## Avisos no celular

Com a opção **Projetos** ligada nas notificações do aparelho, chegam avisos de projeto ou tarefa atribuídos ao usuário e do início
dos ciclos agendados. Detalhes em `docs/api/notificacoes.md`.

## Agente de IA e MCP

O servidor MCP (`/api/mcp`) tem as ferramentas `list_projects`, `get_project`, `list_project_options`, `create_project`,
`add_project_task`, `update_project_progress`, `add_project_note`, `set_project_status` e `close_project_cycle`, com as permissões
das rotas (veja `docs/api/mcp.md`). O agente de IA do console usa as mesmas ferramentas, dentro das permissões liberadas para ele em
Configurações; `close_project_cycle` é destrutiva e pede aprovação. Os agentes que já existiam começam sem `projects.*`; libere em
Configurações > Assistente de IA.

## No console

- **Projetos**: indicadores (em andamento, agendados, atrasados, minhas tarefas abertas), filtros por situação, cliente, busca e "só
  os meus".
- **Página do projeto**: abas Estações (filtro, seleção em massa, registrar com foto), Tarefas (concluir com um clique, incluir,
  editar), Documentação (linha do tempo com fotos e filtro por ciclo, estação ou tarefa) e Ciclos concluídos.
- **Agente > Projetos**: os projetos de que a estação faz parte e a situação dela em cada um.

## No app do técnico (celular)

- Aba **Projetos** no rodapé, com o número de tarefas abertas do técnico. A lista começa em "Meus" e tem também "Todos abertos" e
  "Atrasados".
- **Tela do projeto**: as tarefas do técnico vêm primeiro e se concluem com um toque. As estações mostram, por padrão, só as que
  faltam; tocar numa delas abre o registro em tela cheia, com situação, observação e fotos tiradas na hora. A documentação fica
  logo abaixo.
- `/projetos/N`, aberto no celular (inclusive pelo aviso), vai para a tela do app. Com `?aba=...`, fica no console.
