# Runbook: backup e restauracao

Meta (ver `.team-context.md`): RPO < 24 h, RTO < 2 h.

## O que entra no backup
| Item | Como | Arquivo no conjunto |
|---|---|---|
| Banco PostgreSQL | `pg_dump -Fc` (copia consistente com o banco ligado) | `postgres.dump` |
| `.env` (opcional, desligado por padrao) | copia, so com cifragem ligada | `env` |
| Lista do dump, versao e data | gerados | `postgres.list`, `manifest.txt`, `SHA256SUMS` |

Com o projeto Compose padrao (`name: cybereyes`), o volume real do banco e `cybereyes_postgres_data`.

Desde a fase 12.8 (ADR-022) o MeshCentral nao existe mais e os volumes `mesh_data`, `mesh_files` e `mesh_shared` sairam do backup. Conjuntos feitos antes disso ainda podem trazer `mesh_data.tar.gz` e `mesh_files.tar.gz`; esses arquivos nao sao mais usados. O destino dos volumes antigos na VPS esta em `atualizacao.md` ("Atualizacao que remove o MeshCentral").

Fora do backup, de proposito:
- `redis_data`: o Redis so faz o backplane do SignalR; nada nele precisa sobreviver.
- `nats_auth`: a API regrava o arquivo de usuarios do NATS a partir do banco.
- `letsencrypt`: o Certbot emite de novo na VPS nova (ou use `certs/` com certificado proprio).
- **`VAULT_KEY`**: sem ela as senhas do cofre (documentacao, comunidades e senhas SNMP, segredo do cliente OIDC) nao podem ser decifradas. Guarde-a no cofre de senhas da equipe, separada do backup. O `.env` so entra no backup se `BACKUP_INCLUDE_ENV=true` e `BACKUP_PASSPHRASE` estiver definida; mesmo assim, mantenha uma copia do `.env` fora do servidor.

Atencao: as chaves do ASP.NET Data Protection ficam dentro do banco (tabela `data_protection_keys`) e sem cifragem propria. Quem tem o `postgres.dump` em texto claro consegue decifrar o que elas protegem (senha do SMTP, tokens das implantacoes). Por isso a cifragem do backup e recomendada sempre que o backup sair da VPS.

## Backup automatico (servico `backup`)
O servico `backup` do `docker-compose.yml` fica sempre ativo (sem perfil, para nao depender de lembrar de ativar) e roda `backup.sh --daemon`: um backup por dia no horario `BACKUP_TIME`.

Variaveis no `.env`:

| Variavel | Padrao | Uso |
|---|---|---|
| `BACKUP_TIME` | `02:30` | horario diario `HH:MM` |
| `TZ` | `America/Sao_Paulo` | fuso do horario acima |
| `BACKUP_KEEP_DAYS` | `14` | apaga conjuntos com mais de N dias (`0` desliga) |
| `BACKUP_HOST_DIR` | `./backups` (em `infra/docker/`) | pasta do servidor onde ficam os conjuntos |
| `BACKUP_PASSPHRASE` | vazia | se definida, cifra `postgres.dump` e o `env` com `openssl enc -aes-256-cbc -pbkdf2 -iter 200000` |
| `BACKUP_INCLUDE_ENV` | `false` | `true` copia o `.env` (recusado sem `BACKUP_PASSPHRASE`) |

Cada execucao cria `backups/cybereyes-AAAAMMDD-HHMMSS/` (primeiro como `.partial`; so ganha o nome final se tudo deu certo). O script:
1. roda `pg_dump -Fc` e valida o arquivo com `pg_restore --list` (falha se nao houver dados de nenhuma tabela);
2. cifra, se `BACKUP_PASSPHRASE` existir;
3. grava `SHA256SUMS`, aplica a retencao e atualiza `backups/.last-success` com a data UTC.

Qualquer erro encerra com codigo diferente de zero e mensagem `ERRO:` no log; no modo diario o servico registra a falha e tenta de novo no proximo horario.

Acompanhar:
```bash
cd infra/docker
docker compose logs --tail 20 backup
cat backups/.last-success          # data UTC do ultimo backup completo
ls -lt backups/ | head
```

Backup manual (por exemplo, antes de uma atualizacao):
```bash
cd infra/docker
docker compose exec backup backup.sh
```

### Copia para fora da VPS
O backup na propria VPS nao protege contra perda da VPS. Copie a pasta `backups/` todo dia para outro provedor ou armazenamento de objetos (por exemplo `rsync` ou `rclone` agendado no cron do host). Essa copia ainda nao esta automatizada no projeto.

## Restauracao (`infra/docker/backup/restore.sh`)
O script roda no host, usa `docker compose` e precisa de `sha256sum` e, para conjuntos cifrados, `openssl` 1.1.1 ou superior (Ubuntu 22.04 e 24.04 ja trazem).

```bash
cd infra/docker
# sem --yes so mostra o que sera sobrescrito e sai com codigo 2
backup/restore.sh backups/cybereyes-20261001-023000
# conjunto cifrado: a senha vem do ambiente
BACKUP_PASSPHRASE='...' backup/restore.sh --yes backups/cybereyes-20261001-023000
```

Opcoes: `-p/--project` (padrao `cybereyes`), `--env-file` (padrao `infra/docker/.env`), `--no-start`. Arquivos extras do Compose podem ir em `COMPOSE_FILE`.

