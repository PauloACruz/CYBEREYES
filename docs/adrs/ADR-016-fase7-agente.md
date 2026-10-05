# ADR-016: Decisoes tecnicas da fase 7 (Cybereyes Care no agente, Health Check e autoatendimento)

- **Status**: Aprovado
- **Data**: 2026-10-01
- **Nota**: o modulo aparecia no console com o nome da suite de origem ate a renomeacao do produto; desde o ADR-019 ele se chama Cybereyes Care. Os nomes definidos pelo agente citados abaixo sao contrato e nao mudaram.

## Decisoes
1. **Catalogo como fonte unica no agente** (`agent/wincare/catalog.json`, embutido): o console sempre pede o catalogo a propria maquina, entao cada agente mostra exatamente o que a versao instalada executa. O servidor nao guarda copia.
2. **Modulos do WinCare Pro como scripts embutidos** (`go:embed`): PowerShell sem WinForms rodando como SYSTEM no Windows (perfis de usuario percorridos em `C:\Users` e `HKU`; acoes que exigem a sessao do usuario via tarefa agendada temporaria) e bash para Linux e macOS. Um harness comum emite linhas `##WC {json}`; o agente transforma em eventos com `seq` e publica em `<agent_id>.cmdoutput.<run_id>`, assunto que o agente ja tinha permissao para publicar.
3. **Estado da execucao derivado dos eventos**: os eventos sao gravados por `(run_id, seq)` unico; progresso e status por tarefa sao calculados na leitura. So o evento final altera a linha da execucao. Assim duas replicas da API recebendo eventos em paralelo nao disputam a mesma linha, e eventos repetidos ou fora de ordem nao causam erro.
4. **Uma execucao por vez em cada agente**, com tempo limite (2 h; Windows Update 4 h) aplicado no agente e verificado no servidor.
5. **Health Check reescrito em Go** com nota ponderada; itens que nao se aplicam ao sistema ficam fora da conta. Coleta sob demanda e a cada 6 horas para agentes 2.12.0 ou superiores.
6. **Autoatendimento com dupla trava**: a tarefa precisa estar marcada como segura no catalogo (`selfService`) e liberada pelo tecnico nas configuracoes. Cada execucao pelo app gera auditoria com o usuario da maquina.
7. **Publicacao por tag** no repositorio do agente, com os nomes de arquivo que a API ja usa para download e somas SHA-256.
8. **Coleta de logs e coletor SNMP movidos para a fase 8**, junto com a ingestao no servidor, para serem entregues e testados de ponta a ponta.

## Validacao
- Agente 2.12.0 real em Linux: catalogo pelo console, execucao de manutencao e de testes de componentes com eventos em tempo real no navegador, status por tarefa, resultados estruturados e status final coerente; Health Check com nota 83.
- Testes do backend com agente falso usando as permissoes reais de NATS: eventos fora de ordem e repetidos, execucao ocupada (409), tarefa invalida (400), Health Check guardado e autoatendimento limitado as tarefas liberadas.
- Scripts PowerShell com sintaxe validada e harness executado no pwsh do Linux.

## Problemas encontrados no teste real e corrigidos
- A limpeza de `/tmp` apagava arquivos recem-extraidos de pacotes (que mantem a data de modificacao original). Agora exige modificacao, acesso e alteracao de metadados com mais de 7 dias, como o `systemd-tmpfiles`.
- Volumes de imagem pequenos (sempre cheios) derrubavam a nota de disco; agora sao ignorados.
- O servidor procurava o numero de serie em outra chave; passou a ler `serialnumber`.

## Limites conhecidos
- A tag `v2.12.0` nao pode ser enviada a partir do ambiente de desenvolvimento (o push da tag foi recusado). A publicacao depende de criar a tag no GitHub; ate la a API continua distribuindo a 2.11.0 (`AGENT_VERSION`).
- Nenhuma acao do Windows foi executada em Windows real (SFC, DISM, Windows Update, WMI, Appx, tarefa na sessao do usuario, cancelamento por arvore de processos). O codigo compila e os scripts tem sintaxe valida.
- macOS nao foi executado.
- Acoes que dependem da sessao do usuario terminam com aviso quando ninguem esta logado.
- `rebootRequired` vem do catalogo (tarefa marcada como exige reinicio), nao de verificacao real apos a execucao.
