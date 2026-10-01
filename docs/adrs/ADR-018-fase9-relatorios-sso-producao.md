# ADR-018: Decisoes tecnicas da fase 9 (relatorios, SSO e entrada em producao)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Relatorios
1. **Lista fechada de tipos** (agentes, inventario, alertas, chamados, atualizacoes do Windows, Health Check, disponibilidade SNMP), cada um com consulta fixa pelo EF e filtros validados. Nao ha editor de consultas nem SQL livre: elimina injecao de SQL e vazamento entre clientes. Relatorios novos entram como codigo.
2. **PDF com PDFsharp/MigraDoc 6 (licenca MIT)**. O QuestPDF foi descartado porque a licenca comunitaria tem limite de faturamento, e a finalidade comercial do produto ainda esta em analise juridica (ADR-005). A fonte DejaVu Sans vai embutida no assembly (licenca livre, arquivo `Reports/Fonts/DejaVu-LICENSE.txt`), entao o PDF sai igual em qualquer imagem, sem depender de fontes instaladas.
3. **Formato numerico brasileiro montado a mao**: a API roda com globalizacao invariante (sem ICU) e `CultureInfo("pt-BR")` nao existe no conteiner; datas usam padroes explicitos e o fuso de `CoreSettings.TimeZone`.
4. **CSV para Excel em portugues**: separador `;`, BOM UTF-8 e apostrofo antes de valores que comecam com `=`, `+`, `-`, `@` (protecao contra injecao de formula).
5. **Arquivos no banco** (`report_runs`), ate 25 MB, apagados apos 90 dias. Para o volume esperado (400 maquinas) evita um armazenamento de objetos so para isso.
6. **Agendamento por minuto com reserva do horario** (`report_dispatches` com chave unica por agendamento e horario), o mesmo padrao das tarefas da fase 3: varias replicas da API nao geram o mesmo relatorio duas vezes. Periodo sempre relativo (ultimas 24 h, 7 dias, 30 dias, mes anterior, mes atual), calculado no fuso configurado.
7. **Disponibilidade SNMP derivada dos alertas `snmp_device`** (inicio e fim de cada queda recortados ao periodo); nao ha tabela de historico de status.

## SSO (OIDC)
1. **Fluxo proprio sobre as bibliotecas de protocolo da Microsoft** (`Microsoft.IdentityModel.Protocols.OpenIdConnect` e `JsonWebTokenHandler`), e nao o handler `AddOpenIdConnect`: os provedores sao cadastrados pelo console e mudam sem reiniciar a API. Authorization code com PKCE (S256), `state` e `nonce` em cookie cifrado pelo Data Protection (10 min, `SameSite=Lax`, so no caminho `/api/auth/sso`, porque o retorno do provedor e uma navegacao vinda de outro site). id_token validado por assinatura (JWKS da descoberta), emissor, audiencia, validade e nonce.
2. **Vinculo em AspNetUserLogins** (`oidc:{id}` + `sub`). Vinculo por e-mail so com `email_verified` e configuracao explicita; criacao automatica so com papel padrao escolhido; dominios permitidos opcionais.
3. **2FA continua obrigatorio** (DoD): depois do SSO o usuario passa pelo TOTP local, como no login por senha, a menos que o provedor esteja marcado como confiavel e o token traga `amr` de MFA.
4. **Segredo do cliente no cofre** (`VAULT_KEY`), nunca devolvido pela API.
5. **Desativar login por senha** e global e nao vale para superusuarios: acesso de emergencia se o provedor cair.
6. **Erros do retorno** viram codigo na URL (`/login?ssoError=...`); o detalhe vai para o log e para a auditoria, sem expor resposta do provedor ao navegador.

