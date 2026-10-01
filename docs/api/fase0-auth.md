# Contrato de API - Fase 0 (autenticacao, usuarios, papeis, chaves de API, auditoria)

Base: `/api`. JSON em camelCase. Datas em ISO 8601 UTC.

## Autenticacao

- **Console (navegador)**: cookie `wincare.auth` (HttpOnly, Secure, SameSite=Strict), emitido pelo backend. O frontend chama a API na mesma origem com `credentials: "same-origin"`.
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
| POST | `/api/auth/login/2fa` | `{ code, rememberMe? }` | 200 `{ status: "ok" }` |
| POST | `/api/auth/login/recovery` | `{ recoveryCode }` | 200 `{ status: "ok" }` |
| GET | `/api/auth/2fa/setup` | | 200 `{ sharedKey, otpauthUri }` |
| POST | `/api/auth/2fa/enable` | `{ code }` | 200 `{ status: "ok", recoveryCodes: string[] }` |
| POST | `/api/auth/logout` | | 204 |
| GET | `/api/auth/me` | | 200 `MeDto` |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` | 204 |

`MeDto`: `{ id, username, email, fullName, isSuperuser, roles: string[], permissions: string[], twoFactorEnabled, mfaSatisfied }`

### Usuarios (permissoes `users.view` e `users.manage`)
| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/users?page=1&pageSize=25&search=` | | 200 `Paged<UserDto>` |
| GET | `/api/users/{id}` | | 200 `UserDto` |
| POST | `/api/users` | `{ username, email, fullName, password, roleIds: string[], isActive }` | 201 `UserDto` |
| PUT | `/api/users/{id}` | `{ email, fullName, roleIds: string[], isActive }` | 200 `UserDto` |
| POST | `/api/users/{id}/reset-password` | `{ newPassword }` | 204 |
| POST | `/api/users/{id}/reset-2fa` | | 204 |
| DELETE | `/api/users/{id}` | | 204 |

`UserDto`: `{ id, username, email, fullName, isActive, twoFactorEnabled, roles: [{ id, name }], lastLoginAt, createdAt }`
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
| POST | `/api/apikeys` | `{ name, expiresAt? }` | 201 `ApiKeyDto & { key }` (a chave aparece so nesta resposta) |
| DELETE | `/api/apikeys/{id}` | | 204 |

`ApiKeyDto`: `{ id, name, prefix, username, expiresAt, createdAt, lastUsedAt }`

### Auditoria (permissao `audit.view`)
| Metodo | Rota | Resposta |
|---|---|---|
| GET | `/api/audit?page=1&pageSize=50&username=&action=&from=&to=` | 200 `Paged<AuditDto>` |

`AuditDto`: `{ id, timestamp, username, action, objectType, objectId, message, ipAddress }`

### Saude
`GET /health` (sem autenticacao): 200 `{ status: "Healthy" }` ou 503.

## Catalogo de permissoes da fase 0
`users.view`, `users.manage`, `roles.manage`, `apikeys.manage`, `audit.view`, `settings.manage`. Papeis com `isSuperuser` tem todas.
