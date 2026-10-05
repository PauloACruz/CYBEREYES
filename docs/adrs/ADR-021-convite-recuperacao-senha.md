# ADR-021: Convite de usuarios e recuperacao de senha por e-mail

- Status: aceito
- Data: 2026-10-05

## Contexto
Com o SMTP de producao configurado (Hostinger, `no-reply@pcruzti.com.br`), o e-mail passou a servir para mais que alertas e relatorios. Ate aqui o administrador criava o usuario ja com senha e era o unico que podia redefini-la: a senha inicial trafegava fora do sistema e um tecnico que esquecia a senha dependia do administrador.

## Decisao
1. **Recuperacao de senha pelo proprio usuario** com o token de redefinicao do ASP.NET Identity (provedor padrao de Data Protection, validade reduzida de 1 dia para **2 horas**). O link e de uso unico porque a troca de senha muda o security stamp.
2. **Convite por e-mail** na criacao do usuario: o usuario nasce sem senha e recebe um link para cria-la. Provedor de token proprio (`Invite`, **72 horas**) para nao alongar a validade da redefinicao de senha. Reenviar troca o security stamp e invalida o link anterior.
3. **Sem enumeracao de contas**: `POST /api/auth/password/forgot` responde 202 sempre, e o e-mail sai em segundo plano para a resposta levar o mesmo tempo exista a conta ou nao. Limite de um e-mail a cada 2 minutos por usuario (consultado na auditoria, vale para as duas replicas da API), alem do limite `auth` por IP.
4. **O 2FA continua obrigatorio**: redefinir a senha ou aceitar o convite nao inicia sessao. O usuario entra pelo login normal, com senha e codigo TOTP (ou configura o 2FA no primeiro acesso).
5. Usuarios com login por senha bloqueado pelo SSO (`DisablePasswordLogin`) nao recebem o link de redefinicao.
6. O token vai na query string do link. O Nginx de borda envia `Referrer-Policy: no-referrer`, entao ele nao vaza para outros sites.

## Consequencias
- O fluxo depende do SMTP configurado. Sem ele, o convite e recusado com mensagem clara e a recuperacao de senha nao envia nada (fica registrado no log da API).
- A validade de 2 horas tambem vale para outros tokens do provedor padrao (nao ha outro uso hoje alem da redefinicao feita pelo administrador, que gera e consome o token na mesma requisicao).
- Os nomes de proposito do Data Protection dos tokens (`Invite` e os do Identity) ficam sob o `ApplicationName` "WinCare" (ADR-019); nao foram criados novos propositos em `DataProtectionNames`.
- Os e-mails sao texto simples, sem acentos, como os de alertas e relatorios.
- Entregabilidade: o dominio precisa de SPF (ja tem `include:_spf.mail.hostinger.com`) e deveria ter DKIM (registros CNAME `hostingermail*._domainkey` do painel da Hostinger, ainda nao publicados em 2026-10-05) para nao cair no spam.