## Entrada em producao
1. **CSP no Nginx** com `frame-src 'none'` e `frame-ancestors 'none'` (o MeshCentral abre em nova aba, nunca em iframe), `style-src 'unsafe-inline'` (Mantine e Monaco injetam estilos; nao ha script inline nem `eval` no bundle) e `connect-src` com o `wss://` do host. Tambem `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` e `Permissions-Policy`; o Nginx esconde os cabecalhos repetidos da API e do web.
2. **Limite de corpo de 30 MB** no console, alinhado ao Kestrel (o maior upload da API e 10 MB).
3. **Base `x-hardening` no compose**: `no-new-privileges`, `cap_drop: ALL`, rotacao de log; `cap_add` minimo por servico (nginx, web, nats e backup; API, Postgres, Redis, MeshCentral e certbot sem nenhuma); raiz somente leitura com tmpfs onde o servico permite (MeshCentral e certbot escrevem na propria pasta); Postgres, Redis e API sem root.
4. **Redis com senha** (`REDIS_PASSWORD`, so variavel de ambiente, sem mudar codigo). Senhas geradas em hex porque entram em strings de conexao.
5. **Somente 80 e 443 publicados**: os agentes usam NATS por WebSocket em `wss://host/natsws` (porta 443). O runbook avisa que o Docker contorna regras do ufw.
6. **Dependencias vulneraveis no CI**: `dotnet list package --vulnerable --include-transitive` com analise da saida (o comando sempre sai com 0) e `npm audit --omit=dev --audit-level=high`.
7. **Backup**: imagem propria `wincare-backup` (postgres:17-alpine nao traz openssl), servico sempre ativo (sem perfil, para o backup nao ficar desligado por esquecimento), conjunto por diretorio com `SHA256SUMS`, manifesto, validacao por `pg_restore --list` e retencao; cifragem opcional `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`; o `.env` so entra no backup se houver senha de cifragem.
8. **Restauracao** (`restore.sh`, no host): valida tudo antes de parar servicos, recria o banco, espera o Postgres por TCP, ajusta o dono dos volumes do MeshCentral e apaga o `mesh_token` para o MeshCentral regravar a chave correspondente aos dados restaurados.
9. **Migracao das 400 estacoes** por ondas (piloto de 10, depois por site), com o servidor do Tactical ligado ate 30 dias depois da ultima onda (`docs/runbooks/migracao-400-estacoes.md`).

## Validacao
- Testes do backend: 83 (15 novos). Provedor OIDC falso nos testes (descoberta, JWKS, PKCE, id_token RS256): criacao automatica com 2FA local pendente, MFA do provedor confiavel, vinculo por e-mail verificado com 2FA local, estado e nonce adulterados, dominio nao permitido, login por senha desativado (exceto superusuario). Relatorios: previa, PDF A4 paisagem, CSV com protecao de formula, SLA de chamados, agendamento disparado uma vez com duas execucoes simultaneas e e-mail com anexo.
- Testes do frontend: 71.
- Ponta a ponta no ambiente Docker:
  - **SSO com o Dex real** (HTTPS por CA local): botao no login, autenticacao no Dex, vinculo pelo e-mail verificado, configuracao obrigatoria do 2FA local no primeiro acesso e pedido do codigo no segundo.
  - **Relatorios**: PDF de agentes, alertas, chamados e disponibilidade SNMP com os dados reais das fases anteriores; agendamento executado com e-mail recebido pelo SMTP local com o PDF anexo.
  - **Navegador**: telas novas e principais telas antigas sem violacao de CSP, sem erro de JavaScript e sem resposta de erro da API.
  - **Backup e restauracao**: backup cifrado do stack em 1 s; restauracao em projeto separado com contagens identicas nas tabelas principais e API saudavel sobre o banco restaurado (detalhes em `docs/runbooks/backup-restauracao.md`).

## Problemas encontrados no teste real e corrigidos
- PDF saia em pagina retrato com o conteudo diagramado em paisagem (colunas cortadas): `PageFormat` + `Orientation` nao giravam a pagina no PDFsharp 6. Agora largura e altura sao explicitas, com teste.
- `CultureInfo("pt-BR")` nao existe com globalizacao invariante: a previa dava erro 500.

## Limites conhecidos
- SAML nao e suportado; so OIDC.
- Depois do SSO com codigo 2FA o usuario cai no painel, nao na pagina de origem (igual ao login por senha).
- Cifragem do backup e CBC sem autenticacao; integridade conferida pelo `SHA256SUMS`.
- Sem copia automatica do backup para fora da VPS; o runbook orienta a copia.
- O `tar` dos volumes do MeshCentral roda com o servico ligado.
- Chaves do Data Protection ficam sem cifragem dentro do dump do banco.
- Nao existe ferramenta para trocar a `VAULT_KEY` (recifrar segredos do cofre).
- Ensaio completo de RTO em VPS nova nao foi feito; a restauracao em si leva segundos no volume atual.
- O plano de migracao nao foi executado; a substituicao do agente do Tactical pelo do WinCare na mesma maquina e deducao a validar no piloto.
- O CI nao publica a imagem `wincare-nginx` (pre-existente); ela e construida na VPS.
- `npm audit` aponta 2 vulnerabilidades baixas no dompurify trazido pelo monaco-editor.
