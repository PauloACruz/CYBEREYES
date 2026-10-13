# Contrato - Fase 14 (aplicacoes web e servidores SSH)

Modulo "Aplicacoes" do console (`/aplicacoes`): sites e aplicacoes web monitorados, agrupados pelo servidor (VPS) onde rodam, com terminal SSH no navegador, comandos salvos, deploy e credenciais. Decisoes em `docs/adrs/ADR-024-aplicacoes-web.md`.

## 1. Visao geral

```mermaid
flowchart LR
    Console -->|REST /api/webapps| API
    Console <-->|SignalR /hubs/console: terminal, saida ao vivo, eventos| API
    API -->|HTTP(S) / TCP a cada intervalo| App[Aplicacao ou site]
    API -->|SSH: exec e shell com PTY| VPS[Servidor]
    API -->|alerta| Alertas[Alertas, e-mail, webhook, incidente]
```

- Um **servidor** (`app_servers`) tem endereco, porta, usuario e a credencial SSH (senha ou chave privada com senha opcional), cifrada no cofre (AES-256-GCM, `VAULT_KEY`).
- Uma **aplicacao** (`web_apps`) pertence a um cliente e, opcionalmente, a um servidor. Sem servidor (hospedagem externa) so o monitoramento funciona.
- A API conecta direto aos servidores: a VPS do Cybereyes precisa alcancar a porta SSH deles (libere o IP dela no firewall dos servidores).

## 2. Permissoes

| Permissao | Uso |
|---|---|
| `apps.view` | Ver servidores, aplicacoes, disponibilidade, historico e saida de execucoes; "Verificar agora" |
| `apps.manage` | Cadastrar e alterar servidores (inclusive credencial SSH), aplicacoes, deploy e comandos salvos; liberar a chave do servidor |
| `apps.run` | Abrir terminal SSH, rodar comandos e deploy, cancelar execucoes, testar a conexao de um servidor salvo |
| `credentials.reveal` | Revelar a credencial SSH do servidor (com `apps.view`) e as credenciais do cofre |
| `docs.view` / `credentials.manage` | Aba Credenciais da aplicacao e do servidor (o cofre da Documentacao) |

Papel "Tecnico" criado em instalacoes novas recebe `apps.view` e `apps.run`. O escopo de clientes por usuario vale para tudo (servidores, aplicacoes, verificacoes, comandos, execucoes e alertas).

## 3. Servidores

| Metodo | Rota | Corpo / resposta |
|---|---|---|
| GET | `/api/webapps/overview?clientId=&search=` | `{ servers: ServerDto[], apps: WebAppDto[] }` (a busca cobre nome, URL, servidor e IP) |
| GET | `/api/webapps/servers/{id}` | `ServerDto` |
| POST / PUT | `/api/webapps/servers[/{id}]` | `SaveAppServerRequest` -> `ServerDto` |
| DELETE | `/api/webapps/servers/{id}` | 204; comandos e execucoes saem juntos, as aplicacoes ficam sem servidor |
| POST | `/api/webapps/servers/test` | formulario (+ `id` na edicao, para usar os segredos salvos) -> `TestResult` |
| POST | `/api/webapps/servers/{id}/test` | `TestResult` com a configuracao salva |
| POST | `/api/webapps/servers/{id}/reset-host-key` | 204; a proxima conexao fixa a chave nova |
| POST | `/api/webapps/servers/{id}/reveal` | `{ password, privateKey, passphrase }`; auditoria `app-server.secret-reveal` |

`SaveAppServerRequest`: `clientId`, `name`, `host` (IP ou nome, sem protocolo), `port` (padrao 22), `username`, `authMethod` (`password` ou `key`), `password?`, `privateKey?` (OpenSSH, PEM ou PuTTY; validada ao salvar), `passphrase?`, `provider?`, `notes?`, `hostKeyFingerprint?` (so na criacao: a chave vista no teste).
- Segredo vazio na edicao mantem o salvo. Trocar o metodo apaga os segredos do metodo anterior.
- Trocar host ou porta libera a chave fixada.
- `ServerDto` nunca traz segredo: `hasPassword`, `hasPrivateKey`, `hasPassphrase`, `hostKeyFingerprint`, `hostKeyAlgorithm`, `lastConnectedAt`.

