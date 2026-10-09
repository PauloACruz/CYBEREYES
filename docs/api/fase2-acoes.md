# Contrato de API - Fase 2 (acoes sobre o agente)

Mesmo padrao das fases anteriores: cookie de sessao com 2FA, JSON em camelCase, erros em ProblemDetails com `code`.
Comandos que o agente nao responde a tempo retornam **504** com `code: "AGENT_TIMEOUT"`. Agente inexistente: 404.
Toda acao que altera algo na maquina gera registro de auditoria.

## Permissoes novas
| Chave | Uso |
|---|---|
| `agents.run` | Executar comandos, scripts e abrir terminal |
| `agents.control` | Encerrar processos, controlar servicos, editar registro, reiniciar e desligar |
| `scripts.view` | Ver a biblioteca de scripts e snippets |
| `scripts.manage` | Criar, editar e excluir scripts e snippets |
| `settings.manage` (existente) | Keystore global e URL actions |

Leitura de processos, servicos, Event Log, registro e historico usa `agents.view`.

## Historico do agente (`agents.view`)
`GET /api/agents/{id}/history?page=&pageSize=` -> `Paged<AgentHistoryDto>`

`AgentHistoryDto`: `{ id, time, type: "cmd_run" | "script_run", command, username, scriptId, scriptName, results, scriptResults: { stdout, stderr, retcode, executionTime } | null }`

## Comando (`agents.run`)
`POST /api/agents/{id}/command` `{ shell, command, timeout (10 a 3600 s), runAsUser }` -> `{ historyId, output }`

`shell`: Windows `cmd` ou `powershell`; Linux e macOS `/bin/bash`, `/bin/sh` ou `/bin/zsh`. Outro valor: 400.

## Scripts
| Metodo | Rota | Permissao | Corpo / resposta |
|---|---|---|---|
| GET | `/api/scripts` | `scripts.view` | `ScriptDto[]` (sem `body`) |
| GET | `/api/scripts/{id}` | `scripts.view` | `ScriptDto` com `body` |
| POST | `/api/scripts` | `scripts.manage` | `SaveScript` -> 201 `ScriptDto` |
| PUT | `/api/scripts/{id}` | `scripts.manage` | `SaveScript` -> `ScriptDto` |
| DELETE | `/api/scripts/{id}` | `scripts.manage` | 204 |
| GET | `/api/scripts/snippets` | `scripts.view` | `SnippetDto[]` |
| POST | `/api/scripts/snippets` | `scripts.manage` | `SaveSnippet` -> 201 |
| PUT | `/api/scripts/snippets/{id}` | `scripts.manage` | `SaveSnippet` |
| DELETE | `/api/scripts/snippets/{id}` | `scripts.manage` | 204 |

`ScriptDto`: `{ id, name, description, category, shell, body?, defaultArgs: string[], envVars: string[], defaultTimeout, runAsUser, platforms: string[], createdBy, updatedAt }`
`SaveScript`: `{ name, description, category, shell, body, defaultArgs, envVars, defaultTimeout (5 a 86400), runAsUser, platforms }`
`shell`: `powershell`, `cmd`, `python`, `shell` (Linux e macOS, usa o shebang do script), `nushell`, `deno`.
`platforms`: subconjunto de `windows`, `linux`, `darwin`.
`SnippetDto`: `{ id, name, description, shell, code }`. No corpo do script, `{{nome_do_snippet}}` e substituido pelo codigo do snippet.

### Executar script (`agents.run`)
`POST /api/agents/{id}/runscript` `{ scriptId, args?: string[], envVars?: string[], timeout?, runAsUser? }` -> `{ historyId, stdout, stderr, retcode, executionTime }`

Valores ausentes usam os padroes do script. Variaveis aceitas em argumentos e variaveis de ambiente: `{{agent.hostname}}`, `{{agent.agent_id}}`, `{{agent.description}}`, `{{agent.public_ip}}`, `{{client.name}}`, `{{site.name}}`, `{{global.NOME}}` (keystore). Script incompativel com o sistema do agente: 400.

## Processos
| Metodo | Rota | Permissao | Resposta |
|---|---|---|---|
| GET | `/api/agents/{id}/processes` | `agents.view` | `[{ pid, name, username, memBytes, cpuPercent }]` |
| DELETE | `/api/agents/{id}/processes/{pid}` | `agents.control` | 204; 400 com a mensagem do agente se falhar |

## Servicos (somente Windows; 400 em outros sistemas)
| Metodo | Rota | Permissao | Corpo / resposta |
|---|---|---|---|
| GET | `/api/agents/{id}/services` | `agents.view` | `[{ name, displayName, status, startType, autodelay, pid, binpath, username, description }]` (lista ao vivo) |
| GET | `/api/agents/{id}/services/{name}` | `agents.view` | detalhe do servico |
| POST | `/api/agents/{id}/services/{name}/action` | `agents.control` | `{ action: "start" \| "stop" \| "restart" }` (reiniciar = parar e iniciar) -> `{ success, message }` |
| PUT | `/api/agents/{id}/services/{name}/start-type` | `agents.control` | `{ startType: "auto" \| "autodelay" \| "manual" \| "disabled" }` -> `{ success, message }` |

