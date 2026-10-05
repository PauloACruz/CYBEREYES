# ADR-012: Decisoes tecnicas da fase 3 (monitoramento e automacao)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Avaliacao de checks igual ao Tactical**: CPU e memoria pela media das ultimas 15 leituras; disco pelo espaco livre; script pelos codigos de retorno (info, aviso, sucesso); ping, servico e Event Log pelo status do agente. Alerta so apos `failsBeforeAlert` falhas seguidas; resultado bom resolve.
2. **Politicas em cadeia**: agente, site, cliente e global (por tipo, servidor ou estacao), com bloqueio de heranca em cada nivel. Checks e tarefas de todas as politicas efetivas valem juntos.
3. **Agendamento de tarefas no servidor para todos os sistemas**: a API envia `runtask` pelo NATS no horario, no fuso configurado (padrao America/Sao_Paulo). Cada disparo e gravado com chave unica (tarefa, agente, minuto), entao varias replicas nao duplicam execucoes. Diferenca para o Tactical, que usa o Agendador de Tarefas do Windows: aqui uma tarefa nao roda se o agente estiver sem comunicacao no horario.
4. **Notificacoes por e-mail (SMTP com MailKit) e webhook**. O webhook generico permite integrar Teams, Slack, WhatsApp ou outro servico por um gateway. SMS (Twilio no Tactical) nao foi incluido.
5. **Templates de alerta** com destinatarios e severidades por canal, atribuidos em global, cliente, site ou agente (vale o mais especifico).
6. **Alerta de disponibilidade** quando o agente fica em atraso (sem comunicacao alem do limite) e resolucao automatica no proximo check-in.
7. **Windows Update**: o agente envia a lista; a politica de patch (do agente ou da primeira politica efetiva que tiver uma) aprova ou ignora por severidade e instala no dia e hora configurados; reinicio conforme a politica.
8. **Senha do SMTP cifrada** com Data Protection (mesmo cofre de chaves do cookie de sessao).

## Validacao
Testado com o agente Go real em Linux: checks de CPU, memoria, disco, ping e script (com codigo de aviso gerando alerta) e tarefa manual com variavel resolvida.

## Limites conhecidos
- Checks de servico, Event Log, Windows Update e Chocolatey seguem o contrato do agente Windows, mas nao foram testados com agente Windows real.
- Instalacao de software no Linux e macOS nao existe (o agente so suporta Chocolatey no Windows); winget entra com a fusao do WinCare Pro (fase 7).