`TestResult`: `{ ok, error, code, fingerprint, algorithm, system, pinned }`. Roda `uname -srm`, o `PRETTY_NAME` do `/etc/os-release`, `uptime` e `docker --version`. Falhas voltam com `ok: false` e codigo: `SSH_AUTH_FAILED`, `SSH_UNREACHABLE`, `HOST_KEY_MISMATCH` (com a chave apresentada em `fingerprint`), `SSH_NO_SECRET`, `VAULT_KEY_MISMATCH`, `SSH_ERROR`.

**Chave do servidor (TOFU)**: a primeira conexao fixa o SHA256 da chave do servidor (formato do `ssh`). Depois disso uma chave diferente e recusada em toda conexao (teste, comando, deploy, terminal) ate alguem com `apps.manage` liberar em `reset-host-key` (auditoria `app-server.host-key-reset`).

## 4. Aplicacoes e monitoramento

| Metodo | Rota | Corpo / resposta |
|---|---|---|
| GET | `/api/webapps/{id}` | `WebAppDetail` (inclui a configuracao de deploy e `lastDeploy`) |
| POST / PUT | `/api/webapps[/{id}]` | `SaveWebAppRequest` -> `WebAppDetail` |
| DELETE | `/api/webapps/{id}` | 204; verificacoes, comandos e alertas saem juntos; credenciais ligadas ficam no cofre sem o vinculo |
| POST | `/api/webapps/{id}/check` | verifica agora: `{ up, latencyMs, statusCode, error, certificateExpiresAt }` |
| GET | `/api/webapps/{id}/checks?hours=24` | `{ hours, points[], uptime: { h24, d7, d30 }, outages[] }` |

`SaveWebAppRequest` (campos numericos opcionais assumem o padrao): `clientId`, `serverId?` (mesmo cliente), `name`, `environment?`, `stack?`, `url?`, `notes?`, `monitorEnabled`, `checkType` (`http` ou `tcp`), `checkTarget?` (em branco usa `url`; `host:porta` no tcp), `method` (`GET`/`HEAD`), `expectedStatus` (padrao `200-399`; faixas e listas), `keyword?` (texto que a pagina precisa conter), `intervalSeconds` (30 a 86400, padrao 60), `timeoutSeconds` (1 a 60, menor que o intervalo), `failuresBeforeAlert` (1 a 20, padrao 2), `alertSeverity`, `ignoreTlsErrors`, `sslWarnDays` (0 desliga, padrao 14), `deployPath?` (`/abs` ou `~/...`), `repoUrl?`, `branch?`, `deployScript?` (ate 32 KB, exige servidor), `deployTimeoutMinutes` (1 a 240, padrao 30).

**Monitor** (`WebAppMonitor`, servico em segundo plano em todas as replicas):
- A cada 5 s pega as aplicacoes vencidas. Cada verificacao e reservada por `UPDATE ... WHERE NextCheckAt = <valor lido>`: so a replica que mudou o valor verifica.
- HTTP(S): conexao nova a cada verificacao (detecta DNS e TLS e le o vencimento do certificado), ate 5 redirecionamentos, User-Agent `Cybereyes-Monitor/1.0`, corpo lido so com `keyword` (ate 1 MB). TCP: so a conexao.
- Falha: a proxima verificacao vem em ate 20 s para confirmar. Com `failuresBeforeAlert` falhas seguidas a aplicacao fica `down` e abre o alerta `webapp_down`; a primeira resposta boa volta para `up` e resolve.
- Certificado a `sslWarnDays` dias ou menos do vencimento: alerta `webapp_ssl` (aviso; erro se ja venceu).
- Estados: `pending` (sem verificacoes suficientes), `up`, `down`, `paused` (monitoramento desligado; fecha os alertas abertos).
- Verificacoes (`web_app_checks`) ficam 30 dias. `points` agrupa em ate ~300 baldes com latencia media e falhas; `outages` sao os ultimos 20 alertas `webapp_down`.
- Evento do hub `webAppChanged { id, status, previous }` para os clientes que veem a aplicacao, na mudanca de estado e ao salvar.

**Alertas**: `alerts.web_app_id` liga o alerta a aplicacao. Template: o do cliente da aplicacao ou o padrao (e-mail, webhook, painel). O chamado de incidente automatico funciona como nos outros alertas e herda o cliente da aplicacao. O link do e-mail/webhook aponta para `/aplicacoes/{id}`. A lista de alertas traz `webAppId` e `webAppName`.

