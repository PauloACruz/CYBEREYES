# Runbook: incidentes comuns

Todos os comandos rodam em `infra/docker` na VPS. Primeiro passo de qualquer incidente:
```bash
docker compose ps
curl -fsS https://CYBEREYES_HOST/health
df -h / /var/lib/docker
free -m
```

## Console fora do ar
Sintoma: navegador nao abre `https://CYBEREYES_HOST` ou mostra 502/504.

1. `docker compose ps nginx web api`. Se o `nginx` nao estiver `Up`: `docker compose logs --tail 50 nginx` (erro de template ou de certificado aparece aqui) e `docker compose up -d nginx`.
2. 502 em `/`: o `web` esta fora. `docker compose logs --tail 50 web` e `docker compose up -d web`.
3. 502 em `/api` ou `/health`: ver "API em loop de reinicio".
4. Nada responde nem na porta 80: firewall do provedor, `sudo ufw status`, IP e DNS (`dig +short CYBEREYES_HOST`).

## API em loop de reinicio
Sintoma: `api` com `Restarting` ou `unhealthy`; `/health` com 502 ou `{"status":"Unhealthy"}`.

```bash
docker compose logs --tail 100 api | grep -E '"LogLevel":"(Error|Critical)"'
docker compose logs migrate
docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}}' $(docker compose ps -q api)
```
| Causa | Acao |
|---|---|
| Banco fora ou senha errada (`ConnectionStrings:Default`) | ver secao do banco; conferir `POSTGRES_PASSWORD` no `.env` |
| `migrate` falhou (a API nem sobe) | ler `docker compose logs migrate`; se a migracao da versao nova falhou, reverter (ver `atualizacao.md`) |
| Redis com senha diferente (`WRONGPASS` ou `NOAUTH` no log) | `REDIS_PASSWORD` do `.env` e o mesmo para `redis` e `api`: `docker compose up -d redis api` |
| `OOMKilled true` | a replica passou de `mem_limit` (1g). Verifique o que consumiu memoria (relatorio grande, exportacao) e, se for uso legitimo, aumente o limite no compose |
| Erro de escrita em disco somente leitura | a raiz da API e `read_only`; so `/tmp` e gravavel. Codigo novo que grava em outra pasta precisa de um `tmpfs` ou volume no compose |

## Banco cheio ou disco cheio
Sintoma: erros `could not extend file` ou `No space left on device`; PostgreSQL parado.

```bash
df -h /var/lib/docker
docker system df
docker compose exec -T postgres psql -U cybereyes -d cybereyes -c \
  "select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relkind in ('r','p') and relnamespace='public'::regnamespace order by pg_total_relation_size(oid) desc limit 10"
du -sh backups/
```
Acoes, da mais segura para a mais drastica:
1. Backups antigos na VPS: reduza `BACKUP_KEEP_DAYS` (vale a partir do proximo backup) ou apague conjuntos antigos ja copiados para fora: `rm -rf backups/cybereyes-AAAAMMDD-*`.
2. Imagens e camadas sem uso: `docker image prune -a` (nao apaga volumes).
3. Logs de sistema e amostras SNMP (normalmente as maiores tabelas): ver a proxima secao.
4. Historico de checks e de status dos agentes: reduza `checkHistoryDays` e `agentHistoryDays` nas configuracoes gerais (`PUT /api/settings`); a limpeza roda no servico de manutencao da API e apaga linhas (o espaco volta para o PostgreSQL, nao para o disco, ate um `VACUUM FULL`).
5. Ultimo caso: aumentar o disco da VPS.

Nunca apague arquivos dentro do volume `postgres_data` na mao.

## Logs crescendo demais
Os logs de sistema (`system_logs`) e as amostras SNMP (`snmp_samples`) sao particionados por mes (`<tabela>_pAAAAMM`). A API cria as particoes do mes atual e do proximo e **apaga a particao inteira** quando todo o mes ficou fora da retencao (`retentionDays`, padrao 30, nas configuracoes de logs do console). Consequencias:
- reduzir a retencao so libera espaco quando um mes inteiro sai da janela; com 30 dias, um mes fica guardado ate o fim do mes seguinte;
- a API descarta na entrada eventos mais antigos que a retencao, e o servico de particoes roda a cada hora.

