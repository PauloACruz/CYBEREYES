# Contrato de API - Fase 0 (autenticacao, usuarios, papeis, chaves de API, auditoria)

Base: `/api`. JSON em camelCase. Datas em ISO 8601 UTC.

## Autenticacao

- **Console (navegador)**: cookie `cybereyes.auth` (HttpOnly, Secure, SameSite=Strict), emitido pelo backend. O frontend chama a API na mesma origem com `credentials: "same-origin"`.
- **Integracoes**: cabecalho `X-API-KEY: <chave>`.
- **2FA obrigatorio**: apos a senha, o usuario so acessa a API completa depois de validar o codigo TOTP. Sem 2FA configurado, so os endpoints de configuracao de 2FA, `GET /api/auth/me` e `POST /api/auth/logout` respondem.

## Erros

Formato ProblemDetails (RFC 9457), com a extensao `code`:

```json
{ "type": "about:blank", "title": "Credenciais invalidas", "status": 401, "code": "INVALID_CREDENTIALS" }
```

Validacao (400) inclui `errors: { "campo": ["mensagem"] }`.

| Status | code | Quando |
|---|---|---|
| 400 | VALIDATION_ERROR | Dados invalidos |
| 401 | UNAUTHENTICATED | Sem sessao ou chave valida |
| 401 | INVALID_CREDENTIALS | Usuario ou senha incorretos |
| 401 | INVALID_CODE | Codigo TOTP ou de recuperacao invalido |
| 403 | MFA_REQUIRED | Sessao sem 2FA validado |
| 403 | FORBIDDEN | Sem permissao |
| 403 | LOCKED_OUT | Conta bloqueada por tentativas |
| 404 | NOT_FOUND | Recurso inexistente |
| 409 | CONFLICT | Nome de usuario ou papel duplicado |
| 429 | RATE_LIMITED | Muitas tentativas |

## Endpoints

### Sessao
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/auth/login` | `{ username, password, rememberMe? }` | 200 `{ status: "ok" \| "requires2fa" \| "requires2faSetup" }` |
| POST | `/api/auth/login/2fa` | `{ code, rememberMe?, rememberDevice? }` | 200 `{ status: "ok" }` |
| POST | `/api/auth/login/recovery` | `{ recoveryCode }` | 200 `{ status: "ok" }` |
| GET | `/api/auth/2fa/setup` | | 200 `{ sharedKey, otpauthUri }` |
| POST | `/api/auth/2fa/enable` | `{ code }` | 200 `{ status: "ok", recoveryCodes: string[] }` |
| GET | `/api/auth/2fa/device` | | 200 `{ remembered, expiresAt }` |
| DELETE | `/api/auth/2fa/device` | | 204 |
| POST | `/api/auth/logout` | | 204 |
| GET | `/api/auth/me` | | 200 `MeDto` |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` | 204 |

No login, `username` aceita tambem o e-mail do usuario (o e-mail e unico por conta).

**Aparelho lembrado (30 dias)**: com `rememberDevice: true` no `POST /api/auth/login/2fa`, o navegador recebe o cookie
`cybereyes.2fa-aparelho` (prazo fixo de 30 dias, preso ao carimbo de seguranca da conta). Nesse aparelho, `POST /api/auth/login`
(ou a entrada por biometria) responde `ok` direto, com a sessao ja valendo como MFA. `GET /api/auth/2fa/device` diz se o aparelho
atual esta lembrado e ate quando; `DELETE` volta a pedir o codigo nele. Trocar a senha ou o administrador redefinir o 2FA
invalida todos os aparelhos lembrados. Decisao em `docs/adrs/ADR-027-biometria-e-2fa-mensal-no-app.md`.

### Biometria (passkeys / WebAuthn)

| Metodo | Rota | Acesso | Corpo | Resposta |
|---|---|---|---|---|
| GET | `/api/auth/passkeys` | sessao completa | | 200 `PasskeyDto[]` |
| POST | `/api/auth/passkeys/register/options` | sessao completa | | 200 opcoes do `navigator.credentials.create()` (JSON do WebAuthn) |
| POST | `/api/auth/passkeys/register` | sessao completa | `{ credential, name? }` | 201 `PasskeyDto` |
| DELETE | `/api/auth/passkeys/{id}` | sessao completa | | 204 |
| POST | `/api/auth/passkeys/login/options` | anonimo | | 200 opcoes do `navigator.credentials.get()` (JSON do WebAuthn) |
| POST | `/api/auth/passkeys/login` | anonimo | `{ credential, rememberMe? }` | 200 `{ status: "ok" \| "requires2fa" }` |

- `credential`: o `PublicKeyCredential` do navegador em JSON, com os binarios em base64url (formato de `toJSON()` do WebAuthn).
- `PasskeyDto`: `{ id, name, createdAt, synced }`. `id` e o id da credencial em base64url; `name` vem do navegador que cadastrou
  (iPhone, iPad, Android, Windows, Mac) quando `name` nao e enviado (ate 60 caracteres); `synced` indica copia na nuvem do aparelho.
- Opcoes: autenticador do proprio aparelho (`platform`), verificacao do usuario obrigatoria e credencial guardada no aparelho
  (entrada sem digitar o usuario). RP ID = host de `App:PublicUrl`; a origem do navegador tem de ser a de `App:PublicUrl`.
