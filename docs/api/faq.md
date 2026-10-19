# API do FAQ

O FAQ guarda os problemas conhecidos e como resolver. Ele tem uma área própria no console (`/faq`, menu **FAQ**, permissão
`docs.view`) e é alimentado e consultado por três frentes:

| Quem | Alimenta | Consome |
|---|---|---|
| Equipe (console) | Cria e publica entradas (`docs.manage`); quem só tem `docs.view` envia sugestões; botão no card da solução do chamado e em cada item da análise de logs | Área FAQ; **Inserir do FAQ** na resposta do chamado |
| Assistente de IA | Sugere uma entrada quando um técnico resolve um chamado; escreve rascunhos a pedido (**Escrever com IA**) | Passo a passo das entradas `orientar` no chat do app; referência nas notas internas e na análise de logs |
| Usuários do app EYES | Enviam perguntas sem resposta; dizem se a resposta resolveu | Aba **Ajuda** do app, com as entradas marcadas para o app |
| Agentes de IA via MCP | `create_faq` (sugestão por padrão), `update_faq` | `search_faq`, `get_faq`, `faq_used` |

## Entrada

| Campo | Uso |
|---|---|
| `question`, `answer` | O problema como o usuário descreve e o passo a passo. A resposta só é obrigatória para publicar |
| `category` | Assunto para navegar (ex.: Impressoras). Espaços repetidos são juntados e uma categoria existente com outra grafia é reaproveitada |
| `tags` | Minúsculas, sem repetição. `orientar` = o assistente envia a resposta ao usuário no chat, exatamente como está |
| `status` | `published` (vale para o assistente, os técnicos e o app) ou `proposed` (sugestão aguardando revisão) |
| `public` | Aparece na Ajuda do app EYES |
| `source` | `team`, `assistant` ou `requester` (usuário do app); `suggestedBy` diz quem sugeriu |
| `sourceTicketId` | Chamado de onde veio a solução |
| `views`, `helpfulCount`, `notHelpfulCount`, `usedCount` | Aberturas na Ajuda do app, avaliações ("isso resolveu?") e usos (enviada pelo assistente, inserida por um técnico ou `faq_used`) |
| `clientId` | Sem cliente vale para todos; com cliente, só para os chamados e as máquinas dele |

## Console (`docs.view` / `docs.manage`)

| Rota | Uso |
|---|---|
| `GET /api/faq?clientId=&search=&tag=&category=&uncategorized=&status=&public=` | Até 500 entradas. `status` filtra publicadas ou sugestões (sem ele, todas); sugestões vêm das mais novas para as mais antigas |
| `GET /api/faq/overview?clientId=` | `{ published, proposed, uncategorized, categories: [{ name, count }], allCategories, assistant }` (`assistant`: há chave da Anthropic e um agente ligado) |
| `GET /api/faq/{id}` | Entrada com as métricas |
| `POST /api/faq` | `{ clientId, question, answer?, category?, tags, enabled, status?, public?, sourceTicketId? }` → 201. Sem `docs.manage` vira sempre sugestão (`suggestedBy` = quem enviou). Auditoria `faq.create` ou `faq.suggest` |
| `PUT /api/faq/{id}` (`docs.manage`) | Mesmos campos; `status` e `public` omitidos ficam como estão. Publicar uma sugestão registra `faq.publish` |
| `DELETE /api/faq/{id}` (`docs.manage`) | 204 (`faq.delete`, ou `faq.discard` para sugestão) |
| `POST /api/faq/{id}/used` | 204; conta um uso (o console chama ao inserir a resposta num chamado) |
| `POST /api/faq/draft` (`docs.manage`) | `{ question?, context?, ticketId? }` → rascunho do assistente, sem gravar: `{ action, reason, duplicateOf, duplicateQuestion, question, answer, category, tags, guides, public, clientSpecific }`. 400 sem chave da Anthropic ou sem agente ligado, 404 chamado inexistente, 502 falha do modelo |

## Sugestões do assistente

Com a chave da Anthropic cadastrada, um agente ligado (nativo ou da Anthropic) e `faqLearn` ligado em `PUT /api/assistant/settings` (padrão), cada `POST /api/tickets/{id}/resolve`
coloca o chamado numa fila em segundo plano. O assistente lê o título, a descrição, a solução registrada e a conversa (com as notas
internas, das mais recentes para as mais antigas até 30 mil caracteres) e a lista do FAQ existente, e decide:

- `create`: grava uma sugestão (`source = assistant`, `sourceTicketId`, `suggestedBy` = nome do assistente). Texto generalizado, sem
  nomes, máquinas, IPs ou senhas; `orientar` e `public` só quando um usuário comum consegue seguir os passos sozinho; `clientSpecific`
  deixa a entrada só para o cliente do chamado.
- `skip`: caso isolado, sem passos reaproveitáveis ou já coberto por uma entrada (`duplicateOf`); nada é gravado (fica no log).

Um chamado gera no máximo uma sugestão: corrigir a solução depois não chama o modelo de novo. O esforço usado é o `logEffort`.
Sugestões não valem para o atendimento do chat até alguém publicar.

## App EYES (`Authorization: Tray <token>`)

| Rota | Uso |
|---|---|
| `GET /api/tray/me` | Inclui `faqEnabled`: há entradas publicadas, ativas e marcadas para o app, gerais ou do cliente da máquina |
| `GET /api/tray/faq?search=&category=` | `{ categories, entries: [{ id, question, category, excerpt }] }`, até 100, as mais bem avaliadas e mais abertas primeiro |
| `GET /api/tray/faq/{id}` | `{ id, question, answer, category, updatedAt }`; conta uma abertura. 404 para entrada fora do alcance da máquina |
| `POST /api/tray/faq/{id}/feedback` | `{ helpful }` → 204 |
| `POST /api/tray/faq/suggestions` | `{ question }` (3 a 300) → 201 `{ id }`. Vira sugestão sem resposta do cliente da máquina, `suggestedBy` = `usuario em MAQUINA`. Até 5 por usuário e máquina por hora (429) |

Na Ajuda, "Não" em "Isso resolveu o seu problema?" oferece abrir um chamado já preenchido com a pergunta. A aba só aparece com
`faqEnabled`; a tela nova chega às máquinas com uma versão nova do EYES.
