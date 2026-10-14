# ADR-026: Procedimentos nos agentes como registro, indicador e tempo de serviço

- Status: aceito
- Data: 2026-10-14

## Contexto
- Pedido: todo procedimento feito no agente (acesso remoto, operações do Cybereyes Care, comandos enviados...) deve ser computado
  como indicador e registrado como log, podendo depois ser incluído como procedimento de um chamado ou computado como tal,
  contabilizando tempo de execução e de serviço.
- Antes, cada ação ficava num lugar: histórico do agente (comandos e scripts, sem duração, apagado depois de 60 dias), auditoria
  (só o instante e um texto), sessões remotas (com início e fim) e execuções do Care (com início e fim). Só o acesso remoto se ligava
  a um chamado, e nada disso contava no tempo do chamado.

## Decisão
1. **Tabela única `agent_procedures`** com tipo, título, detalhe, situação, quem fez (técnico com id ou usuário da bandeja),
   início, fim, duração em segundos, chamado e apontamento. Guarda cliente e hostname para o indicador sobreviver à remoção do
   agente; agente, chamado, apontamento e usuário ficam nulos se forem apagados.
2. **Registro no ponto da ação** pelo serviço `ProcedureLog`, no mesmo contexto do banco da ação: abre antes de falar com o
   agente e conclui com o resultado (`ok`, `warning`, `error`, `cancelled`, `timeout`). Ações que terminam depois (sessão remota,
   Care, terminal, instalação de software, tarefa rodada à mão) são concluídas pela origem (`RefType`/`RefId`). As consultas
   (listar processos, serviços, registro, Event Log) não contam: não mudam a máquina.
3. **Incluir no chamado = um apontamento de horas** ligado ao procedimento. O tempo de serviço começa pela duração arredondada
   para cima e pode ser ajustado; o total do chamado continua sendo a soma dos apontamentos, sem um segundo jeito de somar horas.
   Tirar do chamado exclui o apontamento; excluir o apontamento tira o procedimento do chamado.
4. **Registrar como chamado**: atendimento feito sem chamado gera um chamado (atribuído a quem registra, opcionalmente já
   resolvido) com os procedimentos e o tempo deles.
5. **Acesso remoto aberto pelo chamado entra sozinho** no chamado ao terminar; os outros procedimentos entram quando o técnico
   escolhe.
6. **Indicadores** no Painel (total, tempo de execução, em chamados, sem chamado, por dia, por tipo e por técnico) e na página
   Procedimentos, com os totais do filtro.
7. **Carga inicial** na migração com sessões remotas, Care, comandos e scripts do histórico e ações da auditoria; nada entra em
   chamado nessa carga, para não mudar o tempo de chamados antigos.

## Consequências
- O histórico do agente continua apagado pela retenção; os procedimentos não têm retenção (uma linha pequena por ação).
- Comandos, reinícios e ações parecidas medem o tempo da chamada ao agente, não o tempo do técnico; por isso o tempo de serviço é
  editável ao incluir no chamado.
- Ações em massa (atualização do EYES em vários agentes) geram um procedimento por agente.
- Procedimento sem fim registrado em 24 horas é fechado como falha sem duração (servidor reiniciado com terminal aberto, agente
  que nunca devolveu o resultado).
- A carga inicial não tem duração para comandos e para as ações vindas da auditoria (lá só havia o instante).
