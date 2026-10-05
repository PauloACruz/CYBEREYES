# ADR-019: Renomeacao para Cybereyes

- **Status**: Aprovado
- **Data**: 2026-10-01

## Contexto
- "WinCare Platform" era um nome provisorio (`.team-context.md`). O produto passa a se chamar **Cybereyes**, e o repositorio no GitHub ja se chama `PauloACruz/CYBEREYES`.
- "WinCare" tambem e o nome da suite PowerShell WinCare Pro. Os modulos de manutencao dela foram fundidos no agente Go na fase 7 (ADR-007 e ADR-016) e apareciam no console com o nome "WinCare".
- O nome antigo aparecia em tres tipos de lugar:
  - nomes deste repositorio (projetos .NET, rotas e eventos do console, permissao, tabelas, cookies, infra), que podem mudar;
  - nomes fixados pelo agente Go e pelo app de bandeja, que ficam no repositorio externo `rmmagentwincare` e so mudam com um release novo do agente;
  - identificadores criptograficos e registros historicos: trocar os primeiros destruiria dados, e trocar os outros reescreveria o passado.
- Nao ha instalacao em producao: o plano de migracao das 400 estacoes nao foi executado.

## Decisoes
1. **Nome do produto "Cybereyes"** nos textos, na documentacao, nos projetos e na infra. Nesta fase o nome fica fixo no codigo. Nome, logotipo e cores configuraveis (white-label) sao a parte de identidade visual da fase 10 (`docs/PLANO.md`), que tera ADR proprio.
2. **Abreviacao `ce`** onde um identificador interno abreviava o nome do produto e nao e contrato:
   - tipos de claim `wc_*` viram `ce_*`;
   - o prefixo das chaves de API `wc_` vira `ce_`;
   - os usuarios dos tecnicos no MeshCentral `wc-<usuario>` viram `ce-<usuario>`;
   - as variaveis CSS `--wc-*` viram `--ce-*`;
   - nos dados de teste, `wc-host` vira `ce-host`.
3. **Modulo de manutencao "Cybereyes Care"**: nome visivel fixo, escolhido pelo usuario, que nao acompanha o branding configuravel.
   - O texto fica num unico lugar em cada ponta: `CareModule.CareDisplayName` no backend (`backend/src/Cybereyes.Core/Rmm/Care.cs`) e `CARE_NAME` no frontend (`frontend/src/features/care/careFormat.ts`).
   - Os identificadores usam o prefixo `Care`. No backend: `CareService`, `CareEndpoints`, `CareRun`, `CareRunEvent`, `CareRunStatus`, `CareRunDto`, `CareEventConsumer` e `Permissions.CareRun`. No frontend: `CareTab`, `careApi`, `features/care/` e `api/care.ts`.
   - Por convencao, nenhum tipo se chama so `Care`, para nao colidir com um eventual namespace `Care` (o CA1724 nao esta ativo no `latest-recommended`, entao o build nao acusa). A pasta `Rmm/Maintenance` do backend mantem o nome.
4. **Contrato com o agente e com o app de bandeja inalterado.**
   - Os literais ficam em `AgentContract` (`backend/src/Cybereyes.Api/Rmm/AgentContract.cs`), que o codigo de producao usa, e um teste unitario fixa os valores.
   - O agente falso dos testes de integracao continua usando os literais, e nao as constantes. Assim, uma troca acidental das constantes quebra os testes.
5. **Identificadores criptograficos inalterados.** Ficam centralizados em `DataProtectionNames` (`backend/src/Cybereyes.Api/Infrastructure/DataProtectionNames.cs`), com um teste que fixa os quatro valores. Esses valores nunca podem ser ligados ao nome configuravel da marca.
6. **Migration `Fase10RenomeiaCare`** para as tabelas do modulo, preservando os dados.
   - Usa so `RenameTable`, `RenameIndex` e a troca de nomes de PK, AK e FK. Nao ha `DropTable` nem `CreateTable`.
   - Um SQL complementar renomeia as duas sequencias identity, troca a permissao gravada nos papeis (`wincare.run` por `care.run`, sem duplicar quando o papel ja tem `care.run`) e substitui as tres acoes de auditoria antigas pelas novas.
   - O `Down` faz o inverso.
