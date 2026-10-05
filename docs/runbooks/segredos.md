# Runbook: segredos e rotacao

## Onde ficam
| Segredo | Onde fica | Quem usa | Perda |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `.env` | criacao do volume do PostgreSQL (so no primeiro boot), `migrate`, `api`, `backup` | recuperavel (troca pelo `psql` no conteiner) |
| `REDIS_PASSWORD` | `.env` | `redis` (`--requirepass`), `api` (`ConnectionStrings:Redis`) | sem impacto: gere outra |
| `NATS_API_USER` / `NATS_API_PASSWORD` | `.env`; a API grava o usuario dela em `nats_auth/users.conf` | `api` (`Nats:User`, `Nats:Password`), `nats` | sem impacto: gere outra |
| `VAULT_KEY` | `.env` (fora do banco de proposito) | cofre: credenciais da documentacao, comunidades e senhas SNMP, segredo do cliente OIDC | **irrecuperavel**: segredos do cofre ficam ilegiveis |
| Chaves do Data Protection | banco, tabela `data_protection_keys` (sem cifragem propria) | cookie de sessao, senha do SMTP, tokens das implantacoes, estado do login SSO | sessoes caem; senha SMTP e implantacoes precisam ser refeitas |
| `BACKUP_PASSPHRASE` | `.env` e cofre de senhas da equipe | cifragem dos backups | **backups cifrados com ela ficam ilegiveis** |
| `ADMIN_PASSWORD` | `.env` | `migrate`, so quando o banco nao tem nenhum usuario | sem impacto depois da instalacao |
| Senhas dos agentes no NATS | banco (hash) e `users.conf` | cada agente | regravadas pela API |

Regras:
- `.env` com `chmod 600`, nunca no Git (o `.gitignore` ja cobre), copia no cofre de senhas da equipe.
- Use valores `hex` (`openssl rand -hex 32`) para `POSTGRES_PASSWORD`, `REDIS_PASSWORD` e `NATS_API_PASSWORD`: eles entram em strings de conexao, e `;`, `,` ou `=` quebrariam o formato.
- Quem tem o `postgres.dump` sem cifragem tem tambem as chaves do Data Protection. Cifre o backup que sai da VPS (`BACKUP_PASSPHRASE`).

Depois de qualquer rotacao, confira:
```bash
cd infra/docker
docker compose ps
curl -fsS https://CYBEREYES_HOST/health
docker compose logs --since 2m api | grep -E '"LogLevel":"(Error|Critical)"'
```

## Senha do PostgreSQL
Testado em um projeto de teste restaurado do backup (2026-10-01): API saudavel e backup funcionando com a senha nova.

O `POSTGRES_PASSWORD` do `.env` so e lido pela imagem quando o volume e criado; depois disso a senha vale a que esta no banco. Troque primeiro no banco, depois no `.env`:
```bash
cd infra/docker
NOVA=$(openssl rand -hex 24)
docker compose exec -T postgres psql -U cybereyes -d postgres -c "ALTER USER cybereyes PASSWORD '$NOVA'"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NOVA/" .env
docker compose up -d
```
Entre o `ALTER USER` e o `up -d`, conexoes novas da API com a senha antiga falham; as ja abertas continuam. Faca fora do horario de uso. Atualize o cofre de senhas.

## REDIS_PASSWORD
Testado em projeto de teste (2026-10-01): 20 s ate as duas replicas da API voltarem saudaveis e conectadas ao Redis.
```bash
cd infra/docker
sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$(openssl rand -hex 32)/" .env
docker compose up -d redis api
docker compose exec -T redis redis-cli client list | grep -c SE.Redis   # conexoes da API
```
O Redis guarda so o backplane do SignalR: os navegadores reconectam sozinhos.

## Senha NATS da API (NATS_API_PASSWORD)
Testado em projeto de teste (2026-10-01): a API nova grava o arquivo de usuarios na partida, o NATS recarrega (`Reloaded: authorization users`) e as duas replicas reconectam em poucos segundos. Durante a troca aparecem alguns `authentication error - User "cybereyes-api"` no log do NATS; sao esperados.
```bash
cd infra/docker
sed -i "s/^NATS_API_PASSWORD=.*/NATS_API_PASSWORD=$(openssl rand -hex 24)/" .env
docker compose up -d nats api
docker compose logs --since 2m nats | grep -i reload
```
Os agentes nao sao afetados: cada um tem a propria senha.

## Chaves do Data Protection (sessao)
O ASP.NET Core gira essas chaves sozinho: cria uma chave nova a cada 90 dias e guarda as antigas para continuar lendo o que elas protegeram. Nao ha rotina manual.

Se houver suspeita de vazamento do banco (dump sem cifragem exposto, por exemplo), a unica forma de invalidar as chaves hoje e apaga-las. Nao existe ferramenta no projeto para isso, e o efeito abaixo foi deduzido do codigo, **nao testado**:
- todos os tecnicos sao desconectados;
- a senha do SMTP deixa de ser lida e precisa ser digitada de novo nas configuracoes;
- os links de implantacao existentes deixam de funcionar e precisam ser recriados;
- logins SSO em andamento falham (basta tentar de novo).

```bash
docker compose exec -T postgres psql -U cybereyes -d cybereyes -c 'DELETE FROM data_protection_keys'
docker compose restart api
```
Faca um backup antes. Os segredos do cofre (`VAULT_KEY`) nao dependem dessas chaves.

## VAULT_KEY
Os segredos do cofre sao cifrados com AES-256-GCM usando diretamente a `VAULT_KEY`, num formato com uma unica versao de chave (`v1:`). Consequencias:
- **Trocar a `VAULT_KEY` sem recifrar torna ilegiveis todos os segredos do cofre ja gravados** (credenciais da documentacao, comunidades e senhas SNMP v3, segredo do cliente OIDC).
- **Hoje nao existe ferramenta para recifrar.** Nao ha comando de rotacao no backend nem script no repositorio.

Se a troca for inevitavel (chave vazada), o unico caminho hoje e manual:
1. Faca backup.
2. Levante tudo que esta no cofre e copie os valores para um local seguro e temporario (revelando pelo console, permissao `credentials.reveal`, ou consultando os responsaveis de cada equipamento).
3. Troque `VAULT_KEY` no `.env` e no cofre de senhas, `docker compose up -d api`.
4. Digite de novo cada segredo (credenciais, SNMP, cliente OIDC).
5. Apague a copia temporaria.

Uma ferramenta de recifragem (ler com a chave antiga, gravar com a nova, com identificador de versao da chave) fica registrada como pendencia.

## BACKUP_PASSPHRASE
Trocar e simples (`.env` e `docker compose up -d backup`), mas os conjuntos antigos continuam exigindo a senha antiga. Guarde a senha antiga no cofre ate o ultimo backup cifrado com ela sair da retencao, inclusive na copia externa.

## MeshCentral (removido na fase 12.8)
A chave de token do MeshCentral (`mesh_shared`) e o administrador interno do MeshCentral (`mesh_data`) deixaram de existir com a remocao do MeshCentral (ADR-023). O acesso remoto proprio nao tem segredo fixo no `.env`: os tokens de cada sessao valem 60 s para conectar, sao de uso unico e a API guarda so o SHA-256 (`docs/remoto/contrato-remoto.md`, secao 1). Os volumes antigos, se ainda existirem na VPS, seguem o passo 5 de "Atualizacao que remove o MeshCentral" em `atualizacao.md`.