- O desafio vale uma vez e fica num cookie temporario; responder sem pedir as opcoes antes da 400 (cadastro) ou 401 (entrada).
- Entrada: a biometria substitui a senha. Aparelho lembrado nos ultimos 30 dias: `ok`. Senao `requires2fa` e o fluxo segue em
  `POST /api/auth/login/2fa`. Usuario inativo ou credencial desconhecida: 401 `INVALID_CREDENTIALS`; conta bloqueada: 403
  `LOCKED_OUT`; senha desativada pela politica de SSO: 403; conta sem 2FA configurado: 401 (configurar exige a senha).
- Limite de 10 aparelhos por conta (409). `POST /api/users/{id}/reset-2fa` remove todas as biometrias da conta.
- Auditoria: `passkey.registered`, `passkey.removed`, `passkey.failed`, `login.success` ("Login com biometria"), `2fa.device-forgotten`.

`MeDto`: `{ id, username, email, fullName, isSuperuser, roles: string[], permissions: string[], twoFactorEnabled, mfaSatisfied }`

### Usuarios (permissoes `users.view` e `users.manage`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/users?page=1&pageSize=25&search=` | | 200 `Paged<UserDto>` |
| GET | `/api/users/{id}` | | 200 `UserDto` |
| GET | `/api/users/client-options` | | 200 `[{ id, name }]` (so `users.manage`; clientes que quem edita enxerga) |
| POST | `/api/users` | `{ username, email, fullName, password, roleIds: string[], isActive, allClients = true, clientIds: number[] }` | 201 `UserDto` |
| PUT | `/api/users/{id}` | `{ email, fullName, roleIds: string[], isActive, allClients?, clientIds? }` | 200 `UserDto` |
| POST | `/api/users/{id}/reset-password` | `{ newPassword }` | 204 |
| POST | `/api/users/{id}/reset-2fa` | | 204 |
| DELETE | `/api/users/{id}` | | 204 |

`UserDto`: `{ id, username, email, fullName, isActive, twoFactorEnabled, roles: [{ id, name }], lastLoginAt, createdAt, allClients, clients: [{ id, name }] }`

Clientes visiveis: com `allClients = false` o usuario so ve os clientes de `clientIds` (ao menos um). A restricao vale para
tudo que pertence a um cliente (sites, agentes, checks, alertas, chamados, inventario, documentacao, logs, SNMP e relatorios),
por filtro global do EF aplicado a cada requisicao; o que fica fora do escopo responde 404. Papeis de administrador
(`isSuperuser`) ignoram a restricao. Quem edita e tambem e restrito so libera os proprios clientes e nao pode dar
`allClients`; no PUT, os clientes fora do escopo de quem edita sao mantidos. Sem `allClients` e `clientIds` no PUT, o acesso
fica como esta. Cliente criado por usuario restrito entra no escopo dele. Agendamento de relatorio de usuario restrito
precisa de `params.clientId`; relatorio gerado sem cliente so aparece para quem o gerou. Chamado sem cliente (aberto sem
maquina) aparece para quem abriu e para o responsavel.
`Paged<T>`: `{ items: T[], total, page, pageSize }`

### Papeis (permissao `roles.manage`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/roles` | | 200 `RoleDto[]` |
| GET | `/api/roles/permissions` | | 200 `[{ key, group, description }]` |
| GET | `/api/roles/options` | | 200 `[{ id, name }]` (permissao `users.manage`, usado no cadastro de usuarios) |
| POST | `/api/roles` | `{ name, isSuperuser, permissions: string[] }` | 201 `RoleDto` |
| PUT | `/api/roles/{id}` | `{ name, isSuperuser, permissions: string[] }` | 200 `RoleDto` |
| DELETE | `/api/roles/{id}` | | 204 |

`RoleDto`: `{ id, name, isSuperuser, permissions: string[], userCount }`

### Chaves de API (permissao `apikeys.manage`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/apikeys` | | 200 `ApiKeyDto[]` |
| POST | `/api/apikeys` | `{ name, expiresAt?, userId? }` | 201 `ApiKeyDto & { key }` (a chave aparece so nesta resposta). `userId`: dono da chave quando nao e quem cria; so superusuarios (403 para os demais, 400 se o usuario nao existir ou estiver inativo) |
| DELETE | `/api/apikeys/{id}` | | 204 |

`ApiKeyDto`: `{ id, name, prefix, username, expiresAt, createdAt, lastUsedAt }`

A chave vai no cabecalho `X-API-KEY` ou em `Authorization: Bearer <chave>` (formato dos clientes MCP, ver `mcp.md`) e age com as
permissoes do usuario dono.

### Auditoria (permissao `audit.view`)
| Metodo | Rota | Resposta |
|---|---|---|
| GET | `/api/audit?page=1&pageSize=50&username=&action=&from=&to=` | 200 `Paged<AuditDto>` |

`AuditDto`: `{ id, timestamp, username, action, objectType, objectId, message, ipAddress }`

### Saude
`GET /health` (sem autenticacao): 200 `{ status: "Healthy" }` ou 503.

## Catalogo de permissoes da fase 0
`users.view`, `users.manage`, `roles.manage`, `apikeys.manage`, `audit.view`, `settings.manage`. Papeis com `isSuperuser` tem todas.
