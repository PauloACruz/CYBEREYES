# Contrato de API - Fase 3 (monitoramento e automacao)

Mesmo padrao das fases anteriores (cookie com 2FA, camelCase, ProblemDetails com `code`, auditoria em toda escrita).

## Permissoes novas
| Chave | Uso |
|---|---|
| `checks.manage` | Criar, editar e excluir checks e tarefas (em agentes e politicas) |
| `policies.manage` | Criar, editar, excluir e atribuir politicas |
| `alerts.view` | Ver alertas |
| `alerts.manage` | Resolver, silenciar alertas e editar templates de alerta |
| `patches.manage` | Aprovar atualizacoes e editar politicas de patch, instalar agora |
| `software.manage` | Instalar software pelo Chocolatey |
| `settings.manage` (existente) | E-mail (SMTP), webhook padrao e configuracoes globais |

Leitura de checks, tarefas, politicas, patches e software usa `agents.view`.

## 1. Checks

Tipos: `diskspace`, `cpuload`, `memory`, `ping`, `script`, `winsvc` (Windows), `eventlog` (Windows).
Um check pertence a um agente (`agentId`) **ou** a uma politica (`policyId`).

`CheckDto`:
```
{ id, agentId, policyId, checkType, name, runInterval (s, 0 = intervalo do agente), failsBeforeAlert, alertSeverity ("info"|"warning"|"error"),
  warningThreshold, errorThreshold, disk, ip, scriptId, scriptArgs[], envVars[], timeout,
  infoReturnCodes[], warningReturnCodes[], successReturnCodes[],
  svcName, passIfStartPending, passIfSvcNotExist, restartIfStopped,
  logName, eventId, eventIdIsWildcard, eventType, eventSource, eventMessage, failWhen ("contains"|"not_contains"), searchLastDays, numberOfEventsBeforeAlert,
  emailAlert, webhookAlert, dashboardAlert }
```

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/agents/{id}/checks` | `agents.view` -> `AgentCheckDto[]` (checks proprios e herdados de politicas, com resultado) |
| POST | `/api/checks` | `checks.manage` -> `SaveCheck` (com `agentId` ou `policyId`) |
| PUT | `/api/checks/{id}` | `checks.manage` |
| DELETE | `/api/checks/{id}` | `checks.manage` |
| GET | `/api/checks/{id}/history?agentId=&hours=24` | `agents.view` -> `[{ time, value, status, results }]` |
| POST | `/api/agents/{id}/checks/run` | `agents.run` -> 202 (pede ao agente para executar todos os checks agora) |

`AgentCheckDto` = `{ check: CheckDto, inherited: boolean, policyName: string | null, result: { status ("passing"|"failing"|"pending"), alertSeverity, moreInfo, lastRun, failCount, stdout, stderr, retcode, executionTime, history: number[] } | null }`

`POST /api/checks` responde 201 com o `CheckDto` criado; `PUT` responde o `CheckDto`.

Avaliacao (mesmas regras do Tactical):
- `cpuload` e `memory`: media das ultimas 15 leituras; acima de `errorThreshold` falha com erro, acima de `warningThreshold` falha com aviso (0 desliga o limite).
- `diskspace`: espaco livre = 100 menos o percentual usado; abaixo de `errorThreshold` erro, abaixo de `warningThreshold` aviso; disco inexistente falha com erro.
- `script`: codigo em `infoReturnCodes` falha como info, em `warningReturnCodes` como aviso; diferente de 0 e fora de `successReturnCodes` falha como erro; senao passa.
- `ping` e `winsvc`: status informado pelo agente.
- `eventlog`: `contains` falha quando ha `numberOfEventsBeforeAlert` ou mais eventos; `not_contains` falha quando ha menos.
- O alerta so dispara apos `failsBeforeAlert` falhas seguidas; um resultado bom resolve o alerta.

## 2. Tarefas automatizadas

`TaskDto`:
```
{ id, agentId, policyId, name, enabled, continueOnError, alertSeverity, actions: [ { type: "cmd", command, shell, timeout } | { type: "script", scriptId, args[], envVars[], timeout, runAsUser } ],
  scheduleType: "manual" | "once" | "daily" | "weekly" | "monthly" | "check_failure", runAt (ISO, para "once"), time ("HH:mm", no fuso de `settings.timeZone`, padrao America/Sao_Paulo),
  daysOfWeek: number[] (0 = domingo), dayOfMonth, everyDays, assignedCheckId, emailAlert, webhookAlert, dashboardAlert }
