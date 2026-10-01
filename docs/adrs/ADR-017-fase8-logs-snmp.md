# ADR-017: Decisoes tecnicas da fase 8 (logs de sistema e SNMP)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **REST para logs, resultados SNMP e traps** (e nao NATS): sao lotes que precisam de confirmacao. O agente guarda o lote e so avanca a posicao de leitura depois do `"ok"`; em falha, reenvia no ciclo seguinte.
2. **Posicao de leitura no agente**, gravada de forma atomica em arquivo de estado (`/var/lib/wincare-agent` ou `ProgramData\TacticalRMM\state`): cursor do journald, `RecordId` por log do Windows e data no macOS. A primeira execucao comeca do momento atual, sem historico.
3. **`system_logs` e `snmp_samples` particionadas por mes** (`PARTITION BY RANGE ("Time")`), criadas por SQL na migracao, com particao padrao. O `LogPartitionService` cria a particao do mes atual e a do proximo, move para ela o que tiver caido na padrao e apaga as particoes inteiras fora da retencao (`logRetentionDays`, padrao 30, a mesma para amostras SNMP). Varias replicas usam `pg_advisory_xact_lock` para nao disputar.
4. **Sem chave estrangeira em `system_logs`**: a linha guarda `AgentId`, `SnmpDeviceId` e `ClientId` (copia, para filtrar por cliente sem junção). Excluir um agente nao apaga o historico; ele sai com a retencao.
5. **Busca por cursor** (`before` = instante + id da ultima linha), janela padrao de 24 h e maxima de 31 dias, para que a consulta sempre caia em poucas particoes.
6. **Ingestao defensiva**: lote ate 1000 entradas e 2 MB; nivel minimo aplicado tambem no servidor; hora no futuro vira a hora de recebimento; entrada mais antiga que a retencao e descartada; caractere nulo removido (o PostgreSQL recusa).
7. **Alertas sem agente**: `alerts.AgentId` passou a aceitar nulo e ganhou `SnmpDeviceId` e `SubjectKey` (regra de log, interface, sensor, OID do trap). O `AlertService` ganhou `RaiseSubjectAsync`/`ResolveSubjectAsync`; o caminho antigo de checks, tarefas e disponibilidade nao mudou. Template do dispositivo: site, depois cliente, depois o padrao. Incidente de dispositivo fica sem maquina, com o cliente do dispositivo e o nome dele no titulo.
8. **Regras de alerta de log avaliadas a cada minuto** sobre a janela de cada regra, agrupadas por maquina ou dispositivo; um alerta aberto por regra e origem, atualizado enquanto continua; resolve quando a janela fica sem ocorrencias, e tambem quando a regra e excluida.
9. **SNMP**: credenciais (comunidade, senhas v3) cifradas no cofre da fase 6 e decifradas apenas na configuracao entregue ao coletor e no comando `snmp_test`. Taxa de interface pela diferenca de contadores (64 bits quando houver); volta ou reinicio do contador descarta a amostra. Dispositivo `down` apos 2 coletas sem resposta. Resultado repetido (mesma hora ou anterior a ultima coleta) e ignorado, o que torna o reenvio do coletor seguro.
10. **Queda de interface** conta `down` e `lowerLayerDown` com `adminStatus` `up` (no teste real, o lado do host de um par veth caiu como `lowerLayerDown`).
11. **Traps**: associados ao dispositivo do mesmo cliente do coletor pelo IP de origem; a comunidade precisa conferir. Trap com comunidade errada ou de origem desconhecida vira log informativo do coletor (sem gravar a comunidade recebida). v3 nao e recebido.

## Validacao
- Testes do backend (68 no total; 4 novos): particao mensal recebendo as linhas, filtro por nivel, cursor, resumo, lote acima do limite, regra de log abrindo e resolvendo alerta, cofre, configuracao do coletor, taxa de interface, alertas de sensor, interface e queda, incidente sem maquina, traps (comunidade certa, errada, origem desconhecida) e `snmp_test` pelo NATS com as permissoes reais.
- Ponta a ponta com o agente 2.13.0 real em Linux, journald e snmpd locais:
  - Eventos gerados com `logger`/`systemd-cat` chegaram com nivel e origem corretos; o informativo ficou de fora com o nivel minimo `warning`.
  - Regra "setores ilegiveis" abriu alerta de erro (e incidente) apos 2 ocorrencias.
  - Teste de conexao pelo console via NATS em v2c e v3 authPriv (SHA/AES); comunidade errada falhou.
  - Coleta de 27 interfaces com taxas, sensor acima do limite gerou aviso.
  - Interface monitorada (veth de um conteiner com o link derrubado) gerou aviso e resolveu ao religar.
  - snmpd parado: os dois dispositivos ficaram `down` com alerta de erro e incidente; ao religar, alertas e incidentes resolvidos.
  - `snmptrap` v2c com a comunidade certa virou log do dispositivo e alerta `snmp_trap`; v2c com comunidade errada e v1 com comunidade diferente viraram log de descarte do coletor.
  - Telas de logs, Rede SNMP, detalhe do dispositivo e alertas abertas no navegador sem erro de JavaScript nem resposta de erro da API.

## Limites conhecidos
- Event Log do Windows e log unificado do macOS nao foram executados em maquina real; so o tratamento da saida foi testado.
- Traps SNMP v3 nao sao recebidos.
- Sem MIBs: OIDs numericos; o console traz alguns modelos de sensor como atalho.
- Buffers do coletor SNMP (resultados e traps pendentes) ficam em memoria e se perdem se o agente reiniciar com o servidor fora.
- Log do Windows limpo entre dois ciclos perde os eventos desse intervalo.
- `rtt_ms` chega em milissegundos inteiros; em rede local aparece como 0 ms.
- A tag `v2.13.0` (e a `v2.12.0`) precisa ser criada no GitHub depois do merge; ate la `AGENT_VERSION` continua em 2.11.0.
