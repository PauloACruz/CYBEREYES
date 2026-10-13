# ADR-024: Aplicacoes web e servidores SSH no console

- Status: aceito
- Data: 2026-10-13

## Contexto
- Pedido: uma pagina no menu principal para acompanhar o status de aplicacoes web e sites, mandar comandos a eles como num cliente SSH (Termius), alertar quando algum sair do ar e guardar credenciais, configuracao de deploy, IP e usuario SSH. Varias aplicacoes rodam na mesma VPS.
- O Cybereyes ja tinha: alertas com templates (e-mail, webhook, incidente), cofre de credenciais (AES-256-GCM com `VAULT_KEY`), terminal xterm.js pelo hub do console e escopo de clientes por usuario.
- As VPS nem sempre tem o EYES, e muitos sites estao em hospedagem sem agente nem SSH.

## Decisao
1. **Modelo servidor -> aplicacoes**: `app_servers` (endereco, usuario, credencial SSH) e `web_apps` (URL, monitoramento, deploy), com `server_id` opcional. A pagina `/aplicacoes` agrupa as aplicacoes pelo servidor; as sem servidor ficam num grupo "Sem servidor SSH", so com monitoramento.
2. **Monitoramento pela API**, nao pelo agente: verificacao HTTP(S) ou TCP feita pelo servidor do Cybereyes, que e o ponto de vista do visitante e funciona para sites sem agente. Varias replicas dividem as verificacoes por atualizacao condicional de `NextCheckAt` (sem lider nem fila). A queda so vira alerta depois de N falhas seguidas, com a confirmacao antecipada para ate 20 s.
3. **Alertas no modulo existente**: `alerts.web_app_id`, tipos `webapp_down` e `webapp_ssl`, template do cliente da aplicacao. Nao ha canal de notificacao novo.
4. **SSH pela API com SSH.NET** (MIT, 2026.0.0): exec para comandos e deploy, shell com PTY para o terminal. A credencial fica no cofre, so sai dele para conectar ou para quem tem `credentials.reveal`.
5. **Chave do servidor fixada no primeiro acesso (TOFU)**: chave diferente bloqueia a conexao ate liberacao explicita (`apps.manage`), com auditoria. O teste antes de salvar ja fixa a chave vista.
6. **Comandos e deploy fora da requisicao**: execucao gravada em `app_runs`, saida ao vivo pelo SignalR com deslocamento por trecho e gravada a cada 2 s; cancelamento lido do banco (funciona de qualquer replica). Evita o corte de 60 s do Nginx e sobrevive a recarregar a pagina.
7. **Script sem depender das aspas do shell remoto**: base64 dentro de `bash -lc`, entrada de `/dev/null`, `set -e` no deploy, variaveis `CYBEREYES_APP`/`DEPLOY_*`.
8. **Credenciais da aplicacao no cofre que ja existia**: `credentials.web_app_id` e `credentials.app_server_id`, sem tabela nova; aparecem tambem em Documentacao > Credenciais.
9. **Permissoes novas** `apps.view`, `apps.manage`, `apps.run` (grupo "Aplicacoes"); revelar segredo continua em `credentials.reveal`.

## Consequencias
- A VPS do Cybereyes passa a guardar acesso SSH aos servidores dos clientes: comprometer a API ou a `VAULT_KEY` expoe esses servidores. Mitigacoes: cofre fora do banco, auditoria de terminal, comando, deploy e revelacao, permissoes separadas, 2FA obrigatorio. Recomenda-se um usuario de deploy sem root e com `sudo` restrito, e chave dedicada ao Cybereyes.
- Os servidores precisam aceitar SSH vindo do IP da VPS do Cybereyes.
- Trocar o endereco ou a porta de um servidor exige informar a credencial de novo (a salva nunca e enviada a outro host), para quem tem `apps.manage` sem `credentials.reveal` nao conseguir desviar a senha.
- As verificacoes partem da API, dentro da rede do Docker: quem tem `apps.manage` consegue testar portas e URLs internas (so ve codigo de resposta, tempo e erro, nunca o corpo). Por isso `apps.manage` e permissao de administrador.
- Cancelar envia sinal ao processo remoto; servidores que nao implementam sinais em canais sem PTY podem deixar o processo rodando depois que a conexao fecha.
- Sem SFTP/transferencia de arquivos nem encaminhamento de portas nesta versao.
- O terminal vive na replica do WebSocket; reinicio da API derruba as sessoes abertas (como o terminal do agente).
- Verificacoes vem de um ponto so (a VPS do Cybereyes): uma falha de rede dela aparece como queda de todas as aplicacoes.