7. **Infra tratada como instalacao nova**, porque nao ha producao: projeto Compose, volumes, banco e MeshCentral novos (ver "Impacto em instalacoes existentes").
   - O compose exige a variavel nova com `${CYBEREYES_HOST:?defina CYBEREYES_HOST no .env}`.
   - Um `.env` antigo, so com a variavel anterior, faz falhar o `docker compose config -q` (passo "Validar docker-compose" do CI) e o `up`.
   - Antes, uma variavel esquecida so gerava aviso. O Nginx nao subia, porque o script de certificados aborta sem o host, e a API ficava com `App__PublicUrl` igual a `https://`.

## De/para
| Area | Antes | Depois |
|---|---|---|
| Produto | WinCare Platform; "WinCare" nos textos do console, e-mails e PDFs | Cybereyes |
| Solucao e projetos .NET | `WinCare.slnx`, `WinCare.Api`, `WinCare.Core`, `WinCare.Api.Tests` (pastas, namespaces, assembly `WinCare.Api.dll`) | `Cybereyes.slnx`, `Cybereyes.Api`, `Cybereyes.Core`, `Cybereyes.Api.Tests` (`Cybereyes.Api.dll`) |
| Outros identificadores do backend | `WinCareDbContext` (e o snapshot), `WinCareClaims`, `AddWinCareAuth`, `WinCarePolicyProvider` | `CybereyesDbContext` (`CybereyesDbContextModelSnapshot`), `CybereyesClaims`, `AddCybereyesAuth`, `CybereyesPolicyProvider` |
| Claims e chaves de API | tipos de claim `wc_*`; prefixo das chaves `wc_` | `ce_*`; `ce_`. As chaves ja emitidas continuam validas, porque a autenticacao compara o hash da chave inteira |
| Sessao | cookies `wincare.auth`, `wincare.2fa` e `wincare.sso`; esquema de autenticacao `WinCare` | `cybereyes.auth`, `cybereyes.2fa` e `cybereyes.sso`; esquema `Cybereyes` |
| 2FA | emissor TOTP `WinCare` | `Cybereyes`, com `Uri.EscapeDataString` tambem no parametro `issuer` |
| Textos gerados pelo servidor | assuntos `[WinCare] ...`, rodape do PDF `WinCare - ...`, "Teste de webhook do WinCare" | `[Cybereyes] ...`, `Cybereyes - ...`, "Teste de webhook do Cybereyes" |
| Scripts de instalacao do agente | `/tmp/wincare-agent`, `wincare-agent-setup.exe`, "Instalador do agente WinCare para Linux", `Description=WinCare Agent` | `/tmp/cybereyes-agent`, `cybereyes-agent-setup.exe`, "Instalador do agente Cybereyes para Linux", `Description=Cybereyes Agent`. A unit continua `tacticalagent.service` |
| Recursos internos | fontes embutidas `WinCare.Fonts.*`; prefixo de canal do Redis `wincare`; locks `hashtext('wincare-log-partitions')` e `hashtext('wincare-log-rules')` | `Cybereyes.Fonts.*`; `cybereyes`; `cybereyes-log-partitions` e `cybereyes-log-rules` |
| NATS | usuario da API, nome da conexao e grupos de fila `wincare-api` | `cybereyes-api` |
| Modulo de manutencao | "WinCare" (aba `?aba=wincare`, tag OpenAPI `WinCare`) | "Cybereyes Care" (`?aba=care`, tag `Cybereyes Care`) |
| Rotas do console | `/api/agents/{id}/wincare/catalog`, `/api/agents/{id}/wincare/runs` (GET e POST), `/api/wincare/runs/{runId}`, `/api/wincare/runs/{runId}/cancel`, `/api/wincare/self-service` (GET e PUT) | `/api/agents/{id}/care/catalog`, `/api/agents/{id}/care/runs`, `/api/care/runs/{runId}` (tambem no `Location` do 202), `/api/care/runs/{runId}/cancel`, `/api/care/self-service` |
| Tipos do modulo | `WinCareService`, `WinCareEndpoints`, `WinCareEventConsumer`, `WinCareRun`, `WinCareRunEvent`, `WinCareRunStatus`, `WinCareRunDto` | `CareService`, `CareEndpoints`, `CareEventConsumer`, `CareRun`, `CareRunEvent`, `CareRunStatus`, `CareRunDto` |
| Permissao | `wincare.run` | `care.run` ("Executar e cancelar modulos de manutencao do Cybereyes Care") |
| SignalR do console (`/hubs/console`) | eventos `wincareEvent` e `wincareRunChanged`; metodos `JoinWinCareRun` e `LeaveWinCareRun`; grupo `wincare:{runId}` | `careEvent` e `careRunChanged`; `JoinCareRun` e `LeaveCareRun`; `care:{runId}` |
| Auditoria | `agent.wincare-run`, `agent.wincare-cancel`, `wincare.self-service` | `agent.care-run`, `agent.care-cancel`, `care.self-service` |
| Tabelas | `wincare_runs` e `wincare_run_events`, com PK, AK, FK, indices e sequencias | `care_runs` e `care_run_events` |
| Frontend | pacote `wincare-frontend`, `<title>WinCare</title>`, `src/features/wincare/`, `src/api/wincare.ts`, `WinCareTab`, variaveis CSS `--wc-*`, favicon com a letra W | `cybereyes-frontend`, `<title>Cybereyes</title>`, `src/features/care/`, `src/api/care.ts`, `CareTab`, `--ce-*`, simbolo da Cybereyes (`favicon.svg`, `favicon.ico` e `apple-touch-icon.png`) |
| Projeto Compose e imagens | `name: wincare` (volumes, redes e conteineres `wincare_*`); imagens `wincare-api`, `wincare-web`, `wincare-backup`, `wincare-meshcentral` e `wincare-nginx` | `name: cybereyes` (`cybereyes_*`); `cybereyes-api`, `cybereyes-web`, `cybereyes-backup`, `cybereyes-meshcentral` e `cybereyes-nginx` |
| Host do console | variavel `WINCARE_HOST` | `CYBEREYES_HOST` (obrigatoria no compose) |
| PostgreSQL | banco e usuario `wincare` | `cybereyes` |
| Desenvolvimento local | conteiner `wincare-pg`; `Database=wincare;Username=wincare;Password=wincare_dev` | `cybereyes-pg`; `Database=cybereyes;Username=cybereyes;Password=cybereyes_dev` |
| MeshCentral | administrador `wincare`, grupo `WinCare`, marcador `.wincare-admin`, e-mail padrao `wincare@localhost`, titulo `WinCare` | `cybereyes`, `Cybereyes`, `.cybereyes-admin`, `cybereyes@localhost`, `Cybereyes` |
| Nginx | upstreams e zonas `wincare_*`; cache TLS `WINCARESSL`; scripts `wincare-certs.sh`, `15-wincare-certs.sh` e `90-wincare-reload.sh` | `cybereyes_*`; `CYBEREYESSSL`; `cybereyes-certs.sh`, `15-cybereyes-certs.sh` e `90-cybereyes-reload.sh`. O filtro do envsubst passa a ser `^(CYBEREYES_HOST\|MESH_HOST)$` |
| Backup | conjuntos `wincare-AAAAMMDD-HHMMSS`; `restore.sh` com projeto, banco e usuario `wincare` | `cybereyes-AAAAMMDD-HHMMSS`; `cybereyes` |

