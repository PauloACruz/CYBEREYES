# Contrato do agente - Fase 1

Objetivo: o agente Go atual (`rmmagentwincare`, versao 2.11.0) se registra, faz check-in e responde a comandos no backend novo, **sem nenhuma alteracao no agente**.

Fontes: levantamento do codigo do agente (`rmmagentwincare/agent`, `shared/types.go`, modulo `trmm-shared`) e do servidor Tactical (`api/tacticalrmm/apiv3`, `natsapi/`).

## 1. Identidade e credenciais

| Item | Formato | Uso |
|---|---|---|
| `agent_id` | 40 letras aleatorias, gerado pelo agente | URL, usuario NATS, assunto NATS |
| Token do agente | 40 caracteres hexadecimais, gerado no registro | REST: `Authorization: Token <token>`; NATS: senha |
| Token de instalacao | 64 caracteres hexadecimais, com validade | REST nas rotas `installer`, `newagent`, `meshexe` |

Decisoes do WinCare:
- O token do agente e guardado como hash SHA-256 (busca no REST) e como hash bcrypt (configuracao de usuarios do NATS, que aceita senha bcrypt). O texto puro so existe na resposta do registro.
- O token de instalacao e guardado como hash SHA-256. Chaves de API com a permissao `agents.install` tambem podem registrar agentes (`X-API-KEY`), como no Tactical.
- O agente e sempre identificado pelo token. O `agent_id` da URL e ignorado, como no Tactical.

## 2. REST (`/api/v3`)

Respostas de sucesso sao a string JSON `"ok"` (com aspas), como no Django. Erros de negocio: HTTP 400 com a mensagem como string JSON.

| Rota | Autenticacao | Fase 1 |
|---|---|---|
| `GET /api/v3/installer/` | instalacao | 200 `"ok"`; 401 se token invalido ou expirado |
| `POST /api/v3/installer/` `{version}` | instalacao | 200 `"ok"`; 400 se versao menor que a minima suportada |
| `POST /api/v3/newagent/` | instalacao | cria agente; 200 `{pk, token}`; 400 se ja existe ou site invalido |
| `GET /api/v3/{id}/config/` | agente | intervalos de check-in (nunca zero) |
| `GET /api/v3/{id}/checkinterval/` | agente | `{agent, check_interval}` (120 s + variacao de 1 a 60 s) |
| `GET /api/v3/{id}/checkrunner/` e `/runchecks/` | agente | `{agent, check_interval, checks: []}` (checks na fase 3) |
| `PATCH /api/v3/checkrunner/` | agente | `"ok"` (resultado de checks na fase 3) |
| `POST /api/v3/checkin/` | agente | `"ok"` |
| `POST /api/v3/syncmesh/` | agente | grava `mesh_node_id` |
| `POST /api/v3/choco/` | agente | grava `choco_installed` |
| `POST /api/v3/software/` | agente | grava inventario de software |
| `PUT/PATCH/POST /api/v3/winupdates/`, `POST /api/v3/superseded/` | agente | `"ok"` sem efeito (fase 3) |
| `GET/PATCH /api/v3/{pk}/{id}/taskrunner/` | agente | 404 / `"ok"` (fase 3) |
| `PATCH /api/v3/{pk}/{id}/histresult/` | agente | `"ok"` (fase 2) |
| `POST /api/v3/meshexe/`, `GET /api/v3/{id}/meshreinstall/` | instalacao / agente | 400 (fase 4, MeshCentral) |
| `PATCH /api/v4/{id}/{pk}/chocoresult/` | agente | `"ok"` (fase 3) |

`config` devolve, sorteando a cada chamada: `checkin_hello` 30 a 60, `checkin_agentinfo` 200 a 400, `checkin_winsvc` 2400 a 3000, `checkin_pubip` 300 a 500, `checkin_disks` 1000 a 2000, `checkin_sw` 2800 a 3500, `checkin_wmi` 3000 a 4000, `checkin_syncmesh` 800 a 1200, `limit_data` false, `install_nushell` false, `install_deno` false e os demais textos vazios.

`newagent` recebe `{agent_id, hostname, site, monitoring_type, mesh_node_id, description, goarch, plat}`.

## 3. NATS

- O agente conecta em `wss://<host>:443/natsws` (o Nginx encaminha para o websocket do NATS), usuario `agent_id`, senha = token.
- Permissoes por agente: publicar em `<agent_id>`, `<agent_id>.cmdoutput.>`, `<agent_id>.terminal.>`; assinar `<agent_id>`; respostas permitidas.
- O backend gera o arquivo de usuarios (`/etc/nats/auth/users.conf`, volume compartilhado) a partir do banco, de forma atomica, ao registrar ou excluir agentes, na partida e a cada 5 minutos. O container do NATS detecta a mudanca e recarrega a configuracao sem derrubar conexoes.

### 3.1 Check-in (agente para servidor)

O agente publica no assunto `<agent_id>` com o campo **reply** indicando o tipo. Corpo em msgpack (mapa com as chaves abaixo). O backend assina `*` em grupo de fila (cada mensagem e processada por uma unica replica) e descarta mensagens cujo `agent_id` difere do assunto.

