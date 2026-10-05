# Plano de Implementacao - Cybereyes

Referencia de arquitetura e decisoes: `.team-context.md`.

## Inventario de funcoes a capturar

### Tactical RMM (servidor)
| Modulo | Funcoes |
|---|---|
| Contas | Usuarios, papeis e permissoes, chaves de API, 2FA (TOTP), sessoes |
| Clientes | Clientes, sites, campos personalizados, implantacoes (links de instalacao) |
| Agentes | Lista, detalhes, notas, historico, campos personalizados, comando, script, WMI, reiniciar, desligar, ping, Wake-on-LAN, processos (listar e encerrar), Event Log, registro, servicos, terminal, manutencao e acoes em massa, atualizacao e instalador, recuperacao |
| Checks | Checks com resultado e historico (disco, CPU, memoria, ping, servico, Event Log, script) |
| Tarefas | Tarefas automatizadas e resultados |
| Scripts | Biblioteca de scripts e snippets |
| Alertas | Alertas e templates de alerta |
| Automacao | Politicas, politica de patch, visao geral e status |
| Windows Update | Atualizacoes por agente, politica de patch, instalacao |
| Software | Inventario de software instalado, Chocolatey |
| Core | Configuracoes, teste de e-mail e SMS, keystore global, URL actions, agendamentos, limpeza, status do servidor, permissoes do terminal web |
| Logs | Auditoria, log de depuracao, acoes pendentes |
| Integracao Mesh | Sincronizacao de usuarios, token de login, Take Control, reinstalacao do MeshAgent |
| EE (reescrever do zero) | Relatorios (templates, consultas, agendamento, historico) e SSO |

### Agente Go (contrato a manter)
- 17 endpoints REST em `apiv3` (checkin, checkrunner, taskrunner, software, winupdates, config, newagent, meshexe, entre outros).
- 50 comandos RPC via NATS: ping, sysinfo, procs, killproc, rawcmd, runscript, runscriptfull, eventlog, registro (8 operacoes), servicos (4), tarefas agendadas (3), softwarelist, Windows Update (2), Chocolatey (2), terminal (4), shutdown, reboot, recover, mesh, agentupdate, uninstall, entre outros.

### WinCare Pro (fundido no agente Go; no console: Cybereyes Care)
1. Manutencao Windows (SFC, DISM, limpeza, reset de rede, reparo de boot, servicos)
2. Windows Update (PSWindowsUpdate, drivers)
3. Bug Fixer (WMI, Store, .NET, GPO, permissoes, cache de icones)
4. Office (reparo, cache do Teams, OneDrive, SharePoint)
5. Registro (backup, entradas invalidas)
6. Remocao de aplicativos (Win32 e UWP)
7. Health Check (nota 0 a 100)
8. Testes de componentes (CPU, RAM, disco, GPU, rede, bateria)
9. Winget (busca, instalacao, atualizacao em lote)

## Funcoes novas
- Chamados e incidentes (com SLA e vinculo automatico com alertas)
- Inventario de ativos com usuarios responsaveis
- Documentacao de rede
- Logs de sistema centralizados
- Monitoramento SNMP

## Fases

### Fase 0: Fundacao
- Repositorio privado, estrutura de pastas, CI no GitHub Actions (build, lint e testes de backend, frontend e scripts).
- Docker Compose com PostgreSQL, Redis, NATS, MeshCentral, proxy com TLS, API e frontend.
- Backend: host ASP.NET Core, EF Core, autenticacao (login, 2FA, papeis, chaves de API), auditoria.
- Frontend: layout, login, roteamento, escolha da biblioteca de componentes.
- **Entrega**: login com 2FA funcionando no ambiente Docker.

### Fase 1: Contrato do agente e nucleo RMM
- Clientes, sites, implantacoes e instalador.
- Os 17 endpoints `apiv3` e o servico NATS (substitui o `natsapi` em Go).
- Lista e detalhe de agentes, status online e offline em tempo real (SignalR).
- **Entrega**: o agente Go atual, sem nenhuma mudanca, se registra e faz checkin no backend novo.

### Fase 2: Acoes sobre o agente
- Comando, script, processos, servicos, registro, Event Log, WMI, reiniciar, desligar, Wake-on-LAN, terminal (xterm.js).
- Biblioteca de scripts e snippets, keystore global, URL actions.
- **Entrega**: o tecnico administra uma estacao inteira pelo console.

### Fase 3: Monitoramento e automacao
- Checks, tarefas automatizadas, politicas, alertas e templates, notificacoes (e-mail, SMS, webhook).
- Windows Update e politica de patch, inventario de software, Chocolatey.
- **Entrega**: paridade funcional com o Tactical RMM (exceto EE).

