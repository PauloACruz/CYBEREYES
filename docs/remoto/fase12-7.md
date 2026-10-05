# Fase 12.7: o resto do MeshCentral

Referencias: RFC-001 (secao 4.9), ADR-023, `docs/remoto/contrato-remoto.md` (secoes 2.1, 3 e 8).

## O que foi entregue

### Wake-on-LAN pelo EYES

- EYES: comando `wol` (contrato, secao 3): pacote magico (6 bytes `0xFF` e 16 repeticoes do MAC) por UDP com broadcast ligado, para cada endereco pedido, nas portas 7 e 9.
- EYES no Linux e no macOS passa a mandar no inventario a lista `nics` (nome, MAC e enderecos em CIDR de cada placa fisica ativa). No Windows o MAC ja vinha do WMI (`network_config`).
- API: `POST /api/agents/{id}/wake` deixou de usar o MeshCentral. Le as placas IPv4 do alvo no inventario, escolhe um agente online do mesmo site, com EYES 3.1.0 ou mais novo e placa na mesma rede, e manda `wol` com os MACs e os broadcasts dessas redes; tenta o proximo vizinho se um falhar. Responde `{ result, via }` e registra na auditoria quem enviou. Sem vizinho na mesma rede responde 409 explicando.
- Console: "Wake-on-LAN" no menu de acoes mostra por qual maquina o pacote saiu.

### Menu de acesso remoto

- "Acesso remoto" (agente, chamado e ativo) ganhou "Terminal" (aba Terminal do agente, terminal do EYES) e "Arquivos" (aba Arquivos), conforme as permissoes `agents.run` e `agents.files`. Nenhum item depende mais do MeshCentral.

### Politicas em Configuracoes

- Secao "Acesso remoto" em Configuracoes: politica global (aviso ao usuario: nao avisar, avisar ou pedir permissao, como decidido em D-04; prazo de resposta; tela de login; area de transferencia nos dois sentidos; envio e download de arquivos; tamanho maximo; tempo sem uso; duracao maxima) e excecoes por cliente ou site, com "Herdar" por campo.

### Relatorio

- Aba "Acessos remotos" em Relatorios: sessoes de todas as maquinas (com o filtro "so as abertas agora") e transferencias de arquivos (maquina, tecnico, sentido, caminho, tamanho, situacao e SHA-256).
- API: `GET /api/remote/transfers?agentId=&sessionId=&page=` (`agents.view`).

## Testes

| Teste | O que confere |
|---|---|
| Go `remote` | pacote magico, envio por UDP, MAC e endereco invalidos recusados |
| Go `sysinfo` | placas com MAC no formato e enderecos com prefixo |
| `AgentTests` (Wake) | leitura das placas do inventario do Windows e do Linux, mascara para prefixo, broadcast; envio por um vizinho online da mesma rede com os MACs e o broadcast certos; 409 sem vizinho online |
| `RemoteFilesE2ETests` | o relatorio de transferencias traz o envio com o SHA-256 e o download |
| vitest | politica global salva com o pedido de permissao e excecoes listadas; itens Terminal e Arquivos do menu; aba do relatorio |

## O que ficou pendente desta fase

- Wake-on-LAN numa rede real (placa e BIOS com WoL ligado): roteiro do piloto, secao 7.
- O MeshCentral ainda existe no repositorio (secao "MeshCentral" em Configuracoes, "Recuperar MeshAgent" e as rotas `/api/mesh/*`); a remocao e a fase 12.8.