Ordem do que o script faz:
1. confere `SHA256SUMS`;
2. decifra (se preciso) em uma pasta temporaria e valida o dump com `pg_restore --list`. Senha errada ou arquivo ruim param aqui, **antes** de tocar no stack;
3. para `api`, `nginx` e `backup`;
4. sobe o `postgres` e espera ele responder por TCP (no primeiro boot o servidor temporario do initdb so responde pelo socket);
5. apaga e recria o banco `cybereyes` (`DROP DATABASE ... WITH (FORCE)`) e roda `pg_restore --no-owner --exit-on-error`;
6. sobe o stack (`docker compose up -d`), a menos que `--no-start` seja usado.

A copia do `.env` dentro do conjunto **nao** e aplicada. Para recupera-la:
```bash
BACKUP_PASSPHRASE='...' openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_PASSPHRASE -in backups/cybereyes-AAAAMMDD-HHMMSS/env.enc -out .env.restaurado
```

### Restauracao em VPS nova (RTO)
1. Prepare a VPS como em `instalacao.md` (Docker, firewall, repositorio clonado).
2. Restaure o `.env` do cofre de senhas (ou do `env.enc` do conjunto) em `infra/docker/.env`. Mantenha os mesmos `POSTGRES_PASSWORD`, `VAULT_KEY` e `NATS_API_PASSWORD`.
3. Copie o conjunto de backup para `infra/docker/backups/`.
4. `docker compose pull` (ou `build`) para ter as imagens.
5. `backup/restore.sh --yes backups/<conjunto>` (com `BACKUP_PASSPHRASE` se cifrado).
6. Valide: `docker compose ps` (todos `healthy` ou `Up`), `curl -fsS https://CYBEREYES_HOST/health`, login no console, um agente ficando online.
7. Se o IP mudou, ajuste o DNS. Os agentes reconectam sozinhos quando o nome volta a apontar para a VPS.

## Teste real (2026-10-01)
Executado neste ambiente de desenvolvimento, antes da renomeacao para Cybereyes (por isso os nomes de projeto antigos), contra o stack `wincare` em uso (um agente real conectado), restaurando em projetos Compose separados (`wincare-restore` e `wincare-restore2`) sem portas publicadas e removidos ao final.

| Etapa | Resultado |
|---|---|
| Backup sem cifragem do stack `wincare` (banco de 13 MB) | dump de 232 KB, 66 tabelas com dados, 1 s |
| Backup cifrado com `.env` incluido | `*.enc` com cabecalho `Salted__`; `env.enc` decifrado com o comando acima ficou identico ao `.env` |
| `BACKUP_INCLUDE_ENV=true` sem senha | recusado, codigo 1 |
| Restauracao sem `--yes` | so o aviso, codigo 2 |
| Restauracao com senha errada | parou em "falha ao decifrar postgres.dump", codigo 1, stack de destino intacto |
| Restauracao sem cifragem em projeto novo (banco vazio, primeiro boot do PostgreSQL) | 4,6 s |
| Restauracao cifrada sobre o projeto anterior, com a API rodando | 4,2 s; API (2 replicas) saudavel 12,8 s depois de subir |
| `/health` da API restaurada (via `wget` dentro da rede do projeto) | `{"status":"Healthy"}`; migrate: "No migrations were applied" |
| Volumes do MeshCentral (historico, removidos na fase 12.8): backup de um MeshCentral inicializado (11,8 MB compactado) e restauracao cifrada em um terceiro projeto | 23 arquivos com hash identico, dono `1000:1000`; MeshCentral subiu sem gerar certificados novos |

Contagem de linhas, origem x restaurado:

| Tabela | Origem | Restaurado |
|---|---|---|
| agents | 1 | 1 |
| clients | 1 | 1 |
| tickets | 7 | 7 |
| system_logs | 30 (recebidos ate o instante do dump) | 30 |
| snmp_devices | 2 | 2 |
| alert_templates | 0 | 0 |
| "AspNetUsers" | 1 | 1 |
| data_protection_keys | 2 | 2 |
| tabelas no schema public | 68 | 68 |

`system_logs` cresce sem parar no stack de origem (o agente envia logs), por isso a comparacao usa as linhas com `ReceivedAt` ate o maior valor presente no banco restaurado.

Carga sintetica para estimar o tempo com volume maior: banco de 486 MB (2 milhoes de linhas em uma tabela sem indices) gerou dump de 94 MB em 11,2 s e `pg_restore` em 7,8 s. Tabelas reais com indices restauram mais devagar; trate o numero como ordem de grandeza.

Leitura do RTO: com os dados atuais a restauracao em si leva segundos. Na VPS nova o tempo e dominado por preparar a maquina, instalar o Docker, baixar as imagens, copiar o backup e propagar o DNS. A meta de 2 h parece folgada, mas **o ensaio completo em VPS nova ainda nao foi feito**; faca-o antes da entrada em producao e registre o tempo aqui.

## Limites conhecidos
- A cifragem e AES-256-CBC sem autenticacao (o formato pedido de `openssl enc`). O `SHA256SUMS` fica no mesmo conjunto: detecta corrupcao, nao adulteracao proposital.
- O backup nao copia nada para fora da VPS.
- RPO de ate 24 h (um backup por dia). WAL continuo fica para depois, como no `.team-context.md`.

## Rotina
- Toda semana: conferir `backups/.last-success` e a copia externa.
- Todo trimestre: restaurar o ultimo conjunto em uma VPS temporaria e registrar o tempo.
