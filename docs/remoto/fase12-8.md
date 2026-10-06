# Fase 12.8: remocao do MeshCentral

Referencias: RFC-001 (secoes 9, 10 e 14), ADR-023, `docs/remoto/roteiro-piloto.md`.

## O que foi removido (checklist da secao 14 do RFC)

| Area | Feito |
|---|---|
| API | `Api/Rmm/Mesh/` inteiro (cliente, sincronizacao de usuarios, links, recuperacao e download do MeshAgent); registros no `Program.cs`; rotas `meshexe`, `meshreinstall` e `syncmesh` do protocolo do agente; chave `checkin_syncmesh` da configuracao do agente; `mesh_node_id` no registro do agente; `MeshUrl` e o parametro de MeshAgent dos instaladores; `RequestsMeshSync()` nas rotas de usuarios e papeis; `meshNodeId` nos DTOs do agente e do chamado. O Wake-on-LAN ja era do EYES desde a 12.7 |
| Banco | migration `Fase12RemoveMeshCentral` apaga `agents.MeshNodeId` (o `Down` recria a coluna) |
| Testes | `MeshTests.cs` removido; o acesso remoto e coberto por `RemoteTests`, `RemoteE2ETests`, `RemoteFilesE2ETests` e os testes de Wake-on-LAN |
| Agente | `internal/mesh` reduzido a remocao do MeshAgent de instalacoes antigas no `eyes uninstall` (`--keep-mesh` preserva); sem instalacao, sem sincronizacao periodica e sem o comando `recover` com `mode: mesh`; `--nomesh` continua aceito, sem efeito; `NoMesh` saiu da configuracao |
| Console | `api/mesh.ts`, secao "MeshCentral" de Configuracoes, item "Recuperar MeshAgent", tipos, chave de consulta e fixtures |
| Infra | servico `meshcentral`, pasta `infra/docker/meshcentral/`, volumes `mesh_data`, `mesh_files` e `mesh_shared`, variaveis `Mesh__*`, `MESH_HOST`, `MESH_USER`, `MESH_DEVICE_GROUP` e `MESHCENTRAL_VERSION`, servidor e upstream do MeshCentral no Nginx, filtro do envsubst, certificados do `MESH_HOST` no Nginx e no certbot, volumes do MeshCentral no backup e na restauracao (`--no-mesh` aceito sem efeito; conjuntos antigos com esses arquivos sao avisados e ignorados) |
| CI | build e publicacao da imagem `cybereyes-meshcentral` |
| Documentacao | README, `.team-context.md`, ADR-013 e a parte do ADR-004 marcados como substituidos pelo ADR-023, `docs/api/fase4-mesh.md` substituido pelo contrato novo, contrato do EYES e runbooks de instalacao, atualizacao, incidentes, segredos, backup e migracao |

## Tela via RDP para Linux com Wayland

A rota `POST /api/agents/{id}/remote/rdp` e o item "Tela via RDP (Wayland)" do console (EYES 3.0.2, vindos do `main`) abriam o Web-RDP pelo tunel do MeshAgent ate a porta local da maquina. Sem o MeshCentral nao ha esse tunel, entao a rota e o item sairam junto com ele.

Depois da remocao, o RDP do GNOME passou a ir pelo relay proprio (canal `rdp`, contrato secao 5.4):

- **Console**: "Acesso remoto > Tela" continua sendo o unico item. Se a maquina responde `REMOTE_WAYLAND`, a janela troca sozinha para o RDP do GNOME, com o cliente RDP do navegador do IronRDP (`@devolutions/iron-remote-desktop` 0.11.0 e `@devolutions/iron-remote-desktop-rdp` 0.7.0, licenca MIT ou Apache-2.0). O WASM (cerca de 6 MB, 2,2 MB com gzip) so e baixado nessa hora. A janela mostra o pedido de acesso e o motivo do fim pelo estado da sessao na API, e tem Ctrl+Alt+Del, tela cheia e o painel de arquivos (canal `files` na mesma sessao).
- **API**: com o canal `rdp`, chama `rdp_enable` no EYES (senha nova a cada sessao, modo so de visualizacao quando pedido), manda a porta no `remote_start` e devolve a credencial temporaria so ao tecnico da sessao. No relay, autentica o navegador pelo `proxy_auth` do pedido RDCleanPath, guarda o pedido ate o emparelhamento e repassa o RDP sem ler; do EYES, entrega so os quadros `RDP_DATA` sem o byte de tipo e fica com `CONSENT` e `BYE`.
- **EYES**: `findDesktop` devolve `wayland` com o alvo da sessao (usuario, Wayland e DBus) para o aviso e o pedido de acesso. O canal `rdp` faz o papel de proxy RDCleanPath: aplica a politica de aviso, conecta so em `127.0.0.1` na porta do `rdp_enable`, faz o X.224 e o TLS com o `gnome-remote-desktop`, responde com a cadeia de certificados e leva os bytes nos dois sentidos. No fim, desliga o RDP do GNOME.
- **Nginx**: a CSP ganhou `'wasm-unsafe-eval'` em `script-src` e `data:` em `connect-src`, porque o WASM do cliente RDP vem embutido numa URL `data:`.

Limites conhecidos:

- A area de transferencia e a do proprio RDP. A politica por sentido nao se aplica: o visualizador so liga a area de transferencia do RDP quando os dois sentidos estao permitidos e a sessao nao e so de visualizacao. Essa regra e aplicada no navegador.
- O EYES nao valida o certificado do `gnome-remote-desktop` (e o certificado que ele mesmo gerou, em `127.0.0.1`).
- Precisa do pacote `gnome-remote-desktop` na maquina; sem ele, a criacao responde `AGENT_ERROR` com o motivo.
- Os testes cobrem o RDCleanPath com os vetores do IronRDP (Go e C#), o proxy do EYES contra um servidor RDP falso com TLS, o relay com o EYES simulado e a troca automatica no console. A conexao com um `gnome-remote-desktop` real e o cliente IronRDP num navegador real ficam para o piloto (roteiro, item 6.5).

## Verificacao

- `docker compose config` com o `.env.example` e `nginx -t` com o template renderizado: sem erros.
- Backend, agente (Linux, Windows e macOS no `go vet`, mais os testes de fumaca no `go vet`) e console: testes verdes.
- `git grep -i mesh` fora da documentacao so encontra a remocao do MeshAgent antigo no `eyes uninstall`, a opcao `--nomesh` aceita sem efeito e as migrations antigas.

## O que continua pendente (fora do repositorio)

- **Piloto em homologacao** com estacoes reais: `docs/remoto/roteiro-piloto.md` (secoes 1 a 7). Ele nao foi executado neste ambiente, que nao tem Windows, macOS nem rede com Wake-on-LAN. A migracao das 400 estacoes espera o piloto aprovado (RFC, secao 9).
- **VPS**: no servidor, rodar a atualizacao descrita em `docs/runbooks/atualizacao.md` (secao da fase 12.8), remover o registro DNS e o certificado do `MESH_HOST` e apagar os volumes `mesh_*` (sem dados a preservar, RFC secao 10).
