# Runbook: migracao das 400 estacoes do Tactical RMM para o Cybereyes

Plano de migracao gradual: piloto com 10 maquinas e depois ondas por site.

**Status deste documento**: e um plano. Nada da migracao foi executado ainda. Ao longo do texto, **[verificado]** marca o que foi conferido no codigo ou em teste e **[recomendacao]** marca o que e sugestao e precisa ser validado no piloto.

## 1. Fatos que definem a estrategia
1. **[verificado no codigo]** O agente do Cybereyes e o agente do Tactical usam os mesmos caminhos. No Windows o comando de instalacao chama `C:\Program Files\TacticalAgent\tacticalrmm.exe -m install ...` (`InstallScripts.Windows`); no Linux o script grava `/opt/tacticalagent/tacticalagent` e o servico `tacticalagent.service`, e instala o MeshAgent em `/opt/tacticalmesh`.
2. **[deducao, validar no piloto]** Por isso as duas versoes nao convivem na mesma maquina: instalar o agente do Cybereyes substitui o do Tactical, e a maquina sai do Tactical naquele momento. Com o acesso remoto vale o mesmo: o MeshAgent do Cybereyes (do MeshCentral novo) tende a substituir o MeshAgent do Tactical. A convivencia e por **parque** (parte das maquinas em cada servidor durante as ondas), nao por maquina.
3. **[verificado no codigo]** A implantacao por site (fase 1) gera um link publico com validade e um comando por sistema:
   - Windows (PowerShell como administrador): `irm 'https://CYBEREYES_HOST/api/deploy/<uid>/windows' | iex`
   - Linux: `curl -fsSL 'https://CYBEREYES_HOST/api/deploy/<uid>/linux' | sudo bash`
   - macOS: `curl -fsSL 'https://CYBEREYES_HOST/api/deploy/<uid>/darwin' | sudo bash`

   Ela e criada no console (Implantacoes) ou por `POST /api/deployments` `{ siteId, agentType: "auto"|"server"|"workstation", goArch?, expiresAt }`, com a permissao `agents.install`. O script do Windows baixa `/api/agent/download/windows/<arch>` (versao de `AGENT_VERSION`), roda o instalador com `/VERYSILENT` e registra o agente no site da implantacao. Apagar a implantacao invalida o token.
