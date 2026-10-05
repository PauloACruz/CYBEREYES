# ADR-020: EYES, agente proprio reescrito do zero

- **Status**: Aprovado
- **Data**: 2026-10-05
- **Substitui**: ADR-003 (agente mantido no repositorio `rmmagentwincare`)

## Contexto
- O agente Go era o `rmmagentwincare`, obra derivada do `amidaware/rmmagent` sob a Tactical RMM License (ver ADR-005). Uso comercial ou como servico de obra derivada exige autorizacao escrita da AmidaWare.
- A distribuicao dependia de releases no GitHub do `rmmagentwincare`. O repositorio so tinha tags, sem arquivos anexados. Na primeira instalacao em producao (2026-10-05), o download do Windows caiu num 404 do GitHub.
- As versoes 2.12.0 (Cybereyes Care e Health Check) e 2.13.0 (logs e SNMP) nunca foram publicadas. Ficaram num branch do repositorio externo.
- Nao havia agentes instalados em producao: nao ha compatibilidade de instalacao a preservar.

## Decisoes
1. **Agente proprio chamado EYES**, mantido em `agent/` neste repositorio. E um binario unico (`eyes`/`eyes.exe`) para Windows, Linux e macOS, nas arquiteturas amd64, 386, arm64 e arm (Linux).
2. **Reescrita limpa (clean room)** a partir da especificacao funcional:
   - a especificacao fica em `docs/agente/contrato-eyes.md`, extraida do backend C# e de `docs/api`;
   - nenhuma linha do `rmmagent`/`rmmagentwincare` foi copiada ou traduzida;
   - as dependencias sao todas permissivas (MIT, BSD, Apache 2.0): nats.go, msgpack, gopsutil, x/sys, x/text, gosnmp, creack/pty, go-ole, wmi, pro-bing, go-winio.
3. **O que veio do repositorio externo foi so autoria propria**:
   - os scripts PowerShell e bash do Cybereyes Care (WinCare Pro) e o `catalog.json`;
   - o app de bandeja (`agent/tray`, renomeado de `wincare-tray` para `eyes-tray`).
4. **Contrato com o servidor mantido**: `/api/v3` + NATS + msgpack, como em `docs/agente/contrato-eyes.md`. Os nomes `wincare_*` e o prefixo `wc-` do `run_id` continuam (ADR-019). O canal local do app de bandeja passa a usar `\\.\pipe\eyes-tray` e `/run/eyes-tray.sock` (`/var/run/eyes-tray.sock` no macOS), porque as duas pontas agora estao aqui.
5. **Versao inicial 3.0.0** (`agent/VERSION`), sem sufixo: o servidor compara versoes com `System.Version`. Isso passa nas travas da 2.12.0 (Health Check) e da 2.13.0 (SNMP).
6. **Distribuicao pelo proprio servidor**:
   - o Dockerfile da API compila o EYES para todas as plataformas (`agent/build.sh`, contexto adicional `agent`) e grava em `/app/agents`, com o arquivo `VERSION`;
   - `/api/agent/download/{plat}/{arch}` serve `eyes-v<versao>-<plat>-<arch>[.exe]`. `infra/docker/agents` (`Agent__BinariesPath`) tem prioridade;
   - nao ha mais redirecionamento para o GitHub: sem binario, a rota responde 404 com mensagem clara.
7. **Instalacao feita pelo proprio EYES** (`eyes install --api ... --site-id ... --auth ...`):
   - copia o binario;
   - instala o MeshAgent via `/api/v3/meshexe/` nas tres plataformas;
   - registra o agente;
   - cria o servico: Windows SCM com reinicio automatico, systemd ou OpenRC no Linux, launchd no macOS.
   - Os scripts do servidor so detectam a arquitetura e baixam o binario. Sem Inno Setup, sem dependencia de systemd no script.
   - Reinstalar sobre uma instalacao existente do mesmo servidor **mantem a identidade** do agente (nao cria duplicata).
   - **MeshAgent sempre junto**, como no Tactical:
     - o EYES baixa o MeshAgent da plataforma e arquitetura (`/api/v3/meshexe/`), ja vinculado ao grupo do Cybereyes;
     - instala com `-fullinstall` no Windows, `-install --installPath=/opt/cybereyes-mesh` no Linux e `-install` no macOS;
     - informa o node id (`meshagent -nodeid --no-embedded=1`, 96 hex) no registro e no `syncmesh`.
   - Um MeshAgent ja instalado so e mantido se apontar para o mesmo servidor e grupo (`MeshServer` e `MeshID` do `.msh`). Um MeshAgent de outro servidor, por exemplo o do Tactical nas estacoes migradas, e removido e substituido.
   - Se o MeshAgent falhar na instalacao ou for removido depois, o servico do EYES o reinstala sozinho, no maximo a cada 30 minutos. So `--nomesh` desliga isso; o servidor acrescenta `--nomesh` ao comando apenas quando o MeshCentral nao esta configurado.
8. **Atualizacao remota**:
   - func `agentupdate`: payload com `version` e `sha256`. O agente baixa da propria API, confere o SHA-256 e a versao do binario novo, troca o executavel e reinicia o servico;
   - console: "Atualizar EYES" no agente e "Atualizar agentes" na lista;
   - automatica a cada 30 min para agentes 3.x desatualizados (`Agent__AutoUpdate`, ligada por padrao, uma replica por vez com lock consultivo).
9. **Versao minima separada da distribuida**: `Agent:MinimumVersion` (padrao 3.0.0) vale para o registro, e `Agent:LatestVersion` (vazio = versao embutida) e a versao distribuida. Corrige o papel duplo apontado na especificacao (secao 9, item 12).
10. **Correcoes no servidor apontadas pela especificacao**:
    - `POST /api/v3/winupdates/` aceita lista vazia;
    - `PATCH taskrunner` aceita `stdout`/`stderr` nao texto;
    - Health Check aceita `score` fracionario;
    - eventos do Care com tipos inesperados nao travam mais a execucao;
    - `meshreinstall` entrega o MeshAgent da plataforma do agente.

11. **Tela em Linux com Wayland**: o MeshAgent nao captura sessoes Wayland (GNOME 49+ nao tem mais sessao X11). O EYES ativa o RDP nativo do GNOME na sessao do usuario e o console abre o Web-RDP do MeshCentral pelo tunel do MeshAgent (`docs/api/fase4-mesh.md`).

## Consequencias
- O produto deixa de depender de codigo e de releases sob a Tactical RMM License. O backend ja era escrito a partir de especificacao (ADR-005). A validacao juridica pendente do ADR-005 fica restrita ao backend.
- O repositorio `rmmagentwincare` deixa de ser usado. Pode ser arquivado depois que o EYES estiver em producao.
- A imagem da API cresce cerca de 90 MB (binarios de todas as plataformas).
- Binarios do Windows nao sao assinados (code signing). O SmartScreen e alguns antivirus podem alertar ate haver um certificado de assinatura de codigo.
- App de bandeja no Windows:
  - `eyes-tray` e compilado sem CGO junto com a imagem e servido em `/api/agent/download/windows/<arch>?component=tray`;
  - o servico do EYES baixa o app (de novo a cada versao nova do agente) para `%ProgramFiles%\Cybereyes\EYES\eyes-tray.exe`;
  - o servico inicia o app em cada sessao de usuario ativa, com o token do usuario, ate 5 vezes por hora por sessao.
- App de bandeja no Linux e no macOS: o Wails precisa de CGO (GTK/WebKit e Cocoa) e de compilacao na propria plataforma. A distribuicao automatica fica pendente; o canal local do agente ja atende os dois sistemas.
