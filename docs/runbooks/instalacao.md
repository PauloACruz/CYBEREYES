# Runbook: instalacao em VPS nova

Para restaurar um servidor perdido, siga este runbook ate o passo 5 e depois `backup-restauracao.md`.

## 1. Requisitos
- VPS com 4 vCPU, 8 GB de RAM e 160 GB de SSD para 400 estacoes (estimativa do `docs/PLANO.md`, sem teste de carga).
- Ubuntu Server 24.04 LTS (ou outra distribuicao com Docker Engine e o plugin `docker compose` v2).
- Um nome DNS do tipo A apontando para o IP da VPS: `CYBEREYES_HOST` (console, API, conexao dos agentes e acesso remoto), por exemplo `rmm.suaempresa.com.br`. Desde a fase 12.8 nao existe mais o segundo nome do MeshCentral (`MESH_HOST`, ver ADR-022).
- Saida para a internet liberada (imagens, Let's Encrypt, releases do agente no GitHub, SMTP).

Instalar o Docker (repositorio oficial):
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # saia e entre de novo na sessao
docker compose version
```

## 2. Firewall
Somente SSH, HTTP e HTTPS. Os agentes falam com o NATS por WebSocket seguro em `wss://CYBEREYES_HOST:443/natsws` (o Nginx encaminha para o NATS), entao **nao existe porta separada do NATS para liberar**: a 4222 nao e publicada no host.
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```
Restrinja o SSH ao IP da equipe quando possivel (`sudo ufw allow from <ip> to any port 22 proto tcp` e remova a regra geral).

Atencao: portas publicadas pelo Docker passam por cadeias proprias do iptables e nao sao filtradas pelo ufw. Por isso o compose so publica 80 e 443; PostgreSQL, Redis e NATS ficam apenas nas redes internas do Docker. Confira depois da subida:
```bash
docker compose ps --format '{{.Name}} {{.Ports}}' | grep 0.0.0.0   # so o nginx deve aparecer
```

## 3. Codigo e `.env`
```bash
git clone <repositorio> cybereyes
cd cybereyes/infra/docker
cp .env.example .env
chmod 600 .env
```

Gere os segredos (use estes formatos: hex nao tem caracteres que quebram strings de conexao):
```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "NATS_API_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
echo "VAULT_KEY=$(openssl rand -base64 32)"
echo "BACKUP_PASSPHRASE=$(openssl rand -base64 32)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)"
```
Preencha no `.env`: `CYBEREYES_HOST`, `ACME_EMAIL`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, os valores acima, `REGISTRY`, `VERSION` (deixe `AGENT_VERSION` vazio para distribuir o EYES compilado na imagem da API) e o bloco de backup (`TZ`, `BACKUP_TIME`, `BACKUP_KEEP_DAYS`).

Guarde uma copia do `.env` no cofre de senhas da equipe **antes** da primeira subida. `VAULT_KEY` e `BACKUP_PASSPHRASE` nao podem ser recuperadas se forem perdidas (ver `segredos.md`).

Valide:
```bash
docker compose config -q && echo ok
```

## 4. Certificado
- **Let's Encrypt (padrao)**: `COMPOSE_PROFILES=letsencrypt` no `.env`. O Nginx sobe com certificado autoassinado temporario, o Certbot emite o certificado pelo desafio HTTP (porta 80) e o Nginx recarrega sozinho em ate 5 minutos. A renovacao roda a cada hora.
- **Certificado proprio**: coloque `fullchain.pem` e `privkey.pem` em `certs/<CYBEREYES_HOST>/` e retire `letsencrypt` de `COMPOSE_PROFILES`.

## 5. Primeira subida
```bash
docker compose pull --ignore-pull-failures
docker compose up -d
docker compose ps
```
Imagens que nao existirem no registro sao construidas a partir do repositorio (o CI publica `cybereyes-api`, `cybereyes-web` e `cybereyes-backup`; o `cybereyes-nginx` e construido na VPS).

O servico `migrate` aplica as migracoes e cria o administrador (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) e termina com `Exited (0)`. Os demais devem ficar `Up` ou `healthy` (o `nats` e o `backup` nao tem healthcheck).

```bash
curl -fsS https://CYBEREYES_HOST/health          # {"status":"Healthy"}
curl -sI https://CYBEREYES_HOST/ | grep -i -E 'strict-transport|content-security|x-frame'
docker compose logs --tail 20 certbot          # emissao do certificado
docker compose logs --tail 5 backup            # "proximo backup: ..."
```

## 6. Primeiro login
1. Abra `https://CYBEREYES_HOST` e entre com `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
2. O console exige configurar a verificacao em duas etapas (Google Authenticator, Microsoft Authenticator ou similar). Leia o QR code e confirme o codigo.
3. Troque a senha do administrador pelo console. `ADMIN_PASSWORD` so e usado pelo `migrate` quando o banco ainda nao tem nenhum usuario; depois disso mudar o valor no `.env` nao altera senha nenhuma.
4. Configure o SMTP em Configuracoes > E-mail e rode o teste de e-mail. Ele e usado por alertas, relatorios, convite de usuarios e recuperacao de senha (ADR-021). O envio usa STARTTLS: use a porta 587 (a 465, SSL direto, nao funciona). Para nao cair no spam, publique SPF e DKIM do dominio do remetente.
5. Crie os demais tecnicos em Usuarios com "Enviar convite por e-mail"; cada um define a propria senha e o 2FA.
6. Crie cliente e site; gere uma implantacao e instale um agente de teste.
7. Confira as politicas de acesso remoto em Configuracoes > Acesso remoto e abra a tela do agente de teste pelo console (janela `/acesso-remoto/:agentId`, permissao `agents.remote`; arquivos pedem `agents.files`). O EYES precisa ser 3.1.0 ou mais novo. Nao ha usuario nem login separado para o acesso remoto.

## 7. O que o compose ja aplica (hardening, ADR-018)
| Servico | Usuario | Capacidades (`cap_drop: ALL` + ) | Raiz somente leitura | `mem_limit` |
|---|---|---|---|---|
| nginx | root (workers como nginx) | CHOWN, SETUID, SETGID, NET_BIND_SERVICE, DAC_READ_SEARCH | sim (tmpfs em `/tmp`, `/run`, `/var/cache/nginx`, `/etc/nginx/conf.d`, `/etc/nginx/certs`, `/etc/nginx/selfsigned`) | 256m |
| web | root (workers como nginx) | CHOWN, SETUID, SETGID | sim | 128m |
| api, migrate | app (1654) | nenhuma | sim (tmpfs `/tmp`) | 1g por replica, 512m |
| postgres | postgres (70) | nenhuma | sim (tmpfs `/tmp`, `/var/run/postgresql`) | 1536m |
| redis | redis (999) | nenhuma | sim | 512m |
| nats | root (script entrega o arquivo de usuarios a API) | CHOWN, FOWNER, DAC_OVERRIDE | sim | 512m |
| certbot | root | nenhuma | nao | 256m |
| backup | root | DAC_READ_SEARCH (para ler o `.env` montado quando `BACKUP_INCLUDE_ENV=true`; os volumes do MeshCentral sairam na fase 12.8) | sim | 512m |

Todos com `no-new-privileges`. Soma dos limites com 2 replicas da API: cerca de 5,6 GB (sem o `migrate`, que termina depois de rodar); sao tetos, nao reservas (uso medido em repouso neste ambiente: API cerca de 180 MB por replica, PostgreSQL 40 MB).
