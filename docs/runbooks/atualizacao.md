# Runbook: atualizacao e reversao

## Antes de atualizar (sempre)
1. Anote a versao atual: `grep -E '^(VERSION|AGENT_VERSION|MESHCENTRAL_VERSION)=' infra/docker/.env`.
2. Leia as notas da versao nova: migracoes de banco, variaveis novas no `.env.example`, mudancas no `docker-compose.yml`.
3. Faca um backup manual e confira que terminou:
   ```bash
   cd infra/docker
   docker compose exec backup backup.sh
   ls -lt backups/ | head -3
   ```
   Copie esse conjunto para fora da VPS. Ele e o seu caminho de volta se a versao nova aplicar migracoes.
4. Avise os tecnicos: a API reinicia e as conexoes do console caem por alguns segundos. Os agentes reconectam sozinhos.

## Atualizar o servidor
O CI publica as imagens com a tag do commit (SHA) e `latest`. Fixe uma tag em `VERSION` em vez de usar `latest`, para saber o que esta rodando e conseguir voltar.

```bash
cd infra/docker
git pull                                   # compose, scripts e templates do Nginx
diff <(grep -o '^[A-Z_]*' .env | sort) <(grep -o '^[A-Z_]*' .env.example | sort)   # variaveis novas
# ajuste VERSION=<sha> no .env
docker compose pull --ignore-pull-failures
docker compose up -d
docker compose ps
curl -fsS https://CYBEREYES_HOST/health
```

Como funciona a ordem: o servico `migrate` roda `--migrate-only` (aplica as migracoes do EF Core e o seed) e a `api` so sobe depois que ele termina com sucesso (`depends_on: service_completed_successfully`). Se uma migracao falhar, o `docker compose up` termina com erro e a API nova nao e iniciada (comportamento esperado do `depends_on`; o caso de falha nao foi ensaiado). O erro aparece em:
```bash
docker compose logs migrate
```

Mudancas no template do Nginx (`infra/docker/nginx/templates`) ou nos scripts do NATS so valem depois de reconstruir ou recriar o servico (`docker compose build nginx && docker compose up -d nginx`).

Instalacao criada antes da renomeacao para Cybereyes (projeto Compose, banco, variavel do host e usuario do NATS com o nome anterior): nao basta `git pull` e `up -d`. Com o projeto Compose novo os volumes sao outros e o stack subiria vazio. Siga o roteiro do ADR-019 (`docs/adrs/ADR-019-renomeacao-cybereyes.md`), que leva os dados com `backup.sh` e `restore.sh`.

## Reversao
- **A versao nova nao trouxe migracao**: volte `VERSION` para a tag anterior e `docker compose up -d`.
- **A versao nova aplicou migracao**: o banco ficou no formato novo e a API antiga pode nao funcionar com ele. Nao existe migracao reversa automatica. Volte `VERSION` para a tag anterior e restaure o backup feito antes da atualizacao:
  ```bash
  cd infra/docker
  BACKUP_PASSPHRASE='...' backup/restore.sh --yes backups/<conjunto-de-antes-da-atualizacao>
  ```
  Tudo o que entrou no banco entre o backup e a reversao (chamados, logs, resultados de checks) se perde. Por isso o backup deve ser feito imediatamente antes da atualizacao.

Para saber se houve migracao, compare as migracoes aplicadas antes e depois:
```bash
docker compose exec -T postgres psql -U cybereyes -d cybereyes -Atc \
  'select "MigrationId" from "__EFMigrationsHistory" order by 1 desc limit 3'
```

## Atualizar o MeshCentral
1. Backup (o `mesh_data` entra no conjunto).
2. Mude `MESHCENTRAL_VERSION` no `.env` e `docker compose up -d meshcentral` (a imagem `cybereyes-meshcentral:<versao>` precisa existir no registro ou ser construida com `docker compose build meshcentral`).
3. Reverter: versao anterior no `.env` e, se o MeshCentral alterou o banco interno, restaurar o `mesh_data` com `restore.sh` (que tambem restaura o PostgreSQL do mesmo conjunto).

## Versao do agente
- A API distribui a versao em `AGENT_VERSION` (`Agent:LatestVersion`): o download em `/api/agent/download/{plat}/{arch}` busca `infra/docker/agents/tacticalagent-v<versao>-<plat>-<arch>[.exe]` e, se o arquivo nao existir, redireciona para os releases do `rmmagentwincare` no GitHub (`.../releases/download/v<versao>/...`). O instalador tambem recusa versoes menores que `AGENT_VERSION`.
- Estado atual (ver ADR-016 e ADR-017): o agente 2.12.0 (modulos do Cybereyes Care e Health Check) e o 2.13.0 (logs e coletor SNMP) estao prontos, mas as tags `v2.12.0` e `v2.13.0` ainda precisam ser criadas no GitHub do `rmmagentwincare`. Ate la `AGENT_VERSION` fica em `2.11.0`.
- Depois de publicar a tag e confirmar que os arquivos do release existem:
  ```bash
  curl -fsIL https://github.com/PauloACruz/rmmagentwincare/releases/download/v2.13.0/tacticalagent-v2.13.0-windows-amd64.exe | head -1
  ```
  mude `AGENT_VERSION=2.13.0` no `.env` e `docker compose up -d api`.
- `AGENT_VERSION` vale para instalacoes novas. Nao encontrei no backend um comando de atualizacao remota dos agentes ja instalados; para atualiza-los, rode de novo o comando da implantacao do site (ver `migracao-400-estacoes.md`), que reinstala por cima (procedimento recomendado, ainda nao testado). Funcoes que exigem 2.12.0 ou 2.13.0 avisam no console quando o agente e mais antigo.
- Reversao do agente: volte `AGENT_VERSION` e reinstale nas maquinas afetadas.