Reduzir o volume que entra (configuracoes de logs no console, `PUT /api/logs/settings`): `minLevel` mais alto (por exemplo so `error`), menos canais em `windowsLogs`, `maxPerCycle` menor, ou desligar a coleta (`enabled: false`) enquanto investiga qual maquina gera mais:
```bash
docker compose exec -T postgres psql -U cybereyes -d cybereyes -c \
  'select "AgentId", count(*) from system_logs where "ReceivedAt" > now() - interval '"'"'1 day'"'"' group by 1 order by 2 desc limit 10'
```
Emergencia de disco: apagar uma particao antiga inteira libera o espaco na hora e e irreversivel (faca backup antes se quiser guardar):
```bash
docker compose exec -T postgres psql -U cybereyes -d cybereyes -c '\d+ system_logs'      # lista as particoes
docker compose exec -T postgres psql -U cybereyes -d cybereyes -c 'DROP TABLE system_logs_p202609'
```
Nao apague a particao do mes atual nem a `_default`.

Logs dos conteineres: o compose limita cada conteiner a 5 arquivos de 10 MB (`logging` no bloco `x-hardening`). Se a VPS tiver outra configuracao no `/etc/docker/daemon.json`, o compose prevalece para estes servicos.

## NATS fora e agentes offline em massa
Sintoma: muitos agentes `offline` ao mesmo tempo; comandos do console sem resposta.

1. `docker compose ps nats` e `docker compose logs --tail 50 nats`. Erro de sintaxe no arquivo de usuarios aparece como falha de `Reloaded` ou na partida.
2. `docker compose up -d nats`. Os agentes reconectam sozinhos pelo `wss://CYBEREYES_HOST/natsws`; a deteccao de offline tem SLO de 5 minutos, a volta segue o mesmo ciclo.
3. Se o NATS esta de pe, mas os agentes nao conectam: teste o caminho do Nginx (`docker compose logs nginx | grep natsws`), o certificado (agente recusa certificado vencido ou autoassinado) e o DNS.
4. Arquivo de usuarios corrompido: a API regrava `/etc/nats/auth/users.conf` a partir do banco na partida e a cada 5 minutos. Para forcar: `docker compose restart api`.
5. Agentes offline so em um site: problema de rede do site (proxy, firewall bloqueando WebSocket), nao do servidor.

## Certificado vencido
Sintoma: navegador e agentes recusam a conexao; `curl -v https://CYBEREYES_HOST` mostra `certificate has expired`.

```bash
echo | openssl s_client -connect CYBEREYES_HOST:443 -servername CYBEREYES_HOST 2>/dev/null | openssl x509 -noout -dates
docker compose logs --tail 50 certbot
```
- Let's Encrypt: confira se o perfil esta ativo (`COMPOSE_PROFILES=letsencrypt`), se a porta 80 esta aberta e se o DNS aponta para a VPS. Force a renovacao: `docker compose exec certbot certbot renew --webroot -w /var/www/certbot`. O Nginx recarrega sozinho em ate 5 minutos; para nao esperar: `docker compose exec nginx nginx -s reload`.
- Certificado proprio: troque os arquivos em `certs/<host>/` e recarregue o Nginx.
- Se nenhum certificado existir, o Nginx usa um autoassinado de 30 dias: os agentes nao aceitam, o que derruba todos de uma vez.

## MeshCentral fora
Sintoma: "Acesso remoto" falha no console; `https://MESH_HOST` com 502.

```bash
docker compose ps meshcentral
docker compose logs --tail 50 meshcentral
docker compose up -d meshcentral
```
- `Permission denied` em `meshcentral-data`: a raiz do volume precisa pertencer ao uid 1000 (`node`). Corrija com `docker run --rm -v cybereyes_mesh_data:/d postgres:17-alpine chown 1000:1000 /d` e suba de novo.
- O console continua funcionando sem o MeshCentral; so o acesso remoto para.
- Depois de restaurar o `mesh_data`, a chave de token em `mesh_shared` precisa ser regravada (o `restore.sh` ja faz isso apagando `mesh_shared/mesh_token`; o MeshCentral grava de novo na partida).

## SMTP falhando
Sintoma: alertas por e-mail nao chegam; `emailSent: false` nos alertas.

1. Use o teste de e-mail das configuracoes do console (`POST /api/settings/test-email`): o erro do servidor SMTP volta na resposta.
2. `docker compose logs api | grep -i smtp`.
3. Causas comuns: senha trocada no provedor, porta 25 bloqueada pela VPS (use 587 com TLS), remetente nao autorizado no provedor, autenticacao basica desativada (Microsoft 365).
4. A senha do SMTP fica protegida pelo Data Protection (chaves no banco). Se as chaves forem perdidas ou trocadas, a senha precisa ser digitada de novo no console.