| reply | Chaves | Efeito |
|---|---|---|
| `agent-hello` | `agent_id, version` | `last_seen = agora`, `version` |
| `agent-agentinfo` | `agent_id, logged_in_username, hostname, operating_system, plat, total_ram, boot_time, needs_reboot, goarch` | atualiza dados do agente; `last_logged_in_user` se usuario diferente de `"None"` |
| `agent-disks` | `agent_id, disks[{device, fstype, total, used, free, percent}]` | grava discos (JSON) |
| `agent-winsvc` | `agent_id, services[...]` | grava servicos (JSON) |
| `agent-publicip` | `agent_id, public_ip` | grava IP publico |
| `agent-wmi` | `agent_id, wmi` | grava detalhes WMI (JSON) |

### 3.2 Comandos (servidor para agente)

Requisicao NATS no assunto `<agent_id>`, corpo msgpack com `func` e campos do comando. Todos os valores de `payload` precisam ser strings. Na fase 1 o console usa `ping` (resposta `"pong"`); os demais comandos entram na fase 2.

## 4. Status do agente

Calculado como no Tactical: sem `last_seen` ou visto ha mais de 4 minutos e menos de 30, `offline`; ha mais de 30 minutos, `overdue` (em atraso); caso contrario `online`. O backend grava o status e um servico em segundo plano detecta mudancas a cada 30 segundos e avisa o console em tempo real (SignalR com backplane Redis).

## 5. Instalacao

O console gera o comando de instalacao por site, tipo (servidor ou estacao), sistema e arquitetura, com token de instalacao de validade configuravel:

```
<agente> -m install --api https://<host> --client-id <cliente> --site-id <site> --agent-type <tipo> --auth <token>
```

O endereco de download do agente vem da configuracao `Agent:DownloadBaseUrl` (releases do `rmmagentwincare`). Implantacoes (links publicos com validade) geram o mesmo comando para Linux, macOS e Windows.

## 6. Limites conhecidos da fase 1
- Sem MeshCentral no registro: agentes Windows e macOS sao instalados com `-nomesh` ate a fase 4.
- Checks, tarefas, Windows Update e historico de scripts respondem `"ok"` sem efeito ate as fases 2 e 3.

## 7. API do console (fase 1)

Mesmo padrao da fase 0 (cookie, 2FA, ProblemDetails com `code`).

### Clientes e sites (`clients.view`, `clients.manage`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/clients` | | `ClientDto[]`: `{ id, name, agentCount, sites: [{ id, clientId, name, agentCount }] }` |
| POST | `/api/clients` | `{ name, siteName }` | 201 `ClientDto` (cria o cliente com o primeiro site) |
| PUT | `/api/clients/{id}` | `{ name }` | 204 |
| DELETE | `/api/clients/{id}` | | 204; 409 se houver agentes |
| POST | `/api/clients/{id}/sites` | `{ name }` | 201 `SiteDto` |
| PUT | `/api/sites/{id}` | `{ name }` | 204 |
| DELETE | `/api/sites/{id}` | | 204; 409 se houver agentes ou se for o ultimo site do cliente |

### Agentes (`agents.view`, `agents.manage`)
| Metodo | Rota | Resposta |
|---|---|---|
| GET | `/api/agents?clientId=&siteId=&status=&search=&page=&pageSize=` | `Paged<AgentListItem>` |
| GET | `/api/agents/{id}` | `AgentDetail` |
| POST | `/api/agents/{id}/ping` | `{ status: "online" \| "offline" }` |
| DELETE | `/api/agents/{id}` | 204 (`agents.manage`) |

`AgentListItem`: `{ id, agentId, hostname, clientId, clientName, siteId, siteName, monitoringType, plat, operatingSystem, status, lastSeen, version, loggedInUsername, lastLoggedInUser, publicIp, needsReboot, description }`.
`AgentDetail`: campos acima mais `goArch, totalRam (GB), bootTime, meshNodeId, disks (array JSON), services (array JSON), wmi (JSON), checkInterval, offlineTime, overdueTime, createdAt`.
`status`: `online`, `offline` ou `overdue`. `monitoringType`: `server` ou `workstation`.

### Instalacao (`agents.install`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/agents/installer` | `{ siteId, agentType: "auto"\|"server"\|"workstation", plat: "linux"\|"windows"\|"darwin", goarch?, expiresHours (1 a 720) }` | `{ command, expiresAt, plat }` |
| GET | `/api/deployments` | | `DeploymentDto[]` |
| POST | `/api/deployments` | `{ siteId, agentType, goarch?, expiresAt }` | 201 `DeploymentDto` |
| DELETE | `/api/deployments/{id}` | | 204 |

`DeploymentDto`: `{ id, uid, clientId, clientName, siteId, siteName, agentType, goArch, expiresAt, createdAt, createdBy, commands: { linux, darwin, windows } }`.
Em Linux, `agentType: "auto"` faz o script detectar o ambiente grafico (estacao) ou somente terminal (servidor).

### Tempo real (SignalR)
Hub `/hubs/console` (autenticado). Eventos:
- `agentStatusChanged` `{ agentId, status, lastSeen }`
- `agentsChanged` (agente registrado ou excluido; recarregar a lista)

O cliente deve usar somente WebSockets (`skipNegotiation: true`, `transport: WebSockets`), porque a API roda com varias replicas atras do Nginx.
