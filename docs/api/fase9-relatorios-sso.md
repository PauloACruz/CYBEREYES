# Contrato - Fase 9 (relatorios, SSO e entrada em producao)

Mesmo padrao das fases anteriores (JSON camelCase, ProblemDetails com `code`, datas ISO 8601 UTC). Relatorios e SSO sao projetados do zero (ADR-005): nada da pasta `ee` do Tactical e usado.

## 1. Relatorios

### 1.1 Tipos (lista fechada; sem SQL livre)
Cada tipo e uma consulta fixa no servidor, com filtros validados. Nao ha editor de consultas: evita injecao de SQL e vazamento de dados entre clientes.

| `type` | Conteudo | Usa periodo | Filtros |
|---|---|---|---|
| `agents` | Agentes: cliente, site, hostname, sistema, versao do agente, status, ultimo contato, reinicio pendente, usuario logado | nao | `clientId`, `siteId`, `status` |
| `inventory` | Ativos: tipo, nome, fabricante, modelo, serie, patrimonio, responsavel, garantia, status, ultimo contato do agente | nao | `clientId`, `siteId`, `assetType` |
| `alerts` | Alertas do periodo: data, severidade, tipo, origem (maquina ou dispositivo), mensagem, resolvido em, duracao | sim | `clientId`, `severity` |
| `tickets` | Chamados do periodo: numero, titulo, tipo, prioridade, status, cliente, tecnico, aberto, resolvido, SLA de resposta e de solucao (cumprido ou nao), horas apontadas | sim | `clientId`, `assignedToId`, `status` |
| `patches` | Atualizacoes do Windows: maquina, KB, titulo, severidade, instalada, aprovacao | nao | `clientId`, `siteId`, `onlyPending` |
| `health` | Health Check: maquina, nota, conceito, data da coleta, itens com problema | nao | `clientId`, `siteId`, `maxScore` |
| `snmp_availability` | Dispositivos SNMP: nome, host, status atual, quedas no periodo, tempo fora, disponibilidade % | sim | `clientId` |

Resumo por tipo (`summary`, mostrado no topo do PDF e da previa):
- `agents`: total, online, offline, em atraso, reinicio pendente.
- `inventory`: total por tipo, sem responsavel, garantia vencida ou vencendo em 30 dias.
- `alerts`: total por severidade, total por tipo, abertos no fim do periodo.
- `tickets`: abertos no periodo, resolvidos, SLA de resposta cumprido %, SLA de solucao cumprido %, horas apontadas.
- `patches`: pendentes, instaladas, maquinas com pendencia.
- `health`: nota media, maquinas por conceito.
- `snmp_availability`: disponibilidade media, dispositivos com queda.

Disponibilidade SNMP: calculada pelos alertas `snmp_device` (inicio = `createdAt`, fim = `resolvedAt` ou fim do periodo), recortados ao periodo. Antes do primeiro registro do dispositivo o tempo nao conta.

### 1.2 Parametros comuns (`ReportParams`)
```
{ type, clientId?, siteId?, from?, to?, period?: "last_24h"|"last_7d"|"last_30d"|"previous_month"|"current_month",
  severity?, status?, assignedToId?, assetType?, onlyPending?, maxScore? }
```
- Tipos com periodo: `from`/`to` explicitos ou `period` (resolvido no fuso de `CoreSettings.TimeZone`); padrao `last_7d`; janela maxima de 366 dias.
- Filtros que nao se aplicam ao tipo sao ignorados.

### 1.3 Endpoints (permissoes novas `reports.view` e `reports.manage`)
| Metodo | Rota | Permissao | Corpo / resposta |
|---|---|---|---|
| GET | `/api/reports/types` | `reports.view` | `[{ type, label, description, usesPeriod, filters: string[] }]` |
| POST | `/api/reports/preview` | `reports.view` | `ReportParams` -> `ReportData` (ate 500 linhas; `truncated: true` se houver mais) |
| POST | `/api/reports/runs` | `reports.view` | `ReportParams & { format: "pdf"|"csv" }` -> 201 `ReportRunDto` (gerado na hora) |
| GET | `/api/reports/runs?page=&pageSize=&scheduleId=` | `reports.view` | `Paged<ReportRunDto>` |
| GET | `/api/reports/runs/{id}/download` | `reports.view` | arquivo (`application/pdf` ou `text/csv; charset=utf-8`), `Content-Disposition: attachment` |
| DELETE | `/api/reports/runs/{id}` | `reports.manage` | 204 |
| GET | `/api/reports/schedules` | `reports.view` | `ReportScheduleDto[]` |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/reports/schedules` | `reports.manage` | `SaveReportSchedule` |
| POST | `/api/reports/schedules/{id}/run` | `reports.manage` | executa agora (gera, guarda e envia) -> 201 `ReportRunDto` |

```
ReportData = { type, title, generatedAt, periodFrom?, periodTo?, filtersText: string[],
               summary: [{ label, value }], columns: [{ key, label, kind: "text"|"number"|"date"|"datetime"|"percent"|"duration" }],
               rows: object[], truncated }
