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

A rota `POST /api/agents/{id}/remote/rdp` e o item "Tela via RDP (Wayland)" do console (EYES 3.0.2, vindos do `main`) abriam o Web-RDP pelo tunel do MeshAgent ate a porta local da maquina. Sem o MeshCentral nao ha esse tunel, entao a rota e o item sairam junto com ele. Os comandos `rdp_enable` e `rdp_disable` do EYES continuam no agente (nao dependem do MeshCentral), sem uso pelo console.

Consequencia: estacoes Linux so com sessao Wayland voltam a ficar sem tela remota (D-06). Uma proxima etapa pode levar o RDP do GNOME pelo relay proprio (o EYES liga o `grdctl` e o canal do relay carrega o RDP ate o visualizador).

## Verificacao

- `docker compose config` com o `.env.example` e `nginx -t` com o template renderizado: sem erros.
- Backend, agente (Linux, Windows e macOS no `go vet`, mais os testes de fumaca no `go vet`) e console: testes verdes.
- `git grep -i mesh` fora da documentacao so encontra a remocao do MeshAgent antigo no `eyes uninstall`, a opcao `--nomesh` aceita sem efeito e as migrations antigas.

## O que continua pendente (fora do repositorio)

- **Piloto em homologacao** com estacoes reais: `docs/remoto/roteiro-piloto.md` (secoes 1 a 7). Ele nao foi executado neste ambiente, que nao tem Windows, macOS nem rede com Wake-on-LAN. A migracao das 400 estacoes espera o piloto aprovado (RFC, secao 9).
- **VPS**: no servidor, rodar a atualizacao descrita em `docs/runbooks/atualizacao.md` (secao da fase 12.8), remover o registro DNS e o certificado do `MESH_HOST` e apagar os volumes `mesh_*` (sem dados a preservar, RFC secao 10).