```

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/agents/{id}/tasks` | `agents.view` -> `AgentTaskDto[]` (proprias e herdadas, com ultimo resultado) |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/tasks` | `checks.manage` |
| POST | `/api/agents/{id}/tasks/{taskId}/run` | `agents.run` -> 202 |

`AgentTaskDto` = `{ task: TaskDto, inherited, policyName, result: { status, retcode, stdout, stderr, executionTime, lastRun } | null, nextRun }`

O agendamento roda no servidor para todos os sistemas (o servidor envia `runtask` pelo NATS no horario). `check_failure` executa quando o check associado falha.

## 3. Politicas

`PolicyDto`: `{ id, name, description, enabled, checkCount, taskCount, appliedTo: { clients, sites, agents } }`

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/policies` | `agents.view` |
| GET | `/api/policies/{id}` | `agents.view` -> politica com `checks: CheckDto[]`, `tasks: TaskDto[]`, `patchPolicy` |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/policies` | `policies.manage` |
| PUT | `/api/policies/assignments` | `policies.manage` -> `{ target: "global"|"client"|"site"|"agent", targetId, monitoringType: "server"|"workstation"|null, policyId: number|null }` |
| GET | `/api/policies/assignments` | `agents.view` -> `{ globalServer, globalWorkstation, clients: [{ id, name, serverPolicyId, workstationPolicyId, blockPolicyInheritance }], sites: [{ id, clientId, name, serverPolicyId, workstationPolicyId, blockPolicyInheritance }], agents: [{ id, hostname, policyId, blockPolicyInheritance }] }` |
| GET | `/api/agents/{id}/policies` | `agents.view` -> `[{ policyId, name, source: "agente"|"site"|"cliente"|"global" }]` |
| PUT | `/api/policies/block-inheritance` | `policies.manage` -> `{ target: "client"|"site"|"agent", targetId, block }` |

Politicas efetivas de um agente, da mais especifica para a mais geral: a do agente; a do site (conforme o tipo, servidor ou estacao); a do cliente; a global. Os checks e tarefas de todas elas valem juntos. `blockInheritance` no agente, site ou cliente interrompe a heranca dos niveis acima.

## 4. Alertas

`AlertDto`: `{ id, agentId, hostname, clientName, siteName, alertType: "availability"|"check"|"task", checkId, taskId, severity, message, createdAt, resolved, resolvedAt, snoozedUntil, emailSent, webhookSent }`

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/alerts?status=active|resolved|all&severity=&clientId=&page=` | `alerts.view` -> `Paged<AlertDto>` |
| POST | `/api/alerts/{id}/resolve` | `alerts.manage` |
| POST | `/api/alerts/{id}/snooze` `{ until }` | `alerts.manage` |
| POST | `/api/alerts/bulk` `{ ids, action: "resolve"|"snooze", until? }` | `alerts.manage` |

Evento SignalR `alertsChanged` `{ activeCount }` quando um alerta e criado ou resolvido.

### Templates de alerta (`alerts.manage`)
`AlertTemplateDto`: `{ id, name, emailRecipients[], webhookUrl, emailSeverities[], webhookSeverities[], dashboardSeverities[], notifyOnResolved, agentOverdueEmail, agentOverdueWebhook, agentOverdueDashboard }`
CRUD em `/api/alert-templates`. Atribuicao: `PUT /api/alert-templates/assignments` `{ target: "global"|"client"|"site"|"agent", targetId, templateId|null }`. Vale o mais especifico (agente, site, cliente, global).

Webhook: `POST` JSON `{ event: "alert.created"|"alert.resolved", alert: AlertDto, url: "<link do agente no console>" }`.

## 5. Windows Update

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/agents/{id}/updates` | `agents.view` -> `[{ id, guid, kb, title, severity, categories[], installed, downloaded, action: "approve"|"ignore"|"nothing", result, dateInstalled, moreInfoUrls[] }]` |
| PUT | `/api/agents/{id}/updates/{updateId}` `{ action }` | `patches.manage` |
| POST | `/api/agents/{id}/updates/scan` | `agents.view` -> 202 |
| POST | `/api/agents/{id}/updates/install` | `patches.manage` -> 202 (instala as aprovadas agora) |

Politica de patch (por politica ou agente): `{ critical, important, moderate, low, other: "approve"|"ignore"|"manual", runTimeDays: number[], runTimeHour, rebootAfterInstall: "never"|"required"|"always" }` em `GET/PUT /api/policies/{id}/patch-policy` e `GET/PUT /api/agents/{id}/patch-policy`.

## 6. Software

| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/agents/{id}/software` | `agents.view` -> `{ updatedAt, items: [{ name, version, publisher, installDate, size, source, location, uninstall }] }` |
| POST | `/api/agents/{id}/software/refresh` | `agents.view` -> lista ao vivo e atualiza o inventario |
| POST | `/api/agents/{id}/software/install` `{ package }` | `software.manage` (Windows, Chocolatey) -> 202 com `{ pendingActionId }` |
| GET | `/api/agents/{id}/pending-actions` | `agents.view` -> `[{ id, type, details, status, createdAt }]` |

## 7. Configuracoes globais (`settings.manage`)
`GET/PUT /api/settings` -> `{ smtpHost, smtpPort, smtpUsername, smtpPasswordSet, smtpFrom, smtpUseTls, defaultWebhookUrl, timeZone, checkHistoryDays, agentHistoryDays }` (senha so e enviada na escrita, campo `smtpPassword`).
`POST /api/settings/test-email` `{ to }` e `POST /api/settings/test-webhook` `{ url }`.

## 8. Detalhes de resposta
- `GET /api/agents/{id}/patch-policy` -> `{ own: PatchPolicy | null, effective: PatchPolicy }`.
- `GET /api/alert-templates/assignments` -> `{ global, clients: [{ id, name, alertTemplateId }], sites: [{ id, clientId, name, alertTemplateId }], agents: [{ id, hostname, alertTemplateId }] }`.
- `GET /api/agents/{id}/pending-actions` -> `[{ id, type, details (JSON), status, output, createdAt }]`.
- Testes de e-mail e webhook respondem `{ success, message }`.
- Tipos de evento do check `eventlog`: `INFO`, `WARNING`, `ERROR`, `AUDIT_SUCCESS`, `AUDIT_FAILURE`.
