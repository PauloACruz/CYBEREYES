# Contrato - Fase 8 (logs de sistema e SNMP)

Mesmo padrao das fases anteriores. Agente 2.13.0; o contrato das fases 1 e 7 continua valido.

## 1. Visao geral

```mermaid
flowchart LR
    subgraph Maquina
      A[Agente] -->|journald / Event Log / log unificado| A
    end
    subgraph Site
      C[Agente coletor] -->|SNMP v2c/v3 polling| D[Switch / impressora / roteador]
      D -->|traps UDP 162| C
    end
    A -->|POST /api/v3/logs/ lotes| S[API]
    C -->|GET /api/v3/{id}/snmp/ config| S
    C -->|POST /api/v3/snmp/results/| S
    C -->|POST /api/v3/snmp/traps/| S
    S --> P[(PostgreSQL particionado por mes)]
    S -->|SignalR| Console
```

Escolha de transporte: REST (e nao NATS) para logs e SNMP, porque sao lotes de dados que precisam de confirmacao de entrega e repeticao pelo agente quando o servidor estiver fora.

## 2. Logs de sistema

### 2.1 Agente
- Le a configuracao em `GET /api/v3/{agent_id}/logconfig/` (na partida e a cada 10 minutos): `{ "enabled": bool, "min_level": "error"|"warning"|"info", "windows_logs": ["System","Application"], "max_per_cycle": 500 }`.
- Coleta a cada 60 segundos, a partir da ultima posicao lida (guardada em arquivo de estado do agente, para nao reenviar nem perder entre reinicios):
  - Windows: Event Log (`System`, `Application` e os da lista), por `RecordId`.
  - Linux: journald (`journalctl -o json --after-cursor`), prioridade minima conforme `min_level`.
  - macOS: log unificado (`log show --style ndjson --start`), tipos `error` e `fault` (e `default` com `min_level` info).
  - Na primeira execucao comeca do momento atual (nao envia historico).
- Envia em `POST /api/v3/logs/` (autenticacao do agente), no maximo `max_per_cycle` entradas por ciclo; o excedente vira uma entrada `level: "warning"`, `source: "wincare-agent"`, `message: "N eventos descartados pelo limite"`. Se o envio falhar, mantem o lote e tenta de novo no proximo ciclo (sem avancar a posicao).

Corpo do lote:
```
{ "entries": [ { "time": RFC3339, "level": "critical"|"error"|"warning"|"info", "source": string (provedor/unidade/subsistema, ate 200),
                  "log": string ("System", "Application", "journal", "unified"...), "event_id": number|null, "message": string (ate 8000),
                  "host": string|null } ] }
```
Resposta `"ok"`; 400 com lote maior que 1000 entradas ou 2 MB.

### 2.2 Servidor
- Tabela `system_logs` particionada por mes (`PARTITION BY RANGE (time)`), chave `(id, time)`, indices `(agent_id, time)`, `(time)`, `(level, time)`. Um servico cria as particoes do mes atual e do proximo e apaga as que ficaram inteiras fora da retencao (`logRetentionDays`, padrao 30).
- Origem de cada linha: `agent_id` (agente que enviou) ou `snmp_device_id` (trap).

| Metodo | Rota | Permissao | Resposta |
|---|---|---|---|
| GET | `/api/logs?agentId=&clientId=&deviceId=&level=&source=&search=&from=&to=&before=&limit=` | `logs.view` | `{ items: LogEntryDto[], nextBefore }` mais recentes primeiro; `from`/`to` padrao ultimas 24 h, janela maxima de 31 dias; `level` e o minimo; paginacao por cursor (`before` = `nextBefore` da pagina anterior); `limit` ate 500 |
| GET | `/api/logs/summary?agentId=&clientId=&from=&to=` | `logs.view` | `{ byLevel: {critical, error, warning, info}, bySource: [{source, count}] (top 10), perHour: [{hour, critical, error, warning, info}] }` |
| GET/PUT | `/api/logs/settings` | `settings.manage` (GET tambem `logs.view`) | `{ enabled, minLevel, windowsLogs: string[], maxPerCycle, retentionDays }` |

`LogEntryDto`: `{ id, time, receivedAt, agentId, hostname, deviceId, deviceName, clientName, level, source, log, eventId, message }`.

### 2.3 Alertas de log
Regras globais ou por cliente: `LogAlertRule { id, name, clientId?, minLevel, sourceContains?, messageContains?, threshold (ocorrencias), windowMinutes, severity ("info"|"warning"|"error"), enabled }`.
- Avaliadas a cada minuto sobre as entradas novas; quando uma maquina (ou dispositivo) atinge `threshold` ocorrencias na janela, cria alerta `alertType: "log"` com a regra e a ultima mensagem; nao repete enquanto o alerta estiver aberto; resolve sozinho apos `windowMinutes` sem novas ocorrencias.
- CRUD em `/api/log-alert-rules` (`alerts.manage`).

