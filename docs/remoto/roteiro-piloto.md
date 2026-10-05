# Roteiro do piloto do acesso remoto proprio

Referencias: RFC-001 (secoes 7, 9 e 11), ADR-022, `docs/remoto/contrato-remoto.md`.

Este roteiro valida em maquinas reais o que o CI nao alcanca: Windows (prova S1), macOS (S6), navegadores reais e a rede do cliente. Cada item tem o resultado esperado; anote o que aconteceu, a versao do EYES e a data. Um item que falha volta para a fase correspondente antes do corte (fase 12.8).

## Preparacao

- Servidor com a versao do branch, `Remote:Enabled` ligado e EYES 3.1.0 ou mais novo nas maquinas de teste.
- Tecnico com `agents.remote` e `agents.files`; um segundo tecnico sem `agents.files`.
- Maquinas: Windows 10 e Windows 11 fisicos, uma maquina virtual Windows, um Linux com X11 e um Mac.
- Navegadores do tecnico: Chrome, Edge e Firefox atuais; Safari no Mac.

## 1. Tela no Windows (fase 12.3)

| # | Passo | Esperado |
|---|---|---|
| 1.1 | Abrir "Acesso remoto > Tela" no agente Windows 10 com usuario conectado | primeiro quadro em poucos segundos; ponteiro do mouse visivel na imagem |
| 1.2 | Mover, clicar, arrastar, botao direito, rolar | resposta imediata, sem cliques perdidos |
| 1.3 | Digitar texto com acentos (layout ABNT2 na estacao) | texto igual ao digitado; teclas de atalho (Ctrl+C, Alt+Tab em tela cheia) chegam |
| 1.4 | Tela cheia no Chrome e no Edge, apertar a tecla Windows e Alt+Tab | vao para a maquina remota (Keyboard Lock) |
| 1.5 | Botao Ctrl+Alt+Del | aparece a tela de seguranca do Windows; a politica `SoftwareSASGeneration` volta ao valor anterior depois de 2 s |
| 1.6 | Abrir um programa como administrador (UAC) | a confirmacao do UAC aparece no visualizador e aceita clique |
| 1.7 | Bloquear a estacao (Win+L) e desbloquear pelo visualizador | a tela de bloqueio aparece e aceita a senha |
| 1.8 | Troca rapida de usuario | a sessao segue na sessao do console ou termina com mensagem clara |
| 1.9 | Dois monitores, escala 100% e 150% | os dois aparecem no seletor; cliques caem no ponto certo nos dois |
| 1.10 | Mesmo roteiro no Windows 11 e na maquina virtual | igual aos itens anteriores |
| 1.11 | "Somente visualizar" | imagem chega; teclado, mouse e Ctrl+Alt+Del nao fazem nada |
| 1.12 | Encerrar pelo console | o remote-helper termina na estacao (Gerenciador de Tarefas) e a sessao fica "Encerrada" no historico |

## 2. Aviso e consentimento (fase 12.3)

| # | Passo | Esperado |
|---|---|---|
| 2.1 | Politica `notify`, abrir a tela | o eyes-tray mostra "<tecnico> esta acessando este computador" com "Encerrar acesso" durante toda a sessao |
| 2.2 | Clicar em "Encerrar acesso" no eyes-tray | o visualizador mostra "O usuario da maquina encerrou o acesso." |
| 2.3 | Politica `ask`, usuario clica Permitir | o visualizador sai de "Aguardando o usuario aceitar" e mostra a tela; o aviso fica no eyes-tray |
| 2.4 | Politica `ask`, usuario clica Recusar | o visualizador mostra "O usuario recusou o acesso." |
| 2.5 | Politica `ask`, ninguem responde | depois do tempo da politica, "O usuario nao respondeu ao pedido de acesso." |
| 2.6 | Politica `ask` com o eyes-tray fechado | o acesso e recusado e o log do EYES registra o motivo |

## 3. Historico

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Aba "Acessos remotos" do agente | cada sessao com inicio, tecnico, tipo, duracao e motivo do fim |
| 3.2 | Acesso aberto pela barra lateral do chamado | a sessao aparece em "Acessos remotos" do chamado |

## 4. Area de transferencia (fase 12.4)

| # | Passo | Esperado |
|---|---|---|
| 4.1 | Copiar um texto no Bloco de Notas da estacao Windows | o texto fica na area de transferencia do tecnico em ate 1 s, sem clique (Chrome e Edge); colar no computador do tecnico funciona |
| 4.2 | Copiar um texto no computador do tecnico e apertar Ctrl+V dentro da tela | o texto local e colado na estacao (Chrome, Edge e Firefox) |
| 4.3 | Repetir 4.2 com Cmd+V no Safari (Mac do tecnico) | o texto e colado. Conferir o que a estacao Windows recebe: o Cmd segue como tecla Windows, entao a combinacao pode virar Win+V; se acontecer, registrar para mapear Cmd para Ctrl no visualizador |
| 4.4 | Copiar com acentos, emoji e varias linhas | o texto chega igual nos dois sentidos |
| 4.5 | Politica com `clipboardToRemote` desligado | Ctrl+V nao cola o texto local; copiar na estacao continua chegando |
| 4.6 | Politica com `clipboardToLocal` desligado | copiar na estacao nao chega; Ctrl+V continua colando |
| 4.7 | Somente visualizar | o texto do tecnico nunca chega a estacao |
| 4.8 | Texto acima de 1 MiB | nao e sincronizado e nada trava |

## 5. Itens das fases seguintes

As fases 12.5 a 12.7 acrescentam aqui os roteiros de arquivos, Linux, macOS e Wake-on-LAN.

## Registro

| Data | Maquina | Versao do EYES | Itens | Resultado | Observacoes |
|---|---|---|---|---|---|
| | | | | | |
