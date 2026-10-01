# ADR-011: Decisoes tecnicas da fase 2 (acoes sobre o agente)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Permissoes separadas por risco**: `agents.view` (leitura), `agents.run` (comandos, scripts e terminal) e `agents.control` (processos, servicos, registro, energia). Toda acao que altera a maquina vai para a auditoria.
2. **Validacao do shell no servidor**: no Windows o agente so aceita `cmd` e `powershell`; outro valor derruba o processo do agente. O backend recusa qualquer outro shell antes de enviar.
3. **Tempo esgotado vira HTTP 504 `AGENT_TIMEOUT`**, para o console distinguir "agente nao respondeu" de erro de validacao.
4. **Historico do agente** grava comandos e scripts antes do envio; o resultado chega pela resposta NATS e tambem pela rota `histresult` que o agente chama.
5. **Variaveis e snippets resolvidos no servidor**: `{{agent.*}}`, `{{client.name}}`, `{{site.name}}` e `{{global.NOME}}` (keystore) em argumentos e variaveis de ambiente; `{{nome_do_snippet}}` no corpo do script. URL actions usam as mesmas variaveis, codificadas para URL.
6. **Terminal por SignalR**: o navegador fala com o hub, a API repassa ao agente pelo NATS e devolve a saida como bytes crus em base64, sem decodificar texto, para nao quebrar caracteres acentuados divididos entre blocos. A sessao vive na replica que atende o WebSocket e e encerrada quando o navegador desconecta.
7. **Reiniciar servico = parar e iniciar**: o agente so implementa as acoes `start` e `stop`.
8. **Conexao com o PostgreSQL sem criptografia GSS** (`GSS Encryption Mode=Disable`), porque a imagem nao tem Kerberos e o banco esta na rede interna.

## Validacao
Testado com o binario real do agente Go em Linux pela pilha completa (Nginx, duas replicas da API, NATS): comando, script com variaveis e codigo de saida, processos, historico e terminal com acentuacao.

## Limites conhecidos
- Wake-on-LAN depende do MeshCentral (fase 4).
- Servicos, Event Log e registro so existem no agente Windows; nao foram testados com agente Windows real nesta fase.
- Execucao em massa (varios agentes) fica para a fase 3, junto com automacao.
