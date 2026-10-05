# ADR-010: Decisoes tecnicas da fase 1 (contrato do agente)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Compatibilidade total com o agente Go 2.11.0**: as rotas `/api/v3` e o protocolo NATS seguem o comportamento do Tactical RMM, inclusive respostas como a string JSON `"ok"`. Validado com o binario real do `rmmagentwincare` (registro, check-in e ping).
2. **IDs inteiros** para clientes, sites e agentes, porque o agente envia `site` como numero e recebe `pk` inteiro.
3. **Tokens guardados como hash**: SHA-256 para autenticar o REST e bcrypt para a senha no NATS (o NATS aceita senhas bcrypt). O token em texto puro so existe na resposta do registro, dentro do agente.
4. **Usuarios do NATS em arquivo gerado pelo backend** (`/etc/nats/auth/users.conf`, volume compartilhado). O container do NATS observa o arquivo e recarrega a configuracao (`SIGHUP`) sem derrubar conexoes. Escrita atomica e somente quando o conteudo muda.
5. **Check-in em grupo de fila** (`cybereyes-api`): com varias replicas da API, cada mensagem e processada uma unica vez.
6. **Status gravado no banco**: um servico verifica a cada 30 s e grava `online`, `offline` ou `overdue` com atualizacao condicional; so a replica que efetivamente muda o registro avisa o console (sem avisos duplicados).
7. **Tempo real com SignalR somente por WebSockets** e backplane Redis, sem necessidade de sessao fixa no Nginx.
8. **Instalacao Linux por linha de comando com deteccao do ambiente**: o script considera estacao (workstation) quando existe gerenciador de login grafico habilitado ou sessoes X11/Wayland instaladas, e servidor quando ha somente terminal. O alvo `graphical.target` nao e usado sozinho porque varias instalacoes de servidor o trazem como padrao.
9. **Binarios do agente servidos pelo proprio servidor** (`infra/docker/agents`), com redirecionamento para os releases do GitHub quando o arquivo nao existe localmente.

## Limites conhecidos
- MeshCentral fica fora do registro ate a fase 4 (instalacao com `-nomesh`).
- Checks, tarefas, Windows Update e historico de scripts respondem `"ok"` sem efeito ate as fases 2 e 3.
- O instalador Windows depende do instalador Inno Setup do agente, que sera publicado no pipeline do agente (fase 7).
