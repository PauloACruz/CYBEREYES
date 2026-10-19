# API do Assistente de IA (Claude)

O assistente usa a API da Anthropic (SDK oficial `Anthropic`, modelo padrão `claude-opus-5-5`) em duas frentes: o primeiro
atendimento dos chamados abertos pelo app EYES e a análise periódica dos erros dos logs das máquinas. A chave da API fica em
`core_settings.AnthropicKeyProtected`, cifrada pelo Data Protection (purpose `WinCare.Settings.Anthropic`), e nunca volta nas respostas.

## Configuração (`settings.manage`)

| Rota | Uso |
|---|---|
| `GET /api/assistant/settings` | `{ keySet, keyHint, model, name, agentId, chatEffort, logEffort, efforts, chatEnabled, logInsightsEnabled, logInsightsIntervalHours, logInsightsMinLevel, logInsightsPush, logInsightsEmail, logInsightsLastRunAt, smtpConfigured, models }` |
| `PUT /api/assistant/settings` | Mesmos campos mais `apiKey`: `null` mantém a chave gravada, `""` apaga, `sk-ant-...` troca. Ligar o chat ou a análise sem chave dá 400 |
| `POST /api/assistant/test` | `{ apiKey?, model?, agentId? }` → confere a chave digitada (ou a gravada) pela API de modelos, sem gastar tokens; com `model: "agent"`, o modelo do agente |
| `GET /api/assistant/agents` | Agentes não arquivados da conta da chave gravada (`{ id, name, description, model, version }`) |
| `POST /api/assistant/agents` | `{ name?, model? }` → cria na conta um agente com as instruções iniciais do Cybereyes (201) |

### Agente vinculado, modelo e esforço

`agentId` aponta para um agente da conta da Anthropic (Console, Managed Agents). O prompt de sistema dele entra no do assistente,
num bloco `<instrucoes_do_agente>`, antes das regras do Cybereyes, que prevalecem em formato, ações e FAQ; vale no chat e na análise
de logs. `model` é um dos modelos da lista ou `"agent"` para usar o do agente (exige `agentId`). O agente é lido de novo a cada
5 minutos ou quando a configuração é salva; se a Anthropic não responder ou o agente sumir, o assistente segue com as instruções e o
modelo padrão. O assistente não abre sessões de Managed Agents: só usa a configuração do agente nas chamadas da Messages API.
`chatEffort` (padrão `low`) e `logEffort` (padrão `medium`) vão em `output_config.effort`: `low`, `medium`, `high`, `xhigh` ou `max`.

## FAQ (`docs.view` / `docs.manage`)

| Rota | Uso |
|---|---|
| `GET /api/faq?clientId=&search=&tag=` | Entradas visíveis; com `clientId`, as globais e as do cliente |
| `POST /api/faq`, `PUT /api/faq/{id}` | `{ clientId, question, answer, tags, enabled }`; tags em minúsculas, sem repetição |
| `DELETE /api/faq/{id}` | 204 |

Entradas com a tag `orientar` são as únicas cujo passo a passo vai ao usuário; o texto da resposta é enviado exatamente como
cadastrado (o modelo escreve só a introdução). As demais servem de referência para a equipe e aparecem na nota interna.

## Atendimento no chat do app EYES

Com `chatEnabled`, todo chamado aberto pela bandeja (`POST /api/tray/tickets`) começa com o assistente (`tickets.AssistantState = active`)
e o chat fica liberado desde a abertura (`chatEnabled` no app). Sem descrição, o assistente pede os detalhes na hora, sem chamar o
modelo. A cada mensagem do solicitante o modelo escolhe uma ação:

| Ação | Efeito |
|---|---|
| `ask_details` | Pergunta o que falta |
| `guide` | Envia a introdução + o passo a passo da entrada `orientar`, nota interna citando o FAQ e status `waiting_user` |
| `handoff` | Avisa que encaminhou, nota interna com o resumo e a prioridade sugerida, `AssistantState = handoff` |
| `resolved` | Agradece, nota interna, grava a solução (`resolutionKind = solution`, citando o FAQ usado) e status `resolved` |

O assistente para quando um técnico assume o chamado ou responde ao usuário, depois de 6 respostas e quando a API falha (encaminha).
Atende no máximo 10 chamados por máquina por hora. As mensagens dele têm `authorType = "assistant"` e não contam como primeira
resposta do SLA. `GET /api/tray/me` traz `assistantEnabled` e `assistantName` para o app abrir o chamado conversando.

## Análise dos logs (`logs.view`, só para quem vê todos os clientes)

| Rota | Uso |
|---|---|
| `GET /api/assistant/insights` | `{ configured, enabled, intervalHours, running, reports[] }` (30 mais recentes) |
| `GET /api/assistant/insights/{id}` | Relatório com `items[]` (grupo, contagens, máquinas, título, severidade, descrição oficial, fonte, causa, resolução, ações na plataforma) e `suggestions[]` |
| `POST /api/assistant/insights/run` | `settings.manage`: pede uma análise agora (202; 409 se já houver uma rodando) |

A cada `logInsightsIntervalHours` (1 a 168), o servidor agrupa no banco os eventos de `system_logs` a partir do nível mínimo
(mesmo nível, origem, ID e mensagem com números e GUIDs trocados por marcadores) e mede a recorrência: ocorrências no período,
no período anterior do mesmo tamanho, máquinas afetadas e dias com o erro nos últimos 7. Os 20 grupos maiores vão ao modelo
com o que já está configurado na plataforma (regras de alerta de log, checks, tarefas, scripts, FAQ, autoatendimento). O relatório
fica em `log_insight_reports`; quem vê todos os clientes recebe push (`Insights` na inscrição) e, se ligado, e-mail. Com várias
réplicas, só a que grava `LogInsightsLastRunAt` primeiro roda a análise periódica.
