# ADR-028: Notificações de chamados no app do técnico e no console (Web Push)

- Status: aceito
- Data: 2026-10-14

## Contexto
- Pedido: avisar no app do técnico (PWA) e na plataforma web quando um chamado é aberto, atualizado ou recebe mensagem.
- O console já atualiza as telas abertas pelo SignalR (`ticketsChanged`, `ticketMessage`), mas nada avisa quem está com o app
  ou a aba fechados.
- O app e o console são o mesmo site e o mesmo service worker (`/sw.js`), registrado no build de produção.

## Decisão
1. **Web Push padrão (RFC 8030/8291/8292), sem biblioteca**: a cifra `aes128gcm` e o JWT VAPID usam a criptografia do .NET
   (ECDH P-256, HKDF, AES-GCM, ECDSA). O teste confere a saída com o exemplo do apêndice A da RFC 8291.
2. **Chaves VAPID geradas no primeiro uso** e gravadas em `core_settings` (a privada protegida pelo Data Protection, purpose
   `WinCare.Settings.PushVapid`). Não há variável nova no `.env`. Duas réplicas que geram juntas gravam só a primeira
   (`UPDATE ... WHERE PushPublicKey IS NULL`). Trocar as chaves invalida todas as inscrições; o app refaz a inscrição sozinho quando
   o técnico liga de novo.
3. **Inscrição por aparelho** (`push_subscriptions`), com as escolhas do aparelho: chamados novos, atualizações dos meus chamados
   e mensagens. O mesmo navegador que troca de usuário passa a inscrição para quem entrou; sair da conta apaga a inscrição.
4. **Só serviços de push conhecidos** (FCM, Mozilla, WNS, Apple, por HTTPS na porta padrão). O servidor faz POST no endereço da
   inscrição, então um endereço forjado viraria SSRF.
5. **Destinatários** (mesma regra de visibilidade do filtro de chamados do DbContext, com `tickets.view`):
   - chamado novo sem responsável: todos que veem o cliente; já com responsável: só ele;
   - mensagem do solicitante: o responsável, ou todos que veem o cliente quando não há responsável;
   - resposta ou nota de outro técnico, atribuição, status e prioridade: só o responsável;
   - quem fez a ação (usuário da requisição) nunca é avisado.
6. **Envio fora da requisição**: o `TicketService` só enfileira (`PushOutbox`); o `PushDispatcher` monta o texto, escolhe os
   aparelhos e envia. Inscrição recusada com 404/410 sai do banco.
7. **O toque abre `/chamados/{id}`**: no celular o console leva à mesma tela do app (ADR-025); a janela do acesso remoto nunca é
   reaproveitada.

## Consequências
- No iPhone o Web Push só funciona com o app instalado na tela de início (iOS 16.4+); a tela explica isso.
- O texto do aviso (título do chamado e trecho da mensagem) aparece na tela bloqueada do aparelho.
- Sem service worker (ambiente de desenvolvimento) a opção aparece desativada com o motivo.
