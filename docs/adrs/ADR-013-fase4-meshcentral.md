# ADR-013: Decisoes tecnicas da fase 4 (acesso remoto com MeshCentral)

> **Nota (fase 12.8)**: este ADR foi substituido pelo ADR-023 (`docs/adrs/ADR-023-acesso-remoto-proprio.md`). O MeshCentral, o MeshAgent e a integracao descrita abaixo foram removidos do Cybereyes; o acesso remoto agora e proprio, embutido no EYES e na API (contrato em `docs/remoto/contrato-remoto.md`). O texto abaixo fica como registro historico.

- **Status**: Substituido pelo ADR-023 (fase 12.8)
- **Data**: 2026-10-01

## Decisoes
1. **Integracao direta pelo websocket `control.ashx`**, sem a biblioteca `meshctrl`: a API autentica com um token cifrado (AES-256-GCM com os primeiros 32 bytes da chave de login, mesmo formato do `encodeCookie` do MeshCentral) em nome do administrador interno.
2. **Bootstrap no container do MeshCentral**: na primeira partida o entrypoint cria o administrador interno com senha aleatoria (`--createaccount` e `--adminaccount`) e gera a chave de token (`--logintokenkey`, 160 caracteres) em um volume compartilhado, montado somente leitura na API. Nenhum segredo do MeshCentral fica no `.env`.
3. **Um usuario do MeshCentral por tecnico** (`ce-<usuario>`), criado para quem tem `agents.remote` ou e superusuario, com direitos de controle remoto, terminal e arquivos no grupo `Cybereyes` (direitos 252, sem administracao do grupo). Quem perde a permissao ou e desativado e removido. A auditoria do MeshCentral passa a mostrar o tecnico real, e nao uma conta compartilhada.
4. **Login sem segunda senha**: a API gera um token de login (`a: 3`) para o usuario do tecnico e abre `/?login=...&gotonode=...&viewmode=11|12|13&hide=31` em nova aba. Toda abertura gera auditoria no Cybereyes.
5. **Endereco interno separado** (`Mesh:InternalUrl`, `http://meshcentral:4443`) para as chamadas da API, sem desligar a verificacao de TLS; o endereco publico (`Mesh:Url`) so aparece nos links e no download do MeshAgent pelo script Linux.
6. **MeshAgent instalado junto com o agente**: no Linux pelo script `linux.sh` (o agente Go continua com `-nomesh`, porque o script ja instala o MeshAgent); no Windows e macOS o comando de instalacao deixa de usar `-nomesh` e o agente baixa o MeshAgent pela API (`/api/v3/meshexe/`), que repassa o binario do MeshCentral ja vinculado ao grupo.
7. **Sincronizacao** na partida, a cada 4 minutos e logo apos alteracoes em usuarios e papeis. Cada replica da API sincroniza de forma independente; os comandos sao idempotentes.

## Validacao
Testado com MeshCentral 1.2.5 real: criacao da conta e da chave pelo entrypoint, criacao do grupo, criacao do usuario `wc-admin` (prefixo da epoca; hoje `ce-`, ver ADR-019) com direitos 252 no grupo, link de login abrindo o MeshCentral autenticado (token invalido volta para a tela de login), download do MeshAgent Linux (ELF x86-64) pelo MeshCentral e do MeshAgent Windows (PE32+ x86-64) pela rota `meshexe` da API, Wake-on-LAN repassado ao MeshCentral.

## Limites conhecidos
- O controle remoto de uma maquina real (MeshAgent conectado e sessao de tela aberta) nao foi testado neste ambiente, que nao permite instalar o MeshAgent como servico; o formato dos links e o mesmo usado pelo Tactical RMM.
- O ID do grupo do MeshCentral contem `$` e `@`; o script Linux usa aspas simples para preservar o valor.
- Usuarios do MeshCentral criados por fora do Cybereyes (sem o prefixo `ce-`) nao sao tocados pela sincronizacao.
