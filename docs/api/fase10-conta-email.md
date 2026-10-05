# Contrato de API - Convite de usuarios e recuperacao de senha por e-mail

Base: `/api`. Formato de erro e codigos comuns em `fase0-auth.md`. Decisao em `docs/adrs/ADR-021-convite-recuperacao-senha.md`.

Os e-mails saem pelo SMTP de Configuracoes > E-mail (o mesmo dos alertas e relatorios). Os links usam `App:PublicUrl` (no compose: `https://CYBEREYES_HOST`).

## Codigo de erro novo

| Status | code | Quando |
|---|---|---|
| 400 | INVALID_TOKEN | Link de redefinicao ou de convite invalido, expirado ou ja usado |

## Recuperacao de senha (anonimo, limite `auth` por IP)

| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/auth/password/forgot` | `{ login }` (usuario ou e-mail) | 202 sempre, exista a conta ou nao |
| POST | `/api/auth/password/reset` | `{ userId, token, newPassword }` | 204; 400 `INVALID_TOKEN`; 400 `VALIDATION_ERROR` em `newPassword` |

- O e-mail so sai para usuario ativo, com e-mail, sem login por senha bloqueado pelo SSO, com SMTP configurado e sem outro pedido nos ultimos 2 minutos. Nenhum desses casos muda a resposta (202).
- O envio acontece em segundo plano: a resposta leva o mesmo tempo exista a conta ou nao. Falha de envio fica no log da API e na auditoria (`user.password-reset-email-failed`).
- Link: `https://CYBEREYES_HOST/redefinir-senha?uid=<id>&token=<token>`, valido por 2 horas e uma unica vez (a troca de senha muda o security stamp).
- A redefinicao desbloqueia a conta (lockout) e zera as tentativas. O 2FA continua: o usuario entra com a senha nova e o codigo TOTP.
- Auditoria: `user.password-reset-requested`, `user.password-reset-self`.

## Convite

| Metodo | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/users` | `{ username, email, fullName, roleIds, isActive, sendInvite: true }` (sem `password`) | 201 `UserDto` com `invitePending: true`; `inviteError` preenchido se o usuario foi criado mas o e-mail falhou |
| POST | `/api/users/{id}/invite` | - | 204; 409 se o usuario ja definiu a senha, ja acessou ou esta inativo; 400 se o envio falhar |
| GET | `/api/auth/invite?uid=&token=` | - | 200 `{ username, fullName }`; 400 `INVALID_TOKEN` (tambem "convite ja usado") |
| POST | `/api/auth/invite/accept` | `{ userId, token, password }` | 204; 400 `INVALID_TOKEN`; 400 `VALIDATION_ERROR` em `password` |

- `POST /api/users` exige `password` ou `sendInvite: true` (nao os dois). Com `sendInvite` e sem SMTP configurado: 400 com erro em `sendInvite`, e nada e criado.
- Link: `https://CYBEREYES_HOST/convite?uid=<id>&token=<token>`, valido por 72 horas. Reenviar o convite invalida o link anterior; aceitar invalida o link usado.
- `UserDto.invitePending`: usuario sem senha local e que nunca acessou (usuarios so de SSO ja tem `lastLoginAt`).
- `GET /api/users` e `GET /api/users/{id}` passam a trazer `invitePending`.
- Auditoria: `user.invited`, `user.invite-failed`, `user.invite-accepted`.

## Telas (frontend)

- `/esqueci-senha` (link "Esqueci minha senha" no login), `/redefinir-senha`, `/convite`.
- Usuarios > Novo usuario: "Enviar convite por e-mail" (padrao) ou "Definir senha agora". Lista: badge "Convite pendente" e acao "Reenviar convite".
