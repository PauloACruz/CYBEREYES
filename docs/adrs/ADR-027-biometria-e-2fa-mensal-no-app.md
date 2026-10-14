# ADR-027: Biometria do celular e código do autenticador uma vez por mês no app

- Status: aceito
- Data: 2026-10-14

## Contexto
- Pedido: no app do técnico (PWA), exigir o código do autenticador só uma vez por mês e permitir que o técnico habilite a entrada
  pela biometria do celular.
- O 2FA por TOTP é obrigatório para todos (ADR de autenticação da fase 0): sem ele a sessão fica parcial. A cada entrada no
  celular o técnico digitava a senha e o código.
- O ASP.NET Core Identity do .NET 10 traz passkeys (WebAuthn) prontas: geração das opções, verificação do atestado e da assinatura,
  contador de uso e a tabela `AspNetUserPasskeys` (esquema versão 3).

## Decisão
1. **Aparelho lembrado por 30 dias**: depois do código, o app envia `rememberDevice` e o Identity grava o cookie
   `cybereyes.2fa-aparelho` (HttpOnly, Secure, SameSite=Strict) com prazo fixo de 30 dias, sem renovação a cada uso. Nesse
   aparelho a senha (ou a biometria) basta e a sessão já vale como MFA. A opção aparece marcada no app e não aparece no console
   do computador. O técnico pode voltar a exigir o código no aparelho pela aba Mais.
2. **O cookie do aparelho é preso ao carimbo de segurança** (validador do próprio Identity nesse esquema): trocar a senha ou o
   administrador redefinir o 2FA invalida todos os aparelhos lembrados, em até 1 minuto (intervalo de validação do carimbo).
3. **Biometria = passkey do Identity**, sem biblioteca de terceiros. Só o autenticador do próprio aparelho (`platform`), com
   verificação do usuário (digital, rosto ou PIN do celular) e credencial guardada nele (`residentKey: required`), para entrar
   sem digitar o usuário. Atestado `none`: não há lista de fabricantes permitidos.
4. **A biometria substitui a senha, não o código**: depois dela vale a mesma regra da senha. Aparelho lembrado nos últimos 30 dias:
   entra direto; senão, o app pede o código do autenticador. Assim o código continua sendo pedido uma vez por mês por aparelho.
5. **Domínio e origem fixos**: o RP ID é o host de `App:PublicUrl` e a origem enviada pelo navegador tem de ser a de
   `App:PublicUrl` (sem ela, a da própria requisição). Uma credencial criada para outro endereço não é aceita.
6. **Cadastro só com sessão completa** (senha + 2FA) e no máximo 10 aparelhos por conta. O desafio fica no cookie temporário do
   Identity e só serve uma vez.
7. **Mesmas barreiras da senha na entrada por biometria**: usuário inativo, conta bloqueada por tentativas e política de SSO que
   desativa a senha também barram a biometria. Conta sem 2FA configurado (por exemplo, depois de o administrador redefinir) não
   entra por biometria: configurar um autenticador novo exige a senha.
8. **Redefinir o 2FA pelo administrador remove as biometrias** da conta: o caso comum é o celular perdido.
9. **Atalho do login só no aparelho que cadastrou**: o id da credencial fica no `localStorage`; sem ele o login não mostra
   "Entrar com biometria".

## Consequências
- Um aparelho lembrado com a senha vazada permite entrar sem o código por até 30 dias; quem tem o aparelho e a senha (ou o
  aparelho desbloqueado e a biometria) entra. Mitigação: prazo fixo, cookie preso ao carimbo de segurança, "pedir o código de
  novo" na aba Mais e redefinição pelo administrador.
- Passkeys sincronizadas (iCloud, Google) podem aparecer em outro aparelho do mesmo técnico; nele o código continua sendo pedido
  até que aquele aparelho também seja lembrado.
- A biometria depende de HTTPS e do endereço público configurado em `App:PublicUrl`; trocar o domínio exige cadastrar a biometria
  de novo.
- A migração `Fase16Passkeys` cria só a tabela `AspNetUserPasskeys`; as colunas de login externo e tokens mantêm o tipo atual (o
  esquema versão 3 do Identity as limitaria a 128 caracteres e poderia cortar o `sub` de provedores SSO já gravado).