## 3. SNMP

### 3.1 Papel de coletor
- Agente marcado como coletor no console (`PUT /api/agents/{id}/snmp-collector { enabled }`, `agents.manage`). So agentes 2.13.0 ou superiores.
- O agente consulta `GET /api/v3/{agent_id}/snmp/` a cada 5 minutos: `{ "enabled": bool, "trap_port": 162, "devices": [SnmpPollTarget] }`. Nao coletor recebe `{ enabled: false, devices: [] }`.

`SnmpPollTarget`:
```
{ "id", "host", "port", "version": "v2c"|"v3", "community", "v3": { "username", "security_level": "noAuthNoPriv"|"authNoPriv"|"authPriv",
  "auth_protocol": "SHA"|"SHA256"|"SHA512"|"MD5", "auth_password", "priv_protocol": "AES"|"AES256"|"DES", "priv_password" },
  "interval": segundos (60 a 3600), "timeout": segundos, "retries", "interfaces": bool,
  "sensors": [ { "id", "oid" } ] }
```
Credenciais ficam cifradas no banco (cofre da fase 6, `VAULT_KEY`) e so sao decifradas nesta resposta ao coletor (TLS + token do agente).

### 3.2 Coleta (agente coletor, biblioteca gosnmp)
A cada `interval` por dispositivo:
- Grupo system: `sysDescr`, `sysObjectID`, `sysUpTime`, `sysContact`, `sysName`, `sysLocation`.
- Se `interfaces`: `ifIndex`, `ifDescr`, `ifName`, `ifAlias`, `ifType`, `ifSpeed`/`ifHighSpeed`, `ifAdminStatus`, `ifOperStatus`, contadores 64 bits `ifHCInOctets`/`ifHCOutOctets` (32 bits como alternativa), `ifInErrors`, `ifOutErrors`.
- Sensores: GET de cada OID (valor numerico; texto vira `null` com o texto em `text`).

`POST /api/v3/snmp/results/`:
```
{ "results": [ { "device_id", "time", "reachable": bool, "error": string|null, "rtt_ms",
   "system": { "descr", "object_id", "uptime_ticks", "contact", "name", "location" } | null,
   "interfaces": [ { "index", "name", "descr", "alias", "type", "speed_bps", "admin_status", "oper_status", "in_octets", "out_octets", "in_errors", "out_errors", "hc": bool } ],
   "sensors": [ { "id", "value": number|null, "text": string|null } ] } ] }
```

### 3.3 Traps
- O coletor escuta UDP `trap_port` e encaminha cada trap v1/v2c em `POST /api/v3/snmp/traps/`: `{ "traps": [ { "time", "source_ip", "version", "community", "trap_oid", "varbinds": [ { "oid", "type", "value" } ] } ] }`.
- O servidor associa pelo `source_ip` ao dispositivo com o mesmo `host` (do mesmo cliente do coletor), grava como log (`source: "snmp-trap"`, `log: "trap"`, nivel conforme `trapSeverity` do dispositivo, mensagem com OID e varbinds) e, se `trapSeverity` for diferente de `none`, cria alerta `alertType: "snmp_trap"`. Trap de origem desconhecida vira log do coletor com nivel `info`. A comunidade do trap precisa bater com a do dispositivo (v2c); traps v3 nao sao recebidos nesta fase.

### 3.4 Servidor
Entidades: `SnmpDevice { id, clientId, siteId?, collectorAgentId, assetId?, name, host, port, version, communityEncrypted?, v3 (usuario, nivel, protocolos, senhas cifradas), interval, timeout, retries, pollInterfaces, enabled, trapSeverity ("none"|"info"|"warning"|"error"), status ("up"|"down"|"unknown"), lastPolledAt, lastError, failCount, sysName, sysDescr, sysObjectId, sysLocation, sysContact, uptimeSeconds }`, `SnmpInterface { deviceId, index, name, descr, alias, type, speedBps, adminStatus, operStatus, lastIn, lastOut, lastAt, inBps, outBps, inErrors, outErrors, monitored (alerta se cair) }`, `SnmpSensor { id, deviceId, name, oid, unit, warnAbove?, critAbove?, warnBelow?, critBelow?, lastValue, lastText, lastAt }`, `SnmpSample { deviceId, metric ("if:<index>:in", "if:<index>:out", "sensor:<id>", "rtt"), time, value }` (particionada por mes, mesma retencao dos logs).