## Excecoes: o que nao muda e por que
| O que fica | Por que |
|---|---|
| Comandos NATS `wincare_catalog`, `wincare_run`, `wincare_cancel` e `wincare_health`, com payloads e respostas | O agente 2.12.0 ou superior so atende esses nomes. Trocar quebraria catalogo, execucao, cancelamento e Health Check sem nenhum erro de compilacao |
| Prefixo `wc-` do `run_id` (`^wc-[0-9a-f]{32}$`), assunto `<agent_id>.cmdoutput.<run_id>`, status, chaves de modulo e tarefa, codigo `AGENT_BUSY` | O servidor gera o `run_id` e filtra os eventos pelo prefixo. O agente recusa qualquer outro formato |
| `source: "wincare-agent"` nas entradas de log | Valor enviado pelo agente. O servidor compara esse valor para deixar passar o aviso de eventos descartados |
| Rotas `/api/v3/*`, `/api/v4/*` e `/api/tray/*` (inclusive `/api/tray/self-service`, `/run` e `/runs/{runId}`), hub `/hubs/tray`, esquema `Tray `, evento `selfServiceChanged` e campos dos DTOs da bandeja | Contrato com o agente e com o app de bandeja. As rotas da bandeja sao servidas pelo modulo renomeado, mas os caminhos e os campos ficam iguais |
| Repositorio `rmmagentwincare`, URL de download dos releases (`https://github.com/PauloACruz/rmmagentwincare/releases/download`), arquivos `tacticalagent-v*` e binario `wincare-tray` | Nomes reais do repositorio externo e dos artefatos que ele publica |
| Caminhos `tacticalagent`, `tacticalrmm` e `tacticalmesh` e o servico `tacticalagent.service` nos scripts de instalacao | Fixos no agente |
| Textos com "WinCare" que chegam do agente (catalogo, eventos das execucoes) | Sao dados do agente: o servidor nao os reescreve |
| `SetApplicationName("WinCare")` e os purposes `WinCare.Settings.Smtp`, `WinCare.Deployments.Token` e `WinCare.Sso.State` do Data Protection | Cifram dados ja gravados: senha do SMTP, tokens das implantacoes, estado do SSO e cookies. Trocar os tornaria ilegiveis, com o mesmo efeito da perda das chaves (`docs/runbooks/segredos.md`) |
| MigrationIds, classes, arquivos e corpo das migrations existentes (por exemplo `20261001134552_Fase7WinCare`) | O `__EFMigrationsHistory` guarda os IDs: renomear faria o EF reaplicar migrations. O corpo descreve o passado. So mudam namespace, usings, `[DbContext(typeof(CybereyesDbContext))]` e os nomes de tipo de entidade nos `Designer.cs` e no snapshot, necessarios para compilar e para o EF enxergar o rename |
| Registros de testes reais nos docs (usuario `wc-admin` no ADR-013; stack `wincare` em `docs/runbooks/backup-restauracao.md`) e as citacoes do WinCare Pro como suite de origem | Fatos historicos: reescreve-los seria enganoso |

