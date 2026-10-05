# Fase 12.2: fundacao ponta a ponta

Referencias: RFC-001, ADR-022, `docs/remoto/contrato-remoto.md` (normativo).

## O que foi entregue

### API (C#)

- Tabelas `remote_sessions`, `remote_transfers` e `remote_policies` (migracao `Fase12AcessoRemoto`). A migracao concede `agents.files` aos perfis que ja tinham `agents.remote`; o perfil tecnico do seed tambem recebe a permissao.
- `POST /api/agents/{id}/remote/sessions`: confere permissao, agente online, versao minima do EYES (`Remote:MinimumAgentVersion`, 3.1.0), limites por agente, por usuario e por minuto, politica efetiva (global, cliente e site) e pede `remote_start` ao EYES pelo NATS. Responde com o token de uso unico do visualizador (60 s, so o SHA-256 fica guardado).
- `GET /api/remote/sessions`, `GET` e `DELETE /api/remote/sessions/{sessionId}`.
- Politicas: `GET /api/remote/policies`, `PUT /api/remote/policies/{scope}/{scopeId}` e `DELETE` (permissao `settings.manage`). A tela de configuracao fica para a 12.7.
- Relay WebSocket em `/api/remote/relay/{sessionId}/{desktop|files}`: AUTH, emparelhamento, repasse de quadros, limite de 200 eventos de entrada por segundo, observacao de consentimento e BYE, fechamento com os codigos da secao 4.3 do contrato.
- Replica dona da sessao: o diretorio no Redis guarda qual replica atende cada sessao, e as outras encaminham o WebSocket e as chamadas HTTP com o esquema interno `RemoteForward` (cabecalho de salto e principal). A prova S3 mostrou que o `hash` do Nginx nao serve com `resolve`.
- Coletor de sessoes: tempo de conexao, inatividade, duracao maxima, permissao retirada e sessoes orfas depois de reinicio.
- Auditoria de inicio e fim de sessao.

### Nginx

- `location /api/remote/` com WebSocket, sem buffer, corpo de ate 2 MB e tempo de 330 s.
- Os cabecalhos internos `X-Remote-Forward` e `X-Remote-Principal` vindos de fora sao apagados.

### EYES 3.1.0 (Go)

- `remote_start` e `remote_stop` com no maximo 2 sessoes no agente.
- O EYES so conecta ao relay pelo endereco da API que ja tem configurado (usa apenas o caminho do `relay_url`).
- `eyes remote-helper`: processo na sessao grafica do usuario que captura a tela (X11 por `jezek/xgb`), codifica blocos JPEG com diferenca entre quadros, controla o fluxo pelo ACK, ajusta a qualidade e aplica teclado e mouse pelo XTEST.
- Windows e macOS respondem "nao suportado" ate as fases 12.3 e 12.6. Sessoes so Wayland tambem (D-06).
- Consentimento: `none` e `notify` funcionam (o aviso vai para o log ate a 12.3); `ask` recusa ate o `eyes-tray` ganhar o pedido na 12.3.

### Console (React)

- Janela propria `/acesso-remoto/:agentId` (fora do layout do console), aberta pelo menu "Acesso remoto" do agente, do ativo e do chamado ("Tela" e "Somente visualizar").
- Canvas com os blocos JPEG, ACK depois do desenho, teclado e mouse, roda, soltar teclas ao perder o foco, varios monitores, qualidade (alta, media, baixa), tela cheia com Keyboard Lock e Ctrl+Alt+Del quando o agente anuncia.
- Mensagens para cada erro de criacao e para cada codigo de fechamento do relay.

### CI

- O job `backend` instala Xvfb e xdotool e exporta `DISPLAY=:99`; com isso o `RemoteE2ETests` roda no CI.

## Testes

| Teste | O que confere |
|---|---|
| `RemoteTests` (5) | emparelhamento e repasse de quadros com pontas simuladas e fim quando o visualizador sai; token errado, papel errado e reuso recusados; erros de criacao conforme o contrato; heranca de politicas ate o pedido ao agente; cabecalho de encaminhamento sem chave valida recusado |
| `RemoteE2ETests` | EYES real sob Xvfb: HELLO, blocos JPEG validos, ACK, ponteiro do X11 movido para 321,234 (xdotool) e sessao terminada |
| Go `internal/remote/...` | codificacao, protocolo, captura e XTEST (no Xvfb), relay sobre a API, politica |
| vitest `features/remote` e menu | protocolo, mapa de entrada, conexao com WebSocket simulado (AUTH, fases, ACK depois do desenho, fechamento), pagina do visualizador (criacao, fases, erro de maquina desconectada), menu |

## O que ficou pendente desta fase

- Prova numa maquina Windows de teste: depende da captura e da entrada no Windows (12.3) e de maquina real (S1).
- Playwright do console: nao montado. O visualizador esta coberto pelo vitest; o fluxo com navegador real fica para quando a tela do Windows existir.
