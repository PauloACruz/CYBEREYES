# ADR-014: Decisoes tecnicas da fase 5 (chamados, incidentes e app de bandeja)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Chamados no mesmo banco e no mesmo monolito** (pasta `Tickets/` na API e `WinCare.Core/Tickets`), com filas, prioridade, status, SLA por prioridade (24x7), mensagens publicas e notas internas, anexos e apontamento de horas.
2. **Incidentes a partir de alertas** no mesmo ponto em que o alerta nasce (`AlertService`): um incidente aberto por alerta, reaproveitado quando o mesmo check volta a falhar; quando o alerta se resolve, o incidente recebe aviso e, se ninguem assumiu, e resolvido. Regras configuraveis (severidades, prioridade, fila, resolver junto).
3. **Identidade do usuario final pelo agente, nao pelo app**: o app de bandeja roda na sessao do usuario e nunca ve o token do agente. Ele pede ao agente, por canal local (named pipe no Windows, socket Unix no Linux e macOS), um token curto; o agente identifica o usuario pelo processo do outro lado (token do processo cliente no Windows, UID do par no Unix) e pede o token ao servidor com a propria credencial. Contas de servico (SYSTEM, LOCAL SERVICE, NETWORK SERVICE) sao recusadas.
4. **Token do app**: 32 bytes aleatorios, guardado como SHA-256, 12 horas, vinculado a agente e usuario, valido somente nas rotas `/api/tray` e no hub `/hubs/tray`. O console continua exigindo cookie com 2FA; um token do app recebe 403 no console.
5. **Chat liberado apos atribuicao** (409 `CHAT_LOCKED` antes disso) e notas internas nunca enviadas ao app, nem por REST nem por SignalR.
6. **Anexos no PostgreSQL** (tabela separada com `bytea`, ate 10 MB), entrando no backup diario. O tipo e identificado pela assinatura do arquivo; so imagens PNG, JPEG, GIF e WEBP sao servidas com o proprio tipo, todo o resto sai como `application/octet-stream`.
7. **Tempo real**: console no hub existente (`ticketsChanged` para todos e `ticketMessage` para quem abriu o chamado); app no hub `/hubs/tray`, por grupo de agente e usuario.

## Validacao
- Testes de integracao: abertura pelo app com captura, chat bloqueado ate a atribuicao, notas internas ocultas, isolamento entre usuarios da mesma maquina, mensagem em tempo real no hub do app, incidente aberto por alerta e resolvido com o alerta.
- Ponta a ponta: check de disco falhando no agente Go real gerou alerta e incidente; o incidente foi assumido e respondido no console pelo navegador; ao normalizar o disco, o alerta se resolveu e o incidente recebeu o aviso. O canal local foi testado no Linux com um usuario comum (`maria`): o agente identificou o usuario pelo kernel e o token obtido acessou somente as rotas do app.

- App de bandeja (`rmmagentwincare/tray`) executado como `maria` sob Xvfb contra o ambiente real: token pelo canal local, abertura de chamado com captura (janela escondida durante a captura), resposta do tecnico recebida em tempo real com notificacao do sistema, chat liberado apos a atribuicao e resposta da usuaria gravada no servidor. Renovacao forcada do token (refresh) verificada no agente.

## Limites conhecidos
- App de bandeja: Wails v3.0.0-beta.26 exige Go 1.25 e, no Linux com GTK3, a tag de compilacao `gtk3`. O icone e o menu da bandeja nao foram testados no Linux (o Xvfb nao tem area de notificacao); no Windows o app so foi compilado, sem execucao; no macOS nao foi compilado (precisa do SDK da Apple).
- A instalacao do app junto com o agente (inicio automatico por sessao) tem arquivos de exemplo em `tray/packaging`, mas o instalador oficial fica para a fase 7.
- SLA 24x7, sem calendario de expediente e sem pausa em "Aguardando usuario".
- O token do app trafega na query `access_token` ao abrir o WebSocket do hub (limitacao do WebSocket no navegador); pode aparecer em logs de acesso do proxy. Por isso e curto e restrito.
- Chamados abertos pelo console nao aparecem no app do usuario (sem `requesterUsername`).
- O canal local no Windows e no macOS compila, mas foi testado de verdade somente no Linux.