## Event Log (somente Windows)
`GET /api/agents/{id}/eventlog/{logName}?days=1` (`agents.view`), `logName`: `Application`, `System` ou `Security`, `days` de 1 a 30 -> `[{ source, eventType, eventId, message, time }]`

## Registro do Windows
| Metodo | Rota | Permissao | Corpo / resposta |
|---|---|---|---|
| GET | `/api/agents/{id}/registry?path=&page=1` | `agents.view` | `{ path, subkeys: [{ name, hasSubkeys }], values: [{ name, type, data }], hasMore }`; sem `path` lista as raizes (HKLM, HKCU...) |
| POST | `/api/agents/{id}/registry/keys` | `agents.control` | `{ path }` |
| DELETE | `/api/agents/{id}/registry/keys?path=` | `agents.control` | |
| PUT | `/api/agents/{id}/registry/keys/rename` | `agents.control` | `{ oldPath, newPath }` |
| POST | `/api/agents/{id}/registry/values` | `agents.control` | `{ path, name, type, data }` |
| PUT | `/api/agents/{id}/registry/values` | `agents.control` | `{ path, name, type, data }` |
| PUT | `/api/agents/{id}/registry/values/rename` | `agents.control` | `{ path, oldName, newName }` |
| DELETE | `/api/agents/{id}/registry/values?path=&name=` | `agents.control` | |

As rotas de escrita respondem `{ success: true }` ou 400 com a mensagem de erro do agente.
`type`: `REG_SZ`, `REG_EXPAND_SZ`, `REG_MULTI_SZ`, `REG_DWORD`, `REG_QWORD`, `REG_BINARY`.

## Energia e atualizacao de dados (`agents.control`)
- `POST /api/agents/{id}/reboot` -> 202
- `POST /api/agents/{id}/shutdown` -> 202
- `POST /api/agents/{id}/refresh` (`agents.view`) -> 202 (pede ao agente para reenviar inventario: sistema, discos, WMI, IP)

## Renomear computador (`agents.control`, so Windows)
`POST /api/agents/{id}/rename` `{ newName, restart, domainUser?, domainPassword? }` -> `{ historyId, retcode, result, stdout, stderr }`

Roda pelo agente, como SYSTEM, o script embutido `backend/src/Cybereyes.Api/Rmm/Actions/Scripts/win-conf-renomear-computador.ps1`
(`-NovoNome <nome> -Confirmar`, mais `-Reiniciar` com `restart: true`; tempo limite de 120 s). `newName`: de 1 a 15 letras sem
acento, numeros e hifen, sem hifen nas pontas e nao so numeros (400 fora disso). Maquina no dominio precisa de `domainUser` e
`domainPassword` (os dois juntos), que vao ao agente so como variaveis de ambiente: nao entram nos argumentos, no historico nem na
auditoria. `result` e a linha `RESULTADO` do script; `retcode`: 0 renomeado com reinicio agendado em 5 min (ou o nome ja era esse),
3010 renomeado e falta reiniciar, 1 renomeado com alerta (SQL Server), 2 falha, 3 recusado (nome invalido, controlador de dominio,
Autoridade Certificadora, credencial ausente). O hostname do console muda sozinho no primeiro check-in depois do reinicio.

## Terminal (SignalR, hub `/hubs/console`, `agents.run`)
| Metodo do hub | Parametros | Retorno |
|---|---|---|
| `StartTerminal` | `agentPk: number, cols: number, rows: number, shell: string \| null` | `sessionId: string` |
| `TerminalInput` | `sessionId, data: string` | |
| `ResizeTerminal` | `sessionId, cols, rows` | |
| `StopTerminal` | `sessionId` | |

Eventos enviados ao navegador:
- `terminalOutput` `(sessionId: string, data: string)` com os bytes em **base64** (escrever no xterm como `Uint8Array`)
- `terminalClosed` `(sessionId: string, exitCode: number, message: string | null)`

Shell padrao: Windows `cmd` (aceita `powershell`), Linux e macOS `/bin/bash`. Sessoes sao encerradas quando o navegador desconecta. Inicio e fim de sessao vao para a auditoria.

## Keystore global (`settings.manage`)
`GET/POST /api/keystore`, `PUT/DELETE /api/keystore/{id}`. `KeyDto`: `{ id, name, value }`. `name`: letras, numeros e `_`.

## URL actions
| Metodo | Rota | Permissao |
|---|---|---|
| GET | `/api/url-actions` | `agents.view` |
| POST, PUT `/{id}`, DELETE `/{id}` | `/api/url-actions` | `settings.manage` |
| GET | `/api/agents/{id}/url-actions/{actionId}` | `agents.view` -> `{ url }` com as variaveis substituidas |

`UrlActionDto`: `{ id, name, description, pattern }`. `pattern` aceita as mesmas variaveis dos scripts (valores codificados para URL).
