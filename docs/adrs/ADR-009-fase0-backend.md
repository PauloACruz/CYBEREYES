# ADR-009: Decisoes tecnicas da fase 0 do backend

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Projeto `Cybereyes.Core` em vez de `Cybereyes.Shared`**: "Shared" e palavra reservada em VB e o analisador (CA1716) bloqueia o build com avisos tratados como erro.
2. **Sessao por cookie no console**: cookie HttpOnly, Secure e SameSite=Strict, emitido pelo ASP.NET Core Identity. Evita guardar token no navegador. SameSite=Strict bloqueia o envio do cookie em requisicoes vindas de outros sites, que e a protecao contra CSRF adotada nesta fase.
3. **2FA obrigatorio**: politica padrao e de fallback exigem a claim `amr=mfa` (ou autenticacao por chave de API). Sem 2FA, o usuario so acessa configuracao de 2FA, `me` e `logout`.
4. **Permissoes lidas do banco a cada requisicao** (`IClaimsTransformation`): mudanca de papel vale na hora, sem novo login. Custo de uma consulta por requisicao, aceitavel para a escala atual.
5. **Sem camada de repositorio**: os endpoints usam o `DbContext` do EF Core, que ja implementa repositorio e unidade de trabalho. Os testes de integracao rodam contra PostgreSQL real (Testcontainers), cobrindo consultas reais.
6. **Erros no formato ProblemDetails** (RFC 9457) com a extensao `code`, padrao nativo do ASP.NET Core.
7. **Chaves de API**: guardadas apenas como hash SHA-256; a chave aparece uma unica vez na criacao.
8. **MeshCentral com banco interno (NeDB)**: padrao do MeshCentral, suficiente para 400 estacoes e sem um banco extra. Reavaliar se a escala crescer.
9. **NATS websocket sem TLS interno**: o TLS termina no Nginx; o NATS so e acessivel pela rede interna do Docker.
10. **Nginx como balanceador de carga**: upstreams com `resolve` (disponivel no Nginx open source desde a 1.27.3) e `least_conn`, que descobrem as replicas da API pelo DNS interno do Docker sem reiniciar o Nginx. Certificados: proprio em `certs/<host>/`, senao Let's Encrypt (Certbot por webroot), senao autoassinado temporario para o Nginx subir antes da primeira emissao.
11. **Varias replicas da API**: as chaves de protecao de dados (que cifram o cookie de sessao) ficam no PostgreSQL, para qualquer replica aceitar a sessao criada por outra. As migracoes rodam no servico `migrate`, uma unica vez, antes das replicas subirem.
12. **Limites conhecidos**: o limitador de tentativas de login e por replica; com 2 replicas o limite efetivo por IP dobra. Aceitavel nesta fase; mover para o Redis se necessario. Quando uma replica cai, requisicoes em andamento para ela podem falhar com 504 por ate alguns segundos, ate o Nginx deixar de usa-la.
