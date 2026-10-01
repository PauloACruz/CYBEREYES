# Plano de Implementacao - WinCare Platform

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

### WinCare Pro (fundido no agente Go)
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
- Fusao do WinCare: os 9 modulos viram comandos nativos do agente (`wincare_run`), com scripts PowerShell embutidos via `go:embed`, parametros, progresso em tempo real e resultado estruturado.
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
- Migracao gradual das 400 estacoes (piloto com 10, depois por site).

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
