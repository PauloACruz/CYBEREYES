# WinCare Platform

Plataforma unificada de RMM e chamados: backend C# (.NET 10), frontend React, agente Go (repositorio `rmmagentwincare`) e MeshCentral para acesso remoto pelo navegador.

Contexto, decisoes e padroes: [`.team-context.md`](.team-context.md). Plano por fases: [`docs/PLANO.md`](docs/PLANO.md).

## Estrutura

| Pasta | Conteudo |
|---|---|
| `backend/` | API ASP.NET Core (`WinCare.Api`), dominio e persistencia (`WinCare.Core`), testes |
| `frontend/` | Console do tecnico em React + TypeScript |
| `infra/docker/` | Docker Compose da VPS: Nginx (balanceador e TLS), Certbot, PostgreSQL, Redis, NATS, MeshCentral, API e frontend |
| `docs/` | Contratos de API, ADRs, runbooks |

## Desenvolvimento local

Requisitos: .NET SDK 10, Node 22, Docker.

```bash
# banco de dados
docker run -d --name wincare-pg -e POSTGRES_DB=wincare -e POSTGRES_USER=wincare \
  -e POSTGRES_PASSWORD=wincare_dev -p 5432:5432 postgres:17-alpine

# backend em http://localhost:5080 (cria o usuario admin / admin-dev-password)
cd backend && dotnet run --project src/WinCare.Api

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

1. Aponte dois nomes DNS para a VPS: um para o console (`WINCARE_HOST`) e outro para o MeshCentral (`MESH_HOST`).
2. Libere as portas 80 e 443.
3. `cd infra/docker && cp .env.example .env` e preencha as senhas.
4. `docker compose up -d`

O Nginx distribui as requisicoes entre as instancias da API (`API_REPLICAS`, padrao 2). O Certbot emite e renova os certificados Let's Encrypt automaticamente (perfil `letsencrypt`); para usar certificado proprio, coloque `fullchain.pem` e `privkey.pem` em `infra/docker/certs/<host>/`. Backup e restauracao: [`docs/runbooks/backup-restauracao.md`](docs/runbooks/backup-restauracao.md).

O MeshCentral cria sozinho, na primeira partida, o administrador interno e a chave de token usada pela API; os tecnicos com a permissao `agents.remote` ganham um usuario proprio no MeshCentral e abrem o acesso remoto direto pelo console, sem segundo login. Detalhes: [`docs/api/fase4-mesh.md`](docs/api/fase4-mesh.md).
