# Contrato de API - Fase 4 (acesso remoto com MeshCentral)

> **Substituido (fase 12.8)**: este contrato foi substituido por `docs/remoto/contrato-remoto.md` (ADR-023). O MeshCentral saiu do Cybereyes e as rotas abaixo (`/api/mesh/*`, `/api/agents/{id}/remote`, `/api/agents/{id}/mesh/recover` e as rotas do agente `meshexe`, `meshreinstall` e `syncmesh`) nao existem mais. O Wake-on-LAN continua em `POST /api/agents/{id}/wake`, agora enviado por um EYES vizinho. O restante deste documento fica como registro historico.

Mesmo padrao das fases anteriores (cookie com 2FA, camelCase, ProblemDetails com `code`, auditoria em toda acao).

## Permissao nova
| Chave | Uso |
|---|---|
| `agents.remote` | Abrir acesso remoto (tela, terminal e arquivos) pelo MeshCentral |

Wake-on-LAN e recuperacao do MeshAgent usam `agents.control`. Status e sincronizacao usam `settings.manage`.
O papel padrao "Tecnico" recebe `agents.remote` em instalacoes novas; em bancos existentes, adicione a permissao pela tela de papeis.

## Como funciona
- O container do MeshCentral cria na primeira partida um administrador interno (`MESH_USER`, padrao `cybereyes`) e gera a chave de token de login (160 caracteres hexadecimais) em um volume compartilhado, lido pela API.
- A API mantem no MeshCentral um grupo de dispositivos (`MESH_DEVICE_GROUP`, padrao `Cybereyes`) e um usuario `ce-<usuario>` para cada usuario ativo com `agents.remote` (ou superusuario), com direitos de controle remoto, terminal e arquivos nesse grupo. Quem perde a permissao tem o usuario removido do MeshCentral. A sincronizacao roda na partida, a cada 4 minutos e logo apos alteracoes em usuarios ou papeis.
- O acesso remoto abre o MeshCentral em nova aba com um token de login de uso imediato (sem segundo login), ja na maquina e na aba pedida, sem os menus do MeshCentral.
- O MeshAgent e instalado junto com o agente: Linux pelo script `linux.sh` (em `/opt/tacticalmesh`, use `--nomesh` para pular); Windows e macOS pelo proprio agente, que baixa o MeshAgent em `/api/v3/meshexe/`. O agente informa o `meshNodeId` periodicamente (`/api/v3/syncmesh/`).

## Rotas
| Metodo | Rota | Permissao | Resposta |
|---|---|---|---|
| GET | `/api/agents/{id}/remote` | `agents.remote` | `{ hostname, control, terminal, files }` (URLs para abrir em nova aba) |
| POST | `/api/agents/{id}/remote/rdp` | `agents.remote` | Linux: `{ url, username, password, port, sessionUser }` (Web-RDP do MeshCentral); 400 em outro sistema ou com a mensagem do agente; 504 `AGENT_TIMEOUT` |
| POST | `/api/agents/{id}/wake` | `agents.control` | `{ result: "ok" }`; 400 se o MeshCentral recusar |
| POST | `/api/agents/{id}/mesh/recover` | `agents.control` | 202 (o agente reinstala o MeshAgent); 504 `AGENT_TIMEOUT` |
| GET | `/api/mesh/status` | `settings.manage` | `{ enabled, url, deviceGroup, groupId, lastSync, lastError, users }` |
| POST | `/api/mesh/sync` | `settings.manage` | `{ lastSync, lastError, users }` (sincroniza agora) |

Erros de `/remote`:
- 503 `MESH_DISABLED`: MeshCentral nao configurado (sem `Mesh:Url` ou sem a chave de token).
- 409 `CONFLICT`: o agente ainda nao tem MeshAgent instalado ou o node id ainda nao foi sincronizado.
- 404: agente inexistente.

Cada abertura de acesso remoto gera o registro de auditoria `agent.remote-session`; Wake-on-LAN gera `agent.wake`; recuperacao gera `agent.mesh-recover`.

## Rotas do agente (`/api/v3`)
| Rota | Autenticacao | Efeito |
|---|---|---|
| `POST /api/v3/meshexe/` `{ plat, goarch }` | instalacao | binario do MeshAgent ja vinculado ao grupo; 400 se o MeshCentral estiver indisponivel ou a arquitetura nao for suportada |
| `GET /api/v3/{id}/meshreinstall/` | agente | binario do MeshAgent Windows para a arquitetura do agente |

## Configuracao (variaveis da API)
| Chave | Exemplo | Uso |
|---|---|---|
| `Mesh__Url` | `https://mesh.suaempresa.com.br` | Endereco publico (links do navegador e download do MeshAgent no Linux) |
| `Mesh__InternalUrl` | `http://meshcentral:4443` | Endereco interno usado pela API (websocket de controle e download) |
| `Mesh__Username` | `cybereyes` | Administrador interno do MeshCentral |
| `Mesh__TokenKeyFile` | `/mesh/mesh_token` | Arquivo com a chave de token (ou `Mesh__TokenKey` com o valor) |
| `Mesh__DeviceGroup` | `Cybereyes` | Nome do grupo de dispositivos |
| `Mesh__DistributeAgent` | `false` | Oferece o MeshAgent nas instalacoes e em `meshexe`/`meshreinstall`. Desligado por padrao desde o ADR-023 |

> **ADR-023 (servidor limpo)**: o MeshAgent deixou de ser oferecido. Os comandos de instalacao saem com `--nomesh` e `meshexe`/`meshreinstall` respondem 400 `"MeshAgent is no longer distributed"`. O acesso remoto passa a ser o modulo proprio da RFC-001; o MeshCentral sai na fase 12.8.

## Tela via RDP em Linux com Wayland

> Removida na fase 12.8 junto com o MeshCentral (dependia do tunel do MeshAgent); ver `docs/remoto/fase12-8.md`.

O MeshAgent so captura a tela de sessoes X11. Em distribuicoes com GNOME recente (por exemplo Ubuntu com GNOME 50), a sessao e sempre Wayland e a "Tela" do MeshCentral abre sem imagem.

Para esses casos, `POST /api/agents/{id}/remote/rdp`:
1. Pede ao EYES o comando NATS `rdp_enable`. O agente ativa o compartilhamento RDP do GNOME (`grdctl rdp`) na sessao do usuario conectado, com certificado TLS proprio e o usuario `eyes` com senha aleatoria nova a cada pedido. A resposta e `{ port, username, password, user }` ou `"error: <motivo>"` (sem `gnome-remote-desktop`, sem ninguem logado).
2. Pede ao MeshCentral (`getcookie`, `tag: "mstsc"`) o cookie do tunel do MeshAgent ate `127.0.0.1:<port>` da maquina.
3. Devolve o link `https://<mesh>/mstsc.html?ws=<cookie>` e a credencial, que o console mostra ao tecnico. Gera auditoria `agent.remote-rdp`.

A sessao compartilhada e a do usuario conectado (o usuario ve o aviso de compartilhamento do GNOME); bloquear a tela encerra a conexao. Nenhuma porta precisa ser aberta na maquina ou no firewall: o trafego passa pelo MeshAgent. `rdp_disable` desliga o compartilhamento.
