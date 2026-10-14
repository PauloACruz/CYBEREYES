# API de Procedimentos nos agentes

Todo procedimento feito num agente vira um registro com técnico, início, fim, duração e resultado. Ele pode entrar num chamado
como apontamento de horas (tempo de serviço) ou gerar um chamado. Decisão em `docs/adrs/ADR-026-procedimentos-nos-agentes.md`.

## O que é registrado

| Tipo (`kind`) | Quando | Início e fim |
|---|---|---|
| `remote` / `files` | Acesso remoto (tela, RDP) ou só arquivos | Da criação da sessão ao encerramento. Não conectou: `cancelled` com o motivo em `detail` |
| `care` | Execução do Cybereyes Care (console ou app de bandeja) | Do pedido ao evento `done`, cancelamento ou tempo esgotado |
| `command` / `script` | Comando e script | Em volta da chamada ao agente; script com código diferente de 0 é `error` |
| `rename` | Alterar hostname | Em volta do script de renomear |
| `terminal` | Terminal do agente | Da abertura ao fechamento (técnico, agente ou conexão) |
| `reboot` / `shutdown` | Reiniciar / desligar | Pedido ao agente |
| `service` / `process` / `registry` | Serviço (iniciar, parar, reiniciar, inicialização), processo encerrado, gravação no registro | Em volta da chamada ao agente |
| `software` | Instalação pelo winget ou Chocolatey | Do pedido ao resultado devolvido pelo agente |
| `updates` | Instalação das atualizações aprovadas do Windows | Pedido ao agente (o Windows Update não avisa o fim) |
| `task` | Tarefa rodada à mão | Do pedido ao resultado da tarefa; as agendadas não contam |
| `wake` | Wake-on-LAN | Envio pelo agente vizinho |
| `agent_update` | Atualização do EYES | Pedido ao agente |
| `startup` | Programa da inicialização do Windows habilitado ou desabilitado | Em volta do script de inicialização |

Situações (`status`): `running`, `ok`, `warning`, `error`, `cancelled`, `timeout`. Um procedimento ainda `running` depois de 24 horas
(servidor reiniciado com terminal aberto, agente que nunca respondeu) é fechado como `error` sem duração, para não inflar os indicadores.

O registro guarda cliente e hostname: continua valendo para os indicadores se o agente for removido (`agentId` fica nulo).

## Rotas

| Método | Rota | Permissão | Resposta |
|---|---|---|---|
| GET | `/api/procedures` | `agents.view` | `ProcedurePage` |
| GET | `/api/tickets/{id}/procedures` | `tickets.view` | `ProcedureDto[]` |
| POST | `/api/tickets/{id}/procedures` | `agents.view` e `tickets.manage` | `ProcedureDto[]` |
| DELETE | `/api/tickets/{id}/procedures/{procedureId}` | `tickets.manage` | 204 |
| POST | `/api/procedures/ticket` | `agents.view` e `tickets.manage` | 201 `{ "id": 120 }` |

### GET /api/procedures

Filtros (todos opcionais): `agentId`, `clientId`, `userId` (quem fez), `kind`, `status`, `ticketId`, `linked` (`true` só os que
estão em chamado, `false` só os sem chamado), `from` e `to` (datas `AAAA-MM-DD` no fuso do console, inclusivas), `page`,
`pageSize` (padrão 50, máximo 200). Ordem: mais recentes primeiro.

```json
{
  "items": [
    {
      "id": 812, "agentId": 1, "hostname": "PC-RECEPCAO", "clientId": 1, "clientName": "Clinica Central",
      "kind": "remote", "title": "Tela", "detail": null, "status": "ok", "source": "console",
      "userId": "3f7c...", "userName": "Maria Silva",
      "startedAt": "2026-10-14T13:00:00Z", "finishedAt": "2026-10-14T13:12:22Z", "durationSeconds": 742,
      "ticketId": 101, "ticketTitle": "Impressora nao imprime", "timeEntryId": 55, "serviceMinutes": 13
    }
  ],
  "total": 128, "page": 1, "pageSize": 50,
  "totals": { "count": 128, "seconds": 46380, "inTickets": 81, "serviceMinutes": 1260, "unlinked": 47 }
}
```

`totals` vale para o filtro inteiro, não só para a página. `source` é `console` ou `tray` (pedido pelo usuário da máquina no app
de bandeja; nesse caso `userId` é nulo e `userName` é o usuário da máquina).

### POST /api/tickets/{id}/procedures

```json
{ "items": [ { "procedureId": 812, "minutes": 15 }, { "procedureId": 815 } ] }
```

Cada procedimento vira um apontamento de horas do chamado (`time_entries`) com `minutes` de tempo de serviço (1 a 1440). Sem
`minutes`, vale a duração arredondada para cima (mínimo 1). A descrição do apontamento é "Tipo em HOST: título" e a data é o dia
do procedimento no fuso do console. O apontamento fica no nome de quem fez o procedimento (ou de quem incluiu, se foi pela bandeja).

Erros:

- 404: chamado ou procedimento inexistente (ou fora do escopo de clientes do usuário).
- 400: procedimento ainda em andamento, ou de outro cliente que não o do chamado.
- 409: procedimento já está num chamado.

### DELETE /api/tickets/{id}/procedures/{procedureId}

Tira o procedimento do chamado e exclui o apontamento dele. Mesma regra do apontamento: só quem tem o apontamento (ou o
superusuário). Excluir o apontamento por `DELETE /api/tickets/{id}/time/{entryId}` também devolve o procedimento para "sem chamado".

### POST /api/procedures/ticket

Atendimento feito sem chamado: cria o chamado com os procedimentos e o tempo deles.

```json
{ "procedureIds": [812, 815], "title": "Atendimento em PC-RECEPCAO", "description": "...", "type": "request", "priority": "low", "resolve": true }
```

- Todos do mesmo cliente. Uma máquina só: o chamado fica nela; várias: chamado do cliente, sem máquina.
- Atribuído a quem registra; com `resolve` já sai como resolvido.
- Mesmas validações da inclusão (em andamento, já em chamado).

### GET /api/tickets/{id}/time

Cada apontamento traz `procedureId` quando veio de um procedimento.

## Inclusão automática

O acesso remoto aberto a partir de um chamado (`ticketId` em `POST /api/agents/{id}/remote/sessions`) entra no chamado sozinho
quando a sessão termina, com a duração arredondada para cima como tempo de serviço.

## Indicadores no Painel

`GET /api/dashboard/overview` traz `procedures` (com `agents.view`), no período e nos filtros do Painel. O filtro de técnico
vale para quem fez o procedimento:

```json
"procedures": {
  "total": 128, "seconds": 46380, "inTickets": 81, "unlinked": 47,
  "days": [{ "date": "2026-10-14", "count": 6, "seconds": 900 }],
  "byKind": [{ "kind": "remote", "count": 46, "seconds": 30120 }],
  "byUser": [{ "userId": "3f7c...", "userName": "Maria Silva", "count": 71, "seconds": 26000 }]
}
```

## Carga inicial

A migração `Fase15Procedimentos` importa o que já existia: sessões remotas, execuções do Cybereyes Care, comandos e scripts do
histórico do agente e as ações da auditoria (reinício, desligamento, serviços, processos, registro, terminal, wake-on-LAN,
atualização do EYES, instalação de software e de atualizações, tarefa rodada à mão). Nada entra em chamado nessa carga; a duração
só existe para o que tinha início e fim (sessões, Care, scripts).