Regras:
- Taxa de interface = diferenca do contador / tempo (bits por segundo); reinicio de contador ou volta (valor menor) descarta a amostra.
- `down` depois de 2 coletas seguidas sem resposta; alerta `alertType: "snmp_device"` (erro) ao cair e resolvido ao voltar.
- Interface `monitored` que muda de `up` para `down` com `adminStatus` `up` gera alerta `snmp_interface` (aviso); resolve ao voltar.
- Sensor fora dos limites gera alerta `snmp_sensor` (aviso ou erro conforme o limite); resolve ao voltar.
- Alertas de SNMP ficam associados ao dispositivo (`snmpDeviceId`) e nao a um agente; aparecem na lista de alertas com o nome do dispositivo e seguem os templates e incidentes da fase 3 e 5 (o incidente fica sem maquina e com o nome do dispositivo no titulo).
- Dispositivo pode ser ligado a um ativo do inventario (`assetId`); a ficha do ativo mostra o status SNMP.

| Metodo | Rota | Permissao | Resposta |
|---|---|---|---|
| GET | `/api/snmp/devices?clientId=&status=` | `snmp.view` | `[SnmpDeviceDto]` |
| GET | `/api/snmp/devices/{id}` | `snmp.view` | `SnmpDeviceDto` mais `interfaces`, `sensors` |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/snmp/devices` | `snmp.manage` | `SaveSnmpDevice` (credenciais so na escrita; ausentes no PUT mantem as atuais) |
| POST | `/api/snmp/devices/test` | `snmp.manage` | `SaveSnmpDevice` -> pede ao coletor um teste imediato (NATS `snmp_test`) e devolve `{ reachable, error, rttMs, system }`; 504 se o coletor nao responder |
| PUT | `/api/snmp/devices/{id}/interfaces/{index}` | `snmp.manage` | `{ monitored }` |
| POST, PUT `/{sensorId}`, DELETE `/{sensorId}` | `/api/snmp/devices/{id}/sensors` | `snmp.manage` | `{ name, oid, unit, warnAbove, critAbove, warnBelow, critBelow }` |
| GET | `/api/snmp/devices/{id}/metrics?metric=&from=&to=` | `snmp.view` | `{ metric, points: [{ time, value }] }` (ate 1000 pontos; agrega por media quando a janela tiver mais) |
| GET | `/api/snmp/collectors` | `snmp.view` | agentes coletores `[{ agentId, hostname, clientId, siteId, status, version, deviceCount }]` |

`SnmpDeviceDto`: `{ id, clientId, clientName, siteId, collectorAgentId, collectorHostname, assetId, name, host, port, version, interval, enabled, trapSeverity, status, lastPolledAt, lastError, sysName, sysDescr, sysLocation, sysContact, uptimeSeconds, hasCredentials, interfaceCount, interfacesDown }`.

Comando NATS do agente coletor: `snmp_test` com `payload.target` = JSON de um `SnmpPollTarget` (sem `id`); resposta string JSON `{ reachable, error, rtt_ms, system }`.

Permissoes novas: `logs.view`, `snmp.view`, `snmp.manage`. O papel padrao "Tecnico" recebe as tres em instalacoes novas.

Tempo real: evento `snmpDeviceChanged(SnmpDeviceDto)` no hub do console quando o status muda.

## 4. Limites desta fase
- Traps SNMP v3 nao sao recebidos (registrado no ADR-006).
- Sem MIBs: OIDs sao numericos; o console traz alguns modelos prontos de sensores (impressoras: nivel de suprimentos; geral: temperatura) apenas como atalhos de preenchimento.
- Logs do Windows: somente os logs configurados (padrao `System` e `Application`); `Security` pode ser incluido, mas aumenta muito o volume.

## 5. Detalhes definidos na implementacao
- `POST /api/snmp/devices/test` aceita `id` opcional no corpo: com ele, credenciais em branco usam as guardadas no dispositivo (teste na tela de edicao).
- `GET /api/logs/summary` tambem aceita `deviceId`.
- `GET /api/snmp/devices/{id}` devolve ainda `timeout`, `retries`, `pollInterfaces`, `sysObjectId` e `v3` (usuario, nivel e protocolos, sem senhas).
- `GET /api/agents/{id}` passa a trazer `snmpCollector`.
- A ficha do ativo (`GET /api/assets/{id}`) traz `snmp`: dispositivos ligados ao ativo com `id`, `name`, `host`, `status`, `lastPolledAt`, `lastError`, `sysName` e `uptimeSeconds`.
- Queda de interface considera `operStatus` `down` ou `lowerLayerDown` com `adminStatus` `up`.
- Alertas: `AlertDto` ganhou `snmpDeviceId` e `deviceName`; `agentId` e `hostname` ficam nulos em alertas de dispositivo.