## Impacto em instalacoes existentes
So existem ambientes de teste, porque nao ha producao. Num servidor que ja rodava o stack com os nomes antigos:
- **Projeto Compose**:
  - `name: cybereyes` muda o prefixo de todos os volumes (`postgres_data`, `mesh_data`, `mesh_files`, `mesh_shared`, `nats_auth`, `letsencrypt`, `certbot_webroot` e `redis_data`), das redes e dos conteineres.
  - Sem migracao, o `up` cria uma instalacao vazia ao lado da antiga: banco vazio (os agentes nao autenticam), MeshCentral com certificados novos (os MeshAgents instalados deixam de conectar) e `letsencrypt` vazio.
  - Com o `letsencrypt` vazio, o Certbot emite os certificados de novo. O Let's Encrypt limita a 5 certificados duplicados por semana.
- **Rede `edge`**: tem sub-rede fixa (`172.30.0.0/24`). Enquanto a rede do projeto antigo existir, o `up` do projeto novo falha com `Pool overlaps with other one on this address space`. Pare o projeto antigo antes (`docker compose down`, sem `-v`).
- **PostgreSQL**: `POSTGRES_DB` e `POSTGRES_USER` so valem quando o volume e criado. Num volume antigo, o banco e o usuario continuam com o nome anterior, e por isso o caminho e backup e restauracao (roteiro abaixo).
- **`.env`**:
  - renomeie a variavel do host para `CYBEREYES_HOST` (o compose recusa subir sem ela) e troque `NATS_API_USER` para `cybereyes-api`;
  - as copias do `.env` guardadas em conjuntos de backup antigos (`BACKUP_INCLUDE_ENV`) ou no cofre de senhas tambem tem os nomes antigos.
- **Imagens**:
  - o CI passa a publicar `ghcr.io/pauloacruz/cybereyes-*`. Sao pacotes novos, privados por padrao, entao a VPS precisa de `docker login ghcr.io`;
  - os pacotes `wincare-*` publicados antes ficam orfaos no GitHub;
  - a imagem do Nginx continua sendo construida na VPS e precisa ser reconstruida (`docker compose build nginx`), porque os scripts e o filtro do envsubst mudaram.
- **Backup**: a retencao do `backup.sh` filtra pelo prefixo (`cybereyes-*`), entao os conjuntos antigos ficam em `backups/` ate serem apagados a mao. O `restore.sh` restaura conjuntos antigos normalmente.
- **Sessoes e 2FA**:
  - os cookies novos desconectam todos os tecnicos, que so precisam entrar de novo;
  - logins SSO em andamento falham;
  - contas de 2FA ja cadastradas continuam validas, com o rotulo antigo no aplicativo autenticador.