ReportRunDto = { id, type, title, format, status: "ok"|"error", error?, fileName, size, createdAt, requestedBy, scheduleId?, emailedTo: string[] }
SaveReportSchedule = { name (1..200), params: ReportParams (period obrigatorio para tipos com periodo; from/to nao aceitos),
                       format: "pdf"|"csv", frequency: "daily"|"weekly"|"monthly", time: "HH:mm", dayOfWeek? (0..6, weekly),
                       dayOfMonth? (1..28, monthly), recipients: string[] (1..20 emails), enabled }
ReportScheduleDto = SaveReportSchedule & { id, lastRunAt?, lastStatus?, nextRunAt, createdBy }
```

### 1.4 Regras
- CSV: separador `;`, BOM UTF-8 (abre direto no Excel em portugues), datas no fuso configurado, numeros com virgula decimal. Valores que comecam com `=`, `+`, `-`, `@` recebem apostrofo na frente (protecao contra injecao de formula).
- PDF: A4 paisagem, cabecalho com titulo, periodo, filtros e data de geracao no fuso configurado; resumo; tabela com cabecalho repetido em cada pagina; rodape "pagina X de Y". Sem limite de 500 linhas; limite de 20.000 linhas por arquivo (acima disso, erro pedindo filtro menor).
- Arquivos gerados ficam guardados no banco (`report_runs`), ate 25 MB cada, por 90 dias (limpeza diaria).
- Agendamento: avaliado a cada minuto no fuso configurado; cada horario dispara uma vez mesmo com varias replicas (registro unico por agendamento e horario, como as tarefas da fase 3). Envio por e-mail com o arquivo anexo pelo SMTP das configuracoes; falha de e-mail fica registrada no run (`status: "ok"`, `error` com a falha do envio) e na auditoria.
- Geracao manual e agendada geram auditoria (`report.generated`).

## 2. SSO via OIDC

### 2.1 Fluxo (authorization code + PKCE)
```mermaid
sequenceDiagram
    participant B as Navegador
    participant S as API
    participant I as Provedor OIDC
    B->>S: GET /api/auth/sso/{id}/start?returnUrl=/
    S->>S: gera state, nonce e code_verifier; grava em cookie cifrado (10 min)
    S-->>B: 302 para authorization_endpoint
    B->>I: login no provedor
    I-->>B: 302 /api/auth/sso/callback?code&state
    B->>S: callback
    S->>I: POST token_endpoint (code + code_verifier + client_secret)
    S->>S: valida id_token (assinatura JWKS, iss, aud, exp, nonce)
    S->>S: localiza ou cria o usuario; registra o vinculo (provedor + sub)
    S-->>B: cookie de sessao; 302 para returnUrl ou /login?sso=2fa
