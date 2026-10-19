# Servidor MCP (agentes de IA)

O Cybereyes expõe um servidor MCP (Model Context Protocol) para que agentes de IA atendam chamados e operem as máquinas
pela plataforma: agentes da Anthropic (Managed Agents), a Messages API com o conector MCP, Claude Code, Claude Desktop ou
qualquer cliente MCP.

| Item | Valor |
|---|---|
| Endereço | `https://<host>/api/mcp` (o mesmo do console) |
| Transporte | Streamable HTTP, sem sessão (`Stateless`): qualquer réplica da API atende |
| Autenticação | Chave de API em `Authorization: Bearer <chave>` ou `X-API-KEY: <chave>`. Sem chave: 401 |
| Implementação | SDK oficial `ModelContextProtocol.AspNetCore` dentro da API (`backend/src/Cybereyes.Api/Mcp`) |

## Como funciona

Cada ferramenta chama a rota REST correspondente da própria API (pela porta interna, em `127.0.0.1`) repassando a credencial
de quem chamou. Por isso o agente de IA tem exatamente as permissões do usuário dono da chave, vê só os clientes desse usuário,
passa pelas mesmas validações e tudo entra na auditoria em nome dele, com o IP de quem chamou o MCP. Um erro da rota volta como
resultado de erro da ferramenta (`isError`), com o status HTTP e a mensagem (ex.: `HTTP 403: o usuario da chave nao tem
permissao...`), e a conversa do agente continua.

As instruções do servidor (`instructions`, enviadas na inicialização) descrevem o fluxo de atendimento: ler o chamado, assumir,
investigar antes de agir, registrar o plano em nota interna, falar com o usuário em português, resolver com a solução ou a
solução de contorno e apontar o tempo.

No nginx, `location = /api/mcp` não usa buffer (respostas em SSE) e espera até 330 s, porque `run_command` e `run_script`
aguardam o resultado na máquina por até 300 s. Para usar outra porta interna, configure `Mcp:ApiBaseUrl`.

## Ferramentas

Ferramentas marcadas com `destructiveHint` mudam a máquina; os clientes MCP costumam pedir confirmação para elas.

| Ferramenta | Rota | Permissão |
|---|---|---|
| `whoami` | `GET /api/auth/me` | — |
| `list_clients` | `GET /api/clients` | `clients.view` |
| `dashboard_overview` | `GET /api/dashboard/overview` | — |
| `list_tickets` | `GET /api/tickets` | `tickets.view` |
| `get_ticket` | `GET /api/tickets/{id}` + `/messages` | `tickets.view` |
| `create_ticket` | `POST /api/tickets` | `tickets.manage` |
| `update_ticket` | `PATCH /api/tickets/{id}` | `tickets.manage` |
| `reply_ticket` | `POST /api/tickets/{id}/messages` (resposta ou nota interna) | `tickets.manage` |
| `set_ticket_status` | `PUT /api/tickets/{id}/status` | `tickets.manage` |
| `assign_ticket` | `PUT /api/tickets/{id}/assign` (`"me"`, `"none"` ou id) | `tickets.manage` |
| `resolve_ticket` | `POST /api/tickets/{id}/resolve` (solução ou solução de contorno) | `tickets.manage` |
| `add_ticket_time` | `POST /api/tickets/{id}/time` | `tickets.manage` |
| `list_ticket_options` | `GET /api/ticket-queues` + `/api/tickets/assignees` | `tickets.view` |
| `list_agents` | `GET /api/agents` | `agents.view` |
| `get_agent` | `GET /api/agents/{id}` | `agents.view` |
| `get_agent_details` | `GET /api/agents/{id}/{health\|checks\|tasks\|policies\|software\|services\|processes\|updates\|startup\|history\|pending-actions\|asset\|tickets}` | conforme a seção |
| `run_command` (destrutiva) | `POST /api/agents/{id}/command` (espera até 300 s) | `agents.run` |
| `run_script` (destrutiva) | `POST /api/agents/{id}/runscript` (espera até 300 s) | `agents.run` |
| `service_action` (destrutiva) | `POST /api/agents/{id}/services/{nome}/action` | `agents.control` |
| `kill_process` (destrutiva) | `DELETE /api/agents/{id}/processes/{pid}` | `agents.control` |
| `power_action` (destrutiva) | `POST /api/agents/{id}/reboot`, `/shutdown` ou `/wake` | `agents.control` |
| `run_checks` | `POST /api/agents/{id}/checks/run` | `agents.run` |
| `run_task` (destrutiva) | `POST /api/agents/{id}/tasks/{taskId}/run` | `agents.run` |
| `refresh_software` | `POST /api/agents/{id}/software/refresh` | `agents.view` |
| `install_software` (destrutiva) | `POST /api/agents/{id}/software/install` | `software.manage` |
| `windows_updates` (destrutiva) | `POST /api/agents/{id}/updates/scan` ou `/install` | `agents.view` / `patches.manage` |
| `list_alerts` | `GET /api/alerts` | `alerts.view` |
| `alert_action` | `POST /api/alerts/bulk` (resolver ou adiar) | `alerts.manage` |
| `search_logs`, `logs_summary` | `GET /api/logs`, `/api/logs/summary` | `logs.view` |
| `list_scripts`, `get_script` | `GET /api/scripts`, `/api/scripts/{id}` | `scripts.view` |
| `search_docs`, `get_doc_page` | `GET /api/doc-pages`, `/api/doc-pages/{id}` | `docs.view` |
| `list_assets` | `GET /api/assets` | `inventory.view` |
| `api_get` | qualquer `GET /api/...` (só caminho relativo; sem host, `..` ou `//`) | a da rota |