- **Agentes instalados** nao sao afetados se o nome DNS (agora em `CYBEREYES_HOST`) continuar o mesmo.
- **Integracoes por chave de API**: as que chamavam as rotas antigas do modulo (`.../wincare/...`) precisam passar a usar `.../care/...`.
- **Desenvolvimento local**:
  - o README cria o conteiner `cybereyes-pg` com banco, usuario e senha iguais aos do `appsettings.Development.json`;
  - um conteiner de desenvolvimento antigo continua utilizavel passando a string de conexao por variavel de ambiente (`ConnectionStrings__Default`).

### Roteiro para quem tiver dados a preservar
Os comandos rodam em `infra/docker`. Copie o conjunto de backup para fora da VPS antes de comecar.
```bash
# 1. Ainda no checkout antigo: backup manual e parada do projeto antigo (sem -v: os volumes ficam)
docker compose exec backup backup.sh         # gera backups/wincare-AAAAMMDD-HHMMSS
docker compose down

# 2. Codigo novo e .env
git pull
sed -i -e 's/^WINCARE_HOST=/CYBEREYES_HOST=/' -e 's/^NATS_API_USER=wincare-api$/NATS_API_USER=cybereyes-api/' .env
grep -E '^MESH_(USER|DEVICE_GROUP)=' .env    # com MeshCentral a preservar: wincare e WinCare (ver abaixo)
docker compose config -q && echo ok

# 3. Imagens
docker compose pull --ignore-pull-failures
docker compose build nginx

# 4. Restauracao no projeto novo (padrao: cybereyes), sem subir o stack.
#    Como root: o servico backup grava os conjuntos como root, com permissao 700/600.
sudo backup/restore.sh --no-start --yes backups/wincare-AAAAMMDD-HHMMSS

# 5. Subida: o servico migrate aplica a Fase10RenomeiaCare
docker compose up -d
docker compose ps
curl -fsS "https://$(sed -n 's/^CYBEREYES_HOST=//p' .env)/health"
```
- **Banco**: o `restore.sh` cria o banco `cybereyes` com o dono `cybereyes` e restaura com `pg_restore --no-owner`. As migrations nao tem `GRANT` nem `OWNER`, entao o dono antigo do dump nao importa (ensaiado, ver "Validacao"). Num conjunto cifrado, passe a senha para o processo como root: `sudo BACKUP_PASSPHRASE='...' backup/restore.sh ...`.
- **MeshCentral**:
  - Para os MeshAgents ja instalados continuarem no acesso remoto, mantenha no `.env` `MESH_USER=wincare` e `MESH_DEVICE_GROUP=WinCare`, a conta e o grupo que existem no `mesh_data` restaurado.
  - A API procura o grupo pelo nome e cria outro, vazio, se nao achar: com o padrao novo, os tecnicos so ganhariam direitos no grupo novo. Para trocar o nome do grupo depois, renomeie-o no MeshCentral e so entao mude `MESH_DEVICE_GROUP`.
  - O entrypoint novo procura o marcador `.cybereyes-admin`. Como ele nao existe no `mesh_data` antigo, o entrypoint roda de novo `--createaccount` e `--adminaccount` com o `MESH_USER`.
  - Com a conta ja existente, o MeshCentral responde `User already exists.`, sai com codigo 0 e o entrypoint grava o marcador novo. Isso foi conferido no codigo do MeshCentral 1.2.5, sem executar.
  - A sincronizacao passa a criar `ce-<usuario>` para os tecnicos. As contas `wc-*` antigas, criadas com senha aleatoria, ficam fora da sincronizacao e ainda com direitos no grupo. Remova-as pela interface do MeshCentral com um administrador do servidor.
- **Limpeza**: depois de validar (console, um agente online e acesso remoto), apague os volumes do projeto antigo e os conjuntos `backups/wincare-*` que ja estiverem fora da VPS. Para listar os volumes antigos: `docker volume ls --filter label=com.docker.compose.project=wincare`.

## O que continua mostrando "WinCare"
Esses textos so mudam com um release novo do agente e do app de bandeja, que ficam no repositorio `rmmagentwincare`.

**App de bandeja**:
- nome do aplicativo, titulo da janela, dica e menu do icone ("Abrir WinCare"), titulo das notificacoes e mensagens de erro;
- binario `wincare-tray` e identificador `br.com.wincare.tray`;
- entradas de inicio automatico: valor `WinCareTray` na chave Run do Windows, `wincare-tray.desktop` no Linux, LaunchAgent e `WinCare.app` no macOS;
- canal local com o agente (`\\.\pipe\wincare-tray`, `/run/wincare-tray.sock`, `/var/run/wincare-tray.sock`);
- artefato de release `wincare-tray-v*`.