```

### 2.2 Regras
- Um ou mais provedores (`OidcProvider`), configurados pelo console. Descoberta por `{authority}/.well-known/openid-configuration` (cache de 1 h).
- Vinculo do usuario, nesta ordem:
  1. Vinculo existente (provedor + `sub`).
  2. Se `linkByEmail` e o token traz `email` com `email_verified: true`, usuario local ativo com o mesmo e-mail: cria o vinculo.
  3. Se `autoProvision`: cria o usuario (nome de usuario da claim `usernameClaim`, padrao `preferred_username`, com sufixo numerico se ja existir), sem senha local, com o papel `defaultRoleId`.
  4. Senao: falha `SSO_USER_NOT_FOUND`.
- `allowedDomains` (opcional): o e-mail precisa terminar em um dos dominios.
- Usuario inativo ou bloqueado nao entra (`SSO_USER_DISABLED`).
- **2FA continua obrigatorio** (DoD): se o `id_token` traz `amr` com `mfa`, `otp`, `hwk`, `swk`, `fpt` ou `face` e o provedor tem `trustProviderMfa: true`, a sessao sai completa. Caso contrario, a sessao fica no mesmo estado parcial do login por senha e o usuario passa pelo TOTP local (ou pela configuracao dele, se ainda nao tiver).
- Erros do callback nao expoem detalhes do provedor: redireciona para `/login?ssoError=<code>` e grava o detalhe no log e na auditoria (`auth.sso.failed`).
- `returnUrl` so aceita caminho relativo do proprio console (comeca com `/`, sem `//`).
- O segredo do cliente fica cifrado no banco (cofre da fase 6, `VAULT_KEY`); nunca volta nas respostas (`hasClientSecret`).
- Usuario criado pelo SSO pode receber senha local depois (redefinicao pelo administrador); o login por senha continua funcionando para quem tem senha. A opcao `disablePasswordLogin` (global, `CoreSettings`) bloqueia o login por senha para todos, exceto superusuarios (acesso de emergencia).

### 2.3 Endpoints
| Metodo | Rota | Autenticacao | Resposta |
|---|---|---|---|
| GET | `/api/auth/sso/providers` | publica | `[{ id, name }]` so os ativos (tela de login) e `passwordLoginEnabled` |
| GET | `/api/auth/sso/{id}/start?returnUrl=` | publica | 302 para o provedor; 404 se inativo |
| GET | `/api/auth/sso/callback` | publica (cookie de estado) | 302 para o console |
| GET | `/api/sso/providers` | `settings.manage` | `OidcProviderDto[]` |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/sso/providers` | `settings.manage` | `SaveOidcProvider` |
| POST | `/api/sso/providers/test` | `settings.manage` | `{ authority }` -> `{ ok, issuer, authorizationEndpoint, error? }` (le a descoberta) |
| GET/PUT | `/api/sso/settings` | `settings.manage` | `{ disablePasswordLogin }` |
| GET | `/api/users/{id}` | `users.view` | `UserDto` ganha `ssoLogins: [{ providerId, providerName }]` e `hasPassword` |
| DELETE | `/api/users/{id}/sso/{providerId}` | `users.manage` | 204 (remove o vinculo) |

```
SaveOidcProvider = { name (1..100), authority (https; http so com host localhost), clientId, clientSecret? (ausente no PUT mantem),
                     scopes (padrao "openid profile email"), usernameClaim (padrao "preferred_username"), linkByEmail, autoProvision,
                     defaultRoleId?, allowedDomains: string[], trustProviderMfa, enabled }
OidcProviderDto = SaveOidcProvider sem clientSecret & { id, hasClientSecret, redirectUri, userCount }
```
`redirectUri` = `{App:PublicUrl}/api/auth/sso/callback` (o mesmo para todos os provedores; o provedor sai do estado).

Codigos de erro novos: `SSO_PROVIDER_ERROR`, `SSO_INVALID_STATE`, `SSO_INVALID_TOKEN`, `SSO_USER_NOT_FOUND`, `SSO_USER_DISABLED`, `SSO_DOMAIN_NOT_ALLOWED`, `PASSWORD_LOGIN_DISABLED`.

## 3. Entrada em producao
- **Hardening** (ADR-018): cabecalhos de seguranca no Nginx (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`); conteineres sem root quando a imagem permite, `no-new-privileges`, `cap_drop: ALL` com as capacidades necessarias, limites de memoria; somente 80, 443 e a porta do NATS para agentes expostas; Redis com senha; verificacao de dependencias vulneraveis no CI (`dotnet list package --vulnerable`, `npm audit`).
- **Backup e restauracao**: scripts `infra/docker/backup/backup.sh` e `restore.sh` (PostgreSQL com `pg_dump -Fc`, volumes do MeshCentral (substituido na fase 12.8, ver ADR-022): o backup nao inclui mais volumes do MeshCentral, cifragem opcional com `BACKUP_PASSPHRASE`, retencao `BACKUP_KEEP_DAYS`), servico agendado no compose e restauracao testada em projeto separado.
- **Runbooks** em `docs/runbooks/`: instalacao, atualizacao e reversao, backup e restauracao, incidentes comuns, rotacao de segredos e migracao das 400 estacoes.

## 4. Fora desta fase
- SAML (so OIDC).
- Editor de relatorios personalizados e SQL livre.
- Envio de relatorios por webhook ou para armazenamento externo.