### Fase 4: Acesso remoto (MeshCentral)
- Reescrita da integracao em C#: sincronizacao de usuarios, token de login, Take Control, recuperacao do MeshAgent.
- **Entrega**: botao "Acesso remoto" abre a sessao no navegador sem segundo login.

### Fase 5: Chamados e incidentes
- Chamados com fila, prioridade, status, SLA, comentarios, anexos e apontamento de tempo.
- Incidentes abertos automaticamente a partir de alertas, com vinculo ao agente.
- Abertura de chamado a partir da tela do agente.
- App de bandeja `wincare-tray` (Go + Wails v3 + React):
  - abrir chamado pela propria maquina, ja vinculado ao agente e ao usuario logado;
  - anexar print da tela e descricao;
  - acompanhar status dos seus chamados;
  - chat em tempo real com o tecnico, liberado quando o chamado e atribuido;
  - notificacao do sistema quando o tecnico responde.
- No console, o chat aparece dentro do chamado, ao lado dos dados da maquina e do botao de acesso remoto.
- **Entrega**: ciclo completo alerta, incidente, chamado, conversa, solucao.

### Fase 6: Inventario e documentacao de rede
- Ativos: estacoes (preenchidas pelo agente), impressoras, switches e outros (cadastro manual ou SNMP).
- Usuarios responsaveis: vinculo pessoa e ativo, com historico de trocas.
- Documentacao de rede: sub-redes e IPs, VLANs, diagramas (React Flow), credenciais criptografadas, anexos.
- **Entrega**: ficha de cada maquina com responsavel, hardware, software e documentacao.

### Fase 7: Evolucao do agente Go
- Fusao do WinCare Pro (no console: Cybereyes Care): os 9 modulos viram comandos nativos do agente (`wincare_run`), com scripts PowerShell embutidos via `go:embed`, parametros, progresso em tempo real e resultado estruturado.
- Health Check reescrito em Go para Windows, Linux e macOS.
- Acoes de autoatendimento opcionais no app de bandeja (por exemplo, limpar temporarios), liberadas pelo tecnico por politica.
- Paridade Linux e macOS nos comandos que fazem sentido.
- (Coleta de logs e coletor SNMP foram para a fase 8, junto com a parte do servidor; ver ADR-016.)
- **Entrega**: agente novo publicado, mantendo compatibilidade com o contrato da fase 1.

### Fase 8: Logs de sistema e SNMP no servidor
- Agente: coleta de logs de sistema (Event Log no Windows, journald/syslog no Linux, log unificado no macOS) e papel "coletor SNMP" (polling v2c/v3 e recepcao de traps).
- Ingestao, busca, filtros e retencao de logs (PostgreSQL particionado por mes).
- Dispositivos SNMP, metricas, graficos, alertas por limite e por trap.
- **Entrega**: logs e equipamentos de rede visiveis no console, com alertas.

### Fase 9: Relatorios, SSO e entrada em producao
- Relatorios com agendamento e exportacao em PDF; SSO via OIDC (projetados do zero).
- Hardening, backup e restauracao testados, runbooks.
  - Feito: cabecalhos de seguranca e limite de corpo de 30 MB no Nginx; `no-new-privileges`, `cap_drop: ALL`, raiz somente leitura, usuario nao root e `mem_limit` nos conteineres; rotacao dos logs dos conteineres; Redis com senha; verificacao de pacotes vulneraveis (NuGet e npm) no CI; servico `backup` diario com `backup.sh`/`restore.sh`, restauracao testada em projeto separado; runbooks em `docs/runbooks/`.
  - Pendente: ensaio completo de restauracao em VPS nova (medir o RTO real), copia automatica do backup para fora da VPS, ferramenta de recifragem do cofre para trocar a `VAULT_KEY`, CSP validada no navegador.
- Migracao gradual das 400 estacoes (piloto com 10, depois por site). Plano em `docs/runbooks/migracao-400-estacoes.md`; nada executado ainda.

### Fase 10: Renomeacao para Cybereyes e identidade visual (branding)
- Renomeacao do produto para Cybereyes (concluida; tabela de/para, excecoes e impacto em `docs/adrs/ADR-019-renomeacao-cybereyes.md`):
  - backend `Cybereyes.Api` e `Cybereyes.Core`, frontend `cybereyes-frontend`, titulo e simbolo da Cybereyes no console (favicon);
  - modulo de manutencao com nome fixo "Cybereyes Care": rotas `/api/agents/{id}/care/*` e `/api/care/*`, permissao `care.run`, eventos `careEvent` e `careRunChanged`, tabelas `care_runs` e `care_run_events` (migration `Fase10RenomeiaCare`, que preserva os dados e troca a permissao ja gravada nos papeis);
  - infra: projeto Compose `cybereyes`, imagens `cybereyes-*`, variavel `CYBEREYES_HOST`, banco e usuario `cybereyes`, usuario e grupo de fila do NATS `cybereyes-api`, administrador e grupo de dispositivos do MeshCentral `cybereyes` e `Cybereyes`, usuarios dos tecnicos no MeshCentral com prefixo `ce-`;
  - mantidos de proposito: o contrato com o agente e o app de bandeja (comandos `wincare_*`, prefixo `wc-` do `run_id`, repositorio `rmmagentwincare`), os identificadores criptograficos do Data Protection e os registros historicos (migrations aplicadas, testes ja executados).