**Agente**:
- pasta `%ProgramData%\WinCare` (backups e relatorios), pastas temporarias `wincare-<hex>` e tarefas agendadas `WinCare-<guid>`;
- ponto de restauracao "WinCare - Pre-manutencao", aviso de reinicio ao usuario e relatorios `WinCare_*`;
- estado em `/var/lib/wincare-agent`, `source` `wincare-agent` nos logs;
- catalogo `agent/wincare/catalog.json`, marcador `##WC` e variaveis `WINCARE_*` dos scripts embutidos;
- titulo dos releases.

**No console**: esses textos aparecem como dados nas descricoes do catalogo, nas mensagens das execucoes e na origem dos logs.

**Fora do agente**:
- o rotulo das contas de 2FA ja cadastradas nos autenticadores;
- os PDFs de relatorio ja gerados (guardados por 90 dias);
- os textos livres de auditoria ja gravados;
- a descricao da unit `tacticalagent.service` nos agentes Linux instalados antes da troca, que so muda ao reinstalar.

## Validacao
Infra e roteiro, em 2026-10-01, com conteineres e projetos temporarios `cy-test-*` removidos ao final:
- **Compose**:
  - `docker compose config -q` com o `.env` copiado do `.env.example` passou;
  - os valores interpolados foram conferidos: projeto `cybereyes`, imagens `cybereyes-*`, `App__PublicUrl`, banco e usuario, `Mesh__Username` e `Mesh__DeviceGroup`;
  - sem `CYBEREYES_HOST`, ou com um `.env` que so tem a variavel antiga, falha com `required variable CYBEREYES_HOST is missing a value: defina CYBEREYES_HOST no .env`, inclusive quando so um servico e selecionado.
- **Nginx**:
  - imagem de teste montada com as linhas `COPY` e `ENV` do `nginx/Dockerfile` sobre `nginx:alpine`, sem o `apk add`, que precisaria de rede, e com certificados de teste em `custom-certs`;
  - `nginx -t` passou com `CYBEREYES_HOST` e `MESH_HOST` de teste. A configuracao renderizada traz `server_name`, `ssl_certificate`, a CSP com `wss://` do host e os upstreams `cybereyes_*`;
  - com o filtro antigo, falha com `unknown "cybereyes_host" variable`;
  - sem a variavel, o `cybereyes-certs` aborta (`parameter not set`).
- **Scripts**:
  - `sh -n` e `bash -n` passaram em todos os scripts de `infra/`, e o `sh -n` do busybox passou nos que rodam em imagens alpine;
  - o `config.json` gerado pelo entrypoint do MeshCentral e JSON valido, com o titulo `Cybereyes`.
- **Ensaio do roteiro**, no projeto `cy-test-restore`:
  - **origem**: banco com nome e dono `wincare`, com identity, FK, AK, `text[]` com `wincare.run`, tabela particionada com particao padrao e chaves do Data Protection;
  - **backup**: o `backup.sh` novo gerou o conjunto `cybereyes-AAAAMMDD-HHMMSS`;
  - **restauracao**: o `restore.sh --no-start` novo restaurou o banco `cybereyes` em 4 s, com todas as tabelas do usuario `cybereyes` e contagens iguais;
  - **depois da restauracao**: um `INSERT` novo usou a sequencia identity, e o `mesh_data` voltou com dono 1000, num volume com os rotulos do Compose.

## Limites conhecidos
- O CI continua sem construir a imagem do Nginx e sem rodar `nginx -t`. Um erro no filtro do envsubst ou nos nomes dos scripts so apareceria na VPS; a validacao acima foi manual.
- A imagem `cybereyes-meshcentral` usa como tag so a versao do MeshCentral (1.2.5). Uma mudanca no entrypoint publica conteudo diferente com a mesma tag.
- Do roteiro com dados, foram ensaiados so o banco e os volumes. A subida completa nao foi ensaiada: MeshCentral com `mesh_data` real, MeshAgents e agentes conectados.
- As contas `wc-*` antigas no MeshCentral nao sao removidas pela sincronizacao.
- Os pacotes `wincare-*` antigos no GHCR precisam ser apagados a mao.
