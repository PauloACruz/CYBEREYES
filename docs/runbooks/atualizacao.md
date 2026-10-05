# Runbook: atualizacao e reversao

## Antes de atualizar (sempre)
1. Anote a versao atual: `grep -E '^(VERSION|AGENT_VERSION)=' infra/docker/.env`.
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

## Atualizacao que remove o MeshCentral (fase 12.8)
O MeshCentral saiu do Cybereyes na fase 12.8 (ADR-023); o acesso remoto agora e do proprio EYES e da API. Na primeira atualizacao para uma versao sem MeshCentral:
1. Siga "Antes de atualizar" e "Atualizar o servidor" normalmente; o `git pull` traz o compose e o template do Nginx sem o servico `meshcentral` e sem o servidor do `MESH_HOST`.
2. Retire do `.env` as variaveis `MESH_HOST`, `MESH_*` e `MESHCENTRAL_VERSION` (o `diff` com o `.env.example` mostra as que sobraram).
3. Suba com `docker compose up -d --remove-orphans` para parar e remover o conteiner antigo do `meshcentral`, e reconstrua o Nginx (`docker compose build nginx && docker compose up -d nginx`).
4. Confira o acesso remoto novo: abra a tela de um agente de teste pelo console (EYES 3.1.0 ou mais novo, ver `incidentes.md`).
5. Fora do compose: remova o registro DNS e o certificado do `MESH_HOST` (`certs/<MESH_HOST>/`, se o certificado era proprio). Os volumes antigos (`docker volume ls | grep mesh_`) nao entram mais no backup; nenhuma estacao de producao usou o MeshAgent, entao nao ha dados a preservar (RFC-001, secao 10). Apague-os com `docker volume rm` quando a equipe decidir, seguindo o checklist da secao 14 do RFC-001.

## Versao do agente (EYES)
- O EYES e compilado junto com a imagem da API a partir de `agent/` (`agent/VERSION`, ver ADR-020). Atualizar a API para um commit com versao nova do EYES ja passa a distribuir a versao nova; `AGENT_VERSION` vazio no `.env` usa a versao embutida.
- O download em `/api/agent/download/{plat}/{arch}` procura `eyes-v<versao>-<plat>-<arch>[.exe]` primeiro em `infra/docker/agents` (montado em `/agents`) e depois nos binarios embutidos. Sem binario, responde 404; nao ha mais redirecionamento para o GitHub.
- Agentes instalados (3.x) sao atualizados sozinhos a cada 30 minutos quando estao online com versao menor (`Agent__AutoUpdate=false` desliga). Tambem da para atualizar pelo console: "Atualizar EYES" no menu Acoes do agente ou "Atualizar agentes" na lista. O agente confere o SHA-256 do binario, troca o executavel e reinicia o servico.
- Conferir a versao distribuida:
  ```bash
  curl -fsS https://CYBEREYES_HOST/api/agent/download/linux/amd64 -o /tmp/eyes && chmod +x /tmp/eyes && /tmp/eyes version
  ```
- O registro de agentes novos exige `Agent:MinimumVersion` (padrao 3.0.0), independente da versao distribuida.
- Reversao do agente: suba a imagem anterior da API (ou coloque o binario anterior em `infra/docker/agents` e defina `AGENT_VERSION` com a versao dele) e use "Atualizar agentes"; o agente aceita trocar para qualquer versao que o servidor distribua.
