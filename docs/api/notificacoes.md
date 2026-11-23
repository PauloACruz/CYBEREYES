# API de Notificações (Web Push)

Avisos de chamados no aparelho do técnico, com o app ou o console fechados. Decisão em `docs/adrs/ADR-028-notificacoes-push.md`.
Todas as rotas exigem login e valem só para as inscrições do próprio usuário.

| Rota | Uso |
|---|---|
| `GET /api/push/config` | `{ publicKey }`: chave VAPID do servidor (base64url) para o `pushManager.subscribe` |
| `PUT /api/push/subscription` | Cria ou atualiza a inscrição deste aparelho: `{ endpoint, p256dh, auth, device, newTickets, updates, messages, insights, projects }` |
| `POST /api/push/subscription/find` | `{ endpoint }` → a inscrição e as escolhas, ou 404 (não ativada aqui, ou de outro usuário) |
| `POST /api/push/subscription/delete` | `{ endpoint }` → 204; usado ao desligar e ao sair da conta |
| `POST /api/push/test` | `{ endpoint }` → `{ delivered, error }`: envia "Notificações ativas" para o aparelho |

O endereço vai no corpo (e não na URL) para não aparecer em logs. Validações: `endpoint` HTTPS de FCM, Mozilla, WNS ou Apple;
`p256dh` chave P-256 sem compressão (65 bytes); `auth` com 16 bytes.

## Avisos

| Evento | Título | Quem recebe |
|---|---|---|
| Chamado aberto | `Novo chamado #N` (ou `... atribuído a você`) | Sem responsável: todos que veem o cliente; com: o responsável |
| Mensagem | `#N · Mensagem de Fulano` / `#N · Nota interna de Fulano` | Do solicitante: responsável ou todos; de técnico: o responsável |
| Atribuição | `#N atribuído a você` | O novo responsável |
| Status / prioridade | `#N agora está resolvido` / `#N com prioridade alta` | O responsável |

O aviso leva `{ title, body, url: "/chamados/N", tag: "chamado-N" }`; a etiqueta faz o aviso novo do chamado substituir o
anterior. Quem fez a ação não recebe.

### Projetos (opção `projects`)

| Evento | Título | Quem recebe |
|---|---|---|
| Responsável pelo projeto (criação ou troca) | `Projeto sob sua responsabilidade` | O novo responsável |
| Tarefa com responsável (criação, inclusão ou troca) | `Tarefa atribuída a você` (ou `N tarefas atribuídas a você`, na criação) | O responsável pela tarefa |
| Início do ciclo agendado | `Fulano começa hoje` / `Ciclo N de Fulano começa hoje` (ou `começou`) | O responsável pelo projeto e quem tem tarefa nele |

O aviso abre `/projetos/N` (no celular, a tela do projeto no app). Recebe só quem ainda enxerga o projeto (permissão de projetos e
todos os clientes dele no escopo); quem fez a ação não recebe. O lembrete do início sai uma vez por ciclo: o serviço confere a
cada 10 minutos os projetos ativos cujo ciclo já começou (no fuso do console) e ainda não venceu, e reserva o ciclo no banco
(`projects.StartNotifiedCycle`) antes de avisar, para não repetir com várias réplicas da API. O projeto criado já em andamento não
gera lembrete, porque as atribuições já avisaram; mover o início para o futuro faz o lembrete valer de novo.
