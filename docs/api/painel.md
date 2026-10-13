# API do Painel

## Visao geral

| Metodo | Rota | Permissao | Resposta |
|---|---|---|---|
| GET | `/api/dashboard/overview?clientId=&technicianId=&days=` | usuario autenticado | `DashboardOverview` |

Parametros:

- `clientId` (opcional): limita estacoes, checks e chamados a um cliente.
- `technicianId` (opcional): id do usuario responsavel pelo chamado (`Ticket.AssignedToId`). Vale so para os chamados: estacoes e checks nao tem tecnico.
- `days`: `7`, `14` ou `30` (padrao `30`); outro valor responde 400.

Resposta:

```json
{
  "from": "2026-09-14",
  "to": "2026-10-13",
  "agents": { "total": 24, "online": 19, "overdue": 2, "offline": 3,
              "byClient": [{ "clientId": 1, "clientName": "Clinica Central", "total": 9, "online": 8, "overdue": 0, "offline": 1 }] },
  "tickets": { "open": 8, "unassigned": 2, "breached": 1, "openedInPeriod": 96, "resolvedInPeriod": 90,
               "days": [{ "date": "2026-10-13", "opened": 3, "resolved": 4 }] },
  "checks": { "total": 66465, "passing": 65826, "failing": 639, "historyDays": 30,
              "days": [{ "date": "2026-10-13", "passing": 2200, "failing": 18 }] }
}
```

Regras:

- `agents` e `checks` vem nulos sem `agents.view`; `tickets` vem nulo sem `tickets.view`.
- O escopo de clientes do usuario vale como em toda a API (filtros globais do EF).
- Os dias seguem o fuso configurado no console (`CoreSettings.TimeZone`).
- `agents` e o estado atual: o sistema nao guarda historico de online por dia.
- `checks` conta as execucoes de `check_history`, que guarda `CheckHistoryDays` dias (padrao 30). Dias mais antigos vem com zero.
- `tickets.unassigned` vem `0` quando ha filtro de tecnico.
- `tickets.breached` usa a mesma regra de `/api/tickets/summary`.
