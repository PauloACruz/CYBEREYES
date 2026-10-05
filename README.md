# Cybereyes

Plataforma unificada de RMM e chamados: backend C# (.NET 10), frontend React, agente EYES em Go (`agent/`, ver ADR-020) e acesso remoto proprio pelo navegador, embutido no EYES e na API (ver ADR-023).

Contexto, decisoes e padroes: [`.team-context.md`](.team-context.md). Plano por fases: [`docs/PLANO.md`](docs/PLANO.md).

## Estrutura

| Pasta | Conteudo |
|---|---|
| `backend/` | API ASP.NET Core (`Cybereyes.Api`), dominio e persistencia (`Cybereyes.Core`), testes |
| `frontend/` | Console do tecnico em React + TypeScript |
| `infra/docker/` | Docker Compose da VPS: Nginx (balanceador e TLS), Certbot, PostgreSQL, Redis, NATS, API e frontend |
| `docs/` | Contratos de API, ADRs, runbooks |

## Desenvolvimento local

Requisitos: .NET SDK 10, Node 22, Docker.

```bash
# banco de dados
docker run -d --name cybereyes-pg -e POSTGRES_DB=cybereyes -e POSTGRES_USER=cybereyes \
  -e POSTGRES_PASSWORD=cybereyes_dev -p 5432:5432 postgres:17-alpine

# backend em http://localhost:5080 (cria o usuario admin / admin-dev-password)
cd backend && dotnet run --project src/Cybereyes.Api

# frontend em http://localhost:5173 (proxy de /api para o backend)
cd frontend && npm install && npm run dev
```

No primeiro login o sistema exige configurar a verificacao em dois fatores (Google Authenticator, Microsoft Authenticator ou similar).

## Testes

```bash
cd backend && dotnet test          # usa Testcontainers, precisa de Docker
cd frontend && npm run lint && npm run typecheck && npm test
```

## Producao (VPS com Docker)

1. Aponte um nome DNS para a VPS, o do console (`CYBEREYES_HOST`).
2. Libere as portas 80 e 443.
3. `cd infra/docker && cp .env.example .env` e preencha as senhas.
4. `docker compose up -d`

O Nginx distribui as requisicoes entre as instancias da API (`API_REPLICAS`, padrao 2). O Certbot emite e renova os certificados Let's Encrypt automaticamente (perfil `letsencrypt`); para usar certificado proprio, coloque `fullchain.pem` e `privkey.pem` em `infra/docker/certs/<host>/`. Backup e restauracao: [`docs/runbooks/backup-restauracao.md`](docs/runbooks/backup-restauracao.md).

O acesso remoto e proprio do Cybereyes (o MeshCentral saiu na fase 12.8, ver ADR-023): o tecnico abre a tela da estacao numa janela do console (`/acesso-remoto/:agentId`), com area de transferencia automatica, transferencia de arquivos (painel, arrastar e soltar e aba "Arquivos"), terminal do EYES e Wake-on-LAN por um EYES vizinho. O relay passa pelo mesmo nome do console (`location /api/remote/` no Nginx), sem segundo dominio nem segundo login. Permissoes: `agents.remote` (tela e area de transferencia), `agents.files` (arquivos), `agents.control` (Wake-on-LAN) e `settings.manage` (politicas em Configuracoes > Acesso remoto). Detalhes: [`docs/remoto/contrato-remoto.md`](docs/remoto/contrato-remoto.md).