Não há ferramenta para revelar senhas do cofre, gerenciar usuários, papéis, chaves ou configurações; `api_get` só lê.

## Preparar o acesso do agente

1. **Papel**: em Configurações > Papéis, crie um papel "Agente de IA" só com o necessário. Atendimento completo:
   `tickets.view`, `tickets.manage`, `agents.view`, `agents.run`, `agents.control`, `alerts.view`, `alerts.manage`,
   `logs.view`, `scripts.view`, `docs.view`, `inventory.view`, `clients.view`. Acrescente `software.manage` e
   `patches.manage` se ele puder instalar programas e atualizações. Sem `agents.run`/`agents.control`, ele só investiga.
2. **Usuário**: crie um usuário para o agente (ex.: "Assistente IA") com esse papel e, se for o caso, só com os clientes que
   ele atende. As ações aparecem na auditoria e nos chamados com esse nome.
3. **Chave**: um superusuário cria a chave em Configurações > Chaves de API escolhendo esse usuário em "Dono da chave"
   (`POST /api/apikeys` com `userId`); não é preciso entrar no console como ele. Copie a chave na hora: ela não é mostrada
   de novo.

## Conectar

**Agentes da Anthropic (Managed Agents)**: na definição do agente, declare o servidor e o toolset; a chave vai num vault como
credencial `static_bearer` com o mesmo endereço (o vault injeta o `Authorization: Bearer` nas chamadas):

```json
{
  "mcp_servers": [{ "type": "url", "name": "cybereyes", "url": "https://<host>/api/mcp" }],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "cybereyes" }]
}
```

O toolset de MCP pede confirmação de cada chamada por padrão (`always_ask`); para o agente agir sozinho nas consultas, libere
por ferramenta em `configs` (ex.: `list_tickets`, `get_ticket`, `get_agent_details` com `always_allow`) e mantenha
`always_ask` nas destrutivas.

**Messages API (conector MCP, beta `mcp-client-2025-11-20`)**: `mcp_servers: [{ type: "url", name: "cybereyes", url,
authorization_token: "<chave>" }]` e `tools: [{ type: "mcp_toolset", mcp_server_name: "cybereyes" }]`.

**Claude Code**:
```bash
claude mcp add --transport http cybereyes https://<host>/api/mcp --header "Authorization: Bearer <chave>"
```

**Teste manual**:
```bash
curl -s https://<host>/api/mcp -H "Authorization: Bearer <chave>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Segurança

- A chave dá ao agente tudo o que o usuário dela pode fazer: use um usuário e um papel próprios, nunca a chave de um
  administrador. Revogar a chave em Configurações > Chaves de API corta o acesso na hora.
- Texto vindo de chamados, logs e máquinas chega ao agente como dado. As instruções do servidor pedem a menor ação possível e
  proíbem reiniciar ou desligar sem o pedido do usuário, mas o limite real são as permissões do papel e a confirmação das
  ferramentas destrutivas no cliente MCP.
- O MCP não aceita sessão nem guarda estado: cada chamada é autenticada de novo.
