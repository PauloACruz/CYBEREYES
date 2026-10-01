# Runbook: backup e restauracao

Meta (ver `.team-context.md`): RPO < 24 h, RTO < 2 h.

## O que precisa de backup
| Item | Onde |
|---|---|
| Banco PostgreSQL | volume `postgres_data` (usar `pg_dump`, nao copiar o volume com o banco ligado) |
| Dados do MeshCentral | volume `mesh_data` (configuracao, banco interno, certificados do agente Mesh) |
| Arquivos do MeshCentral | volume `mesh_files` |
| Configuracao | `infra/docker/.env` (guardar em cofre de senhas, nunca no Git) |

## Backup diario
```bash
cd infra/docker
STAMP=$(date +%Y%m%d)
docker compose exec -T postgres pg_dump -U wincare -Fc wincare > backup/wincare-$STAMP.dump
docker run --rm -v wincare_mesh_data:/d -v "$PWD/backup":/b alpine tar czf /b/mesh-data-$STAMP.tgz -C /d .
docker run --rm -v wincare_mesh_files:/d -v "$PWD/backup":/b alpine tar czf /b/mesh-files-$STAMP.tgz -C /d .
```
Copie a pasta `backup/` para fora da VPS (outro provedor ou armazenamento de objetos).

## Restauracao em VPS nova
1. Instale Docker, clone o repositorio, restaure o `.env`.
2. `docker compose up -d postgres` e aguarde ficar saudavel.
3. `docker compose exec -T postgres pg_restore -U wincare -d wincare --clean --if-exists < backup/wincare-AAAAMMDD.dump`
4. Restaure os volumes do MeshCentral com `tar xzf` no mesmo esquema do backup.
5. `docker compose up -d` e valide `https://WINCARE_HOST/health`.
6. Ajuste o DNS se o IP mudou.

## Validacao
Teste a restauracao ao menos uma vez por trimestre em uma VPS temporaria.