4. **[verificado no codigo]** Nao ha importacao de configuracao do Tactical: clientes, sites, scripts, checks, politicas, modelos de alerta e tarefas precisam ser criados no Cybereyes antes das ondas.
5. **[verificado]** Os agentes falam com o servidor so por HTTPS 443 (REST e `wss://CYBEREYES_HOST/natsws`). O certificado precisa ser valido (Let's Encrypt ou proprio); com o autoassinado temporario do Nginx os agentes nao conectam.

## 2. Pre-requisitos (antes do piloto)
- [ ] Servidor de producao instalado (`instalacao.md`), backup diario funcionando e uma restauracao ensaiada (`backup-restauracao.md`).
- [ ] Tags `v2.12.0` e `v2.13.0` publicadas no `rmmagentwincare` e `AGENT_VERSION=2.13.0` no `.env` (ver `atualizacao.md`); arquivos do release conferidos para `windows-amd64` e `linux-amd64` (e `386`/`arm64` se houver no parque).
- [ ] Confirmar se o instalador do Windows do release ja inclui o `wincare-tray` com inicio automatico por sessao (ADR-008 preve o mesmo instalador; a fase 5 deixou o empacotamento para depois). Sem isso, a comunicacao sobre o app de bandeja fica para uma onda posterior.
- [ ] Clientes e sites criados no Cybereyes espelhando os do Tactical.
- [ ] Scripts, checks, politicas, modelos de alerta, SMTP e webhook recriados; janela de patches revisada.
- [ ] Tecnicos com usuario, papel e 2FA no Cybereyes.
- [ ] Inventario do Tactical exportado (lista de agentes por site com hostname, SO, usuario, ultimo contato) para servir de lista de conferencia.
- [ ] O servidor do Tactical continua ligado ate o fim da migracao mais 30 dias (rota de volta e historico).

## 3. Como instalar usando o executor de scripts do Tactical
O jeito mais rapido de alcancar as maquinas e mandar o Tactical rodar o comando da implantacao. Cuidado: o script roda como filho do servico do agente do Tactical, e o instalador do Cybereyes para e substitui esse servico. Um script rodado direto pode morrer no meio.

**[recomendacao, testar no piloto]** Desacoplar a instalacao do processo do agente antigo:

Windows (script PowerShell no Tactical, executado como SYSTEM; troque a URL pela implantacao do site):
```powershell
$url = 'https://CYBEREYES_HOST/api/deploy/<uid>/windows'
$log = 'C:\Windows\Temp\cybereyes-migracao.log'
$cmd = "Start-Transcript -Path '$log' -Force; irm '$url' | iex; Stop-Transcript"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`""
Register-ScheduledTask -TaskName 'CybereyesMigracao' -Action $action -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'CybereyesMigracao'
Write-Output "Instalacao do Cybereyes agendada; log em $log"
```
Depois que a maquina aparecer no Cybereyes, remova a tarefa pelo executor de scripts do Cybereyes: `Unregister-ScheduledTask -TaskName 'CybereyesMigracao' -Confirm:$false`.

Linux (script shell no Tactical, como root):
```bash
systemd-run --unit cybereyes-migracao --collect /bin/bash -c \
  "curl -fsSL 'https://CYBEREYES_HOST/api/deploy/<uid>/linux' | bash > /var/log/cybereyes-migracao.log 2>&1"
echo "Instalacao do Cybereyes iniciada; log em /var/log/cybereyes-migracao.log"
```

Maquinas sem o agente do Tactical funcionando: rodar o comando da implantacao manualmente (PowerShell como administrador) ou por GPO de inicializacao.

## 4. Piloto (10 maquinas)
Escolha: maquinas da equipe de TI e de usuarios colaborativos, cobrindo Windows 10 e 11, um notebook que sai da rede, um servidor se houver, uma maquina Linux se houver e pelo menos um site remoto.

Criterios de entrada:
- [ ] Todos os pre-requisitos da secao 2.
- [ ] Usuarios do piloto avisados (secao 8).

Execucao:
1. Criar uma implantacao para o site, validade de 7 dias.
2. Rodar a instalacao (secao 3) em 2 maquinas, conferir, depois nas outras 8.
3. Conferir cada maquina com o checklist da secao 6.
4. Deixar o piloto rodando 5 dias uteis.

Criterios de saida (todos):
- [ ] 10 de 10 maquinas online no Cybereyes e ausentes do Tactical.
- [ ] Nenhuma maquina ficou sem agente (nem no Tactical nem no Cybereyes).
- [ ] Checks, alertas por e-mail, execucao de script, terminal, acesso remoto pelo MeshCentral, Health Check e coleta de logs funcionando em pelo menos uma maquina de cada tipo.
- [ ] App de bandeja: um usuario abriu chamado e conversou com o tecnico (se o instalador ja incluir o app).
- [ ] O metodo de instalacao pelo executor do Tactical funcionou sem intervencao em pelo menos 8 de 10 (senao, ajustar o script antes das ondas).
- [ ] Desempenho do servidor estavel (`docker stats`, latencia do console).
- [ ] Reversao ensaiada em 1 maquina (secao 7).

## 5. Ondas por site
Ordem sugerida: sites com equipe de TI presente primeiro, depois os maiores, por ultimo os remotos com pior link. Tamanho sugerido: ate 50 maquinas por onda, no maximo 2 ondas por semana, ate somar 400 (cerca de 8 a 10 ondas).

Criterios de entrada de cada onda:
- [ ] Onda anterior fechada pelos criterios de saida.
- [ ] Backup do Cybereyes do dia conferido.
- [ ] Implantacao do site criada (validade curta, por exemplo 3 dias) e lista de maquinas do Tactical exportada.
- [ ] Usuarios do site avisados com 2 dias uteis de antecedencia.
- [ ] Tecnico disponivel durante a janela e no dia seguinte.

Execucao:
1. Janela fora do horario de pico. Rodar a instalacao pela secao 3 em todas as maquinas online do site.
2. Uma hora depois, comparar a lista do Tactical com o console do Cybereyes (filtro por site). Maquinas que nao migraram: ver o log local (`C:\Windows\Temp\cybereyes-migracao.log`) pelo Tactical, se o agente antigo ainda responder.
3. Maquinas desligadas: repetir no dia seguinte. As que nao aparecerem em 5 dias uteis vao para uma lista de instalacao manual.
4. Apagar a implantacao ao fim da onda.

Criterios de saida:
- [ ] Pelo menos 95% das maquinas do site online no Cybereyes; as restantes listadas com motivo.
- [ ] Nenhum chamado de usuario sem resposta causado pela migracao.
- [ ] Alertas do site chegando pelo Cybereyes.
- [ ] Maquinas migradas removidas do Tactical (secao 7, cuidado com a ordem).

## 6. Checklist por maquina
- [ ] Aparece online no site certo, com hostname, SO e usuario logado corretos.
- [ ] Versao do agente igual a `AGENT_VERSION`.
- [ ] Checks da politica aplicados e com resultado.
- [ ] Execucao de um script simples (por exemplo `hostname`) devolve saida.
- [ ] Acesso remoto abre pelo console.
- [ ] Health Check executa (agente 2.12.0 ou superior).
- [ ] Logs de sistema chegando (agente 2.13.0 ou superior), se a coleta estiver ativa.
- [ ] App de bandeja visivel na sessao do usuario, se aplicavel.
- [ ] A maquina sumiu da lista de online do Tactical.

## 7. Reversao e limpeza
Reversao de uma maquina **[recomendacao]**: gerar o instalador no console do Tactical (o servidor antigo continua no ar) e roda-lo na maquina; o agente do Tactical volta a ocupar os mesmos caminhos. Depois, apagar a maquina no Cybereyes. Ensaiar no piloto.

Reversao de uma onda: o mesmo, em massa, pelo executor de scripts do Cybereyes (com o mesmo cuidado de desacoplar a instalacao, secao 3).

Reversao total: possivel enquanto o servidor do Tactical estiver no ar. Por isso ele so e desligado 30 dias depois da ultima onda, com um backup final dele guardado.

Limpeza no Tactical: so remova uma maquina do Tactical depois de confirma-la online no Cybereyes. **Nao use** a acao de desinstalar agente do Tactical em maquinas que ainda nao migraram: ela remove o agente e a maquina fica sem gestao.

## 8. Comunicacao aos usuarios
Mensagem modelo (e-mail ou intranet, 2 dias uteis antes da onda):

> Assunto: Atualizacao da ferramenta de suporte de TI no seu computador
>
> Na noite de [data], a TI vai atualizar a ferramenta de suporte instalada no seu computador. Voce nao precisa fazer nada e pode deixar o computador ligado. Pode ser que a ferramenta reinicie alguns servicos; nao e preciso reiniciar o computador.
>
> Depois da atualizacao vai aparecer um icone novo do [nome do app de bandeja] perto do relogio. Por ele voce pode abrir um chamado para a TI (com uma captura da tela, se quiser), acompanhar o andamento e conversar com o tecnico depois que ele assumir o chamado.
>
> Duvidas: [contato da TI].

No dia seguinte a onda, mandar um lembrete curto com uma imagem do icone e como abrir um chamado. Se o app de bandeja ainda nao estiver no instalador, retire o segundo paragrafo.

Em [nome do app de bandeja], use o nome que o app da versao instalada mostra no icone, no menu e nas notificacoes. O nome vem do binario do app (repositorio do agente), nao do servidor: ate um release novo do agente ele continua "WinCare", e nao Cybereyes (ver ADR-019).

## 9. Riscos
| Risco | Mitigacao |
|---|---|
| Script morto no meio da instalacao (agente antigo parado pelo instalador) | instalacao desacoplada (secao 3), log local, piloto |
| Antivirus bloqueando o instalador ou o binario | testar no piloto; liberar o caminho e o hash do instalador no antivirus |
| Maquinas desligadas durante a onda | repeticao no dia seguinte e lista manual |
| Certificado invalido no servidor | conferir antes de cada onda (`incidentes.md`, certificado vencido) |
| Carga no servidor ao registrar muitas maquinas de uma vez | ondas de ate 50; observar `docker stats` e o tempo de resposta |
| Configuracao do Cybereyes diferente do Tactical (checks e alertas) | revisao das politicas antes do piloto; comparar alertas durante o piloto |
