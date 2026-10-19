# API de Notificações (Web Push)

Avisos de chamados no aparelho do técnico, com o app ou o console fechados. Decisão em `docs/adrs/ADR-028-notificacoes-push.md`.
Todas as rotas exigem login e valem só para as inscrições do próprio usuário.

| Rota | Uso |
|---|---|
| `GET /api/push/config` | `{ publicKey }`: chave VAPID do servidor (base64url) para o `pushManager.subscribe` |
| `PUT /api/push/subscription` | Cria ou atualiza a inscrição deste aparelho: `{ endpoint, p256dh, auth, device, newTickets, updates, messages, insights }` |
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