## 5. Comandos, deploy e execucoes

| Metodo | Rota | Corpo / resposta |
|---|---|---|
| GET | `/api/webapps/commands?serverId=` ou `?webAppId=` | comandos salvos (na aplicacao: os dela e os do servidor dela) |
| POST / PUT / DELETE | `/api/webapps/commands[/{id}]` | `{ serverId? , webAppId?, name, script, description?, confirm, timeoutMinutes?, sortOrder? }` (exatamente um dono) |
| POST | `/api/webapps/servers/{id}/run` | `{ script? , commandId?, webAppId?, timeoutMinutes? }` -> 202 `{ id, status }` |
| POST | `/api/webapps/{id}/deploy` | 202 `{ id, status }`; 409 se ja houver deploy da aplicacao em andamento |
| GET | `/api/webapps/runs?serverId=&webAppId=&kind=&page=&pageSize=` | historico paginado (sem saida) |
| GET | `/api/webapps/runs/{id}` | execucao com `output`, `outputTruncated`, `cancelRequested` |
| POST | `/api/webapps/runs/{id}/cancel` | 202; 409 se ja terminou |

**Como o script roda**: o texto vai em base64 para `bash -lc "$(printf '%s' '<base64>' | base64 -d)" cybereyes </dev/null 2>&1`, entao aspas, `$` e quebras de linha chegam intactos e nenhum comando fica esperando teclado. No contexto da aplicacao o script comeca com `export CYBEREYES_APP`, `CYBEREYES_APP_URL`, `DEPLOY_PATH`, `DEPLOY_REPO`, `DEPLOY_BRANCH` e `cd` para a pasta dela (`exit 97` se a pasta nao existir). O deploy roda com `set -e`. Exige `bash` e `base64` no servidor.

**Execucao em segundo plano** (`AppRunner`): a API grava a execucao (`app_runs`, status `running`), responde 202 e roda fora da requisicao. A saida (stdout e stderr juntos, ate 2 milhoes de caracteres) vai ao vivo ao grupo SignalR da execucao e e gravada a cada 2 s; no mesmo passo a API le `cancel_requested`, entao cancelar funciona de qualquer replica. Status final: `success` (codigo 0), `failed`, `cancelled`, `timeout`. Execucao parada ha mais de 3 minutos (replica que caiu) vira `failed`. Auditoria: `app-server.command`, `webapp.deploy`, `app-run.cancel`.

Hub (`/hubs/console`):
- `JoinAppRun(runId)` / `LeaveAppRun(runId)` (com `apps.view`).
- `appRunOutput(runId, offset, text)`: `offset` e a posicao do trecho na saida completa; o console junta com o que leu em `GET /runs/{id}` sem duplicar e, se houver buraco, busca de novo.
- `appRunFinished(runId, status, exitCode, error)` e `appRunsChanged { runId, serverId, webAppId, status }` (inicio e fim, para os clientes que veem o servidor).

## 6. Terminal SSH

- `StartSshTerminal(serverId, webAppId?, cols, rows)` no hub (com `apps.run`) devolve o id da sessao. A API abre um shell com PTY `xterm-256color` e keep-alive de 30 s; com a aplicacao, digita `cd` para a pasta dela logo depois da primeira saida do shell.
- Entrada, tamanho e encerramento usam os mesmos metodos do terminal do agente (`TerminalInput`, `ResizeTerminal`, `StopTerminal`); a saida chega em `terminalOutput(sessionId, base64)` e o fim em `terminalClosed(sessionId, code, motivo)`.
- A sessao vive na replica da conexao WebSocket do navegador e termina quando ela cai. Limite de 8 terminais SSH por conexao. Auditoria `app-server.terminal-opened`.

## 7. Credenciais da aplicacao

O cofre da Documentacao (`/api/credentials`) ganhou `webAppId` e `appServerId` (opcionais, do mesmo cliente) no corpo, nos filtros da lista e na resposta (`webAppName`, `appServerName`). As abas Credenciais da aplicacao e do servidor usam essa lista; o formulario aceita segredo de varias linhas (`.env`, certificado, token longo).