- Identidade visual (em andamento): nome, logotipo e cores configuraveis pelo console (white-label), aplicados ao console e a tela de login, aos e-mails, aos PDFs dos relatorios, ao emissor do TOTP e ao MeshCentral. Projetada do zero, sem consultar a pasta `ee` do Tactical (ADR-005).
- Fora desta fase: o nome que o app de bandeja e os textos locais do agente exibem nas estacoes, que so muda com um release novo do agente (ver ADR-019).
- **Entrega**: renomeacao concluida; identidade visual configuravel em andamento.

### Fase 11: Agente proprio EYES
- Agente reescrito do zero em `agent/` (ADR-020), sem codigo do Tactical, a partir da especificacao `docs/agente/contrato-eyes.md`; contrato `/api/v3` + NATS mantido.
- Binario unico para Windows, Linux e macOS; instalacao, MeshAgent e servico feitos pelo proprio EYES; binarios compilados junto com a imagem da API; atualizacao remota e automatica.
- App de bandeja trazido para `agent/tray` como `eyes-tray`.
- **Entrega**: em andamento.

### Fase 12: Acesso remoto proprio (RFC-001, ADR-022)
- Substituir o MeshCentral e o MeshAgent por acesso remoto proprio, no mesmo modelo do ADR-020: o EYES captura a tela, recebe teclado e mouse, sincroniza a area de transferencia e transfere arquivos; a API cuida de sessoes, relay, politicas e auditoria; o console ganha o visualizador.
- Area de transferencia automatica e transferencia de arquivos facilitada (arrastar e soltar sobre a tela, painel de arquivos, copiar e colar arquivos entre as pontas).
- Etapa 0, imediata: o servidor deixa de oferecer o MeshAgent. Servidor limpo: o MeshCentral sai antes da migracao das 400 estacoes, sem convivencia em producao.
- Visualizador no navegador; sem aviso ao usuario por padrao (avisar ou perguntar ligados em Configuracoes); binarios sem assinatura no inicio.
- Etapas: especificacao (12.0), provas tecnicas (12.1), fundacao (12.2), tela no Windows (12.3), area de transferencia (12.4), arquivos (12.5), Linux e macOS (12.6), o resto do MeshCentral (12.7), piloto, corte e remocao (12.8).
- **Entrega**: aprovada em 2026-10-05 (ADR-022). Etapa 0 concluida (servidor sem oferecer o MeshAgent); 12.0 concluida (`docs/remoto/contrato-remoto.md`); 12.1 concluida (`docs/remoto/provas-12.1.md`: JPEG e X11 dentro das metas, `hash` do Nginx descartado em favor do encaminhamento entre replicas, Wayland fora da v1); 12.2 concluida no CI (`docs/remoto/fase12-2.md`: sessao, relay, politicas, EYES 3.1.0 com remote-helper X11 e visualizador no console, E2E com o EYES real sob Xvfb; prova no Windows segue com a 12.3); 12.3 com o codigo concluido (`docs/remoto/fase12-3.md`: GDI, SendInput, UAC e tela bloqueada, Ctrl+Alt+Del, aviso e pedido de acesso no eyes-tray, historico de sessoes), execucao em Windows real pendente no roteiro do piloto (`docs/remoto/roteiro-piloto.md`); proxima: area de transferencia (12.4).

## Servidor (estimativa inicial, validar com teste de carga)
VPS com 4 vCPU, 8 GB de RAM e 160 GB de SSD para 400 estacoes, incluindo MeshCentral e logs. Esta e uma estimativa minha, sem medicao; o volume de logs e o fator que mais pode exigir aumento de disco.

## Riscos
| Risco | Mitigacao |
|---|---|
| Licenca do Tactical RMM em uso comercial | Reimplementacao por especificacao funcional; consulta juridica antes de vender ou oferecer como SaaS |
| Quebra de contrato com o agente | Testes de integracao do contrato na fase 1, rodando contra o agente real |
| Volume de logs | Retencao configuravel e particionamento mensal desde o inicio |
| Wails v3 ainda em beta | Fixar versao; Wails v2 como alternativa |
| Traps SNMP v3 | Limite conhecido do gosnmp; validar antes de prometer |
