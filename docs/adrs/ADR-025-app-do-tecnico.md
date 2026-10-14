# ADR-025: App do tecnico (PWA) dentro do console

- Status: aceito
- Data: 2026-10-14

## Contexto
- Pedido: um aplicativo com foco em celular, priorizando chamados, o Cybereyes Care nos agentes, o acompanhamento do status dos agentes e das aplicacoes e comandos basicos nos agentes.
- O console ja tinha todas as APIs, o login com 2FA por cookie, o hub do SignalR e as permissoes por papel. As telas foram desenhadas no canvas (pranchas Mobile*).

## Decisao
1. **Mesmo frontend, rotas `/app/*`**: o app e uma area do SPA React com layout proprio (cabecalho e barra de abas flutuantes, alvos de toque de 44 px ou mais). Usa a mesma API, o mesmo cookie de sessao e as mesmas permissoes; nao ha backend novo nem app nativo.
2. **PWA instalavel**: `manifest.webmanifest` com `start_url` `/app` e `display: standalone`, icones gerados a partir do emblema e um service worker minimo (`sw.js`) que so guarda `offline.html` para navegacao sem rede. Nenhuma resposta da API e guardada em cache: dados de chamados e agentes nao ficam no aparelho. O Nginx serve `sw.js` e o manifesto com `no-cache` para atualizacoes chegarem logo.
3. **Volta depois do login**: quem abre uma tela do app sem sessao volta a ela depois do login (e do 2FA). O caminho fica no `sessionStorage` e so caminhos `/app` sao aceitos, para nao virar redirecionamento aberto.
4. **Reuso das pecas do console**: formulario de novo chamado, resposta e conversa do chamado, cartoes de status e tecnico, formulario e execucao do Cybereyes Care, desligar e alterar hostname. A logica comum saiu para hooks (`ticketReply.ts`, `careRuns.ts`).
5. **O que fica no console**: scripts, arquivos, cadastros, deploy e terminal SSH. No app esses itens abrem a tela correspondente do console.
6. **Comandos rapidos so com efeito seguro**: leitura ou acoes reversiveis do dia a dia (espaco em disco, servicos parados, reiniciar o spooler, limpar o cache DNS). Nada que derrube a rede da maquina, porque o agente perderia a conexao no meio do comando. Todo comando pede confirmacao e fica no historico e na auditoria, como no console.
7. **No celular, o endereco principal abre o app** (tela estreita com toque, ou o app instalado): a pagina inicial `/` leva para
   `/app`. "Abrir o console completo" no app guarda a escolha no aparelho (`localStorage`); "App do tecnico" no menu do usuario
   do console desfaz. Links diretos para telas do console (por exemplo `/agentes/12`) continuam abrindo o console.
8. **Entrada no formato do app**: no celular, ou com uma tela do app esperando o login, a tela de login mostra "App do tecnico",
   aceita usuario ou e-mail (o e-mail e unico por conta) e explica a verificacao em duas etapas.

## Consequencias
- Uma unica base de codigo: mudancas na API valem para o console e para o app ao mesmo tempo, e os testes do frontend cobrem as duas areas.
- Sem notificacoes push nesta versao (exigiria Web Push com chaves VAPID e assinatura por aparelho).
- Sem uso offline alem da pagina "Sem conexao": o app depende da rede para tudo.
- No iOS a instalacao e pelo menu Compartilhar > Adicionar a Tela de Inicio; o Safari nao mostra aviso automatico de instalacao.
