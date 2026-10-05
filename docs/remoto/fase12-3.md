# Fase 12.3: tela completa no Windows

Referencias: RFC-001, ADR-022, `docs/remoto/contrato-remoto.md` (secoes 5 e 8.3), `docs/remoto/roteiro-piloto.md`.

## O que foi entregue

### EYES (Go, sem CGO)

- `internal/remote/windesk`: thread fixa que segue a area de trabalho de entrada (`OpenInputDesktop` e `SetThreadDesktop`). Com isso a captura e a entrada funcionam no uso normal ("Default") e tambem na tela bloqueada, na tela de login e na confirmacao do UAC ("Winlogon"). O processo fica com DPI por monitor (pixels fisicos).
- Captura por GDI (`BitBlt` com `CAPTUREBLT` para uma DIB de 32 bits), ponteiro do mouse desenhado na imagem, varios monitores com nome, posicao e escala (`EnumDisplayMonitors`, `GetDpiForMonitor`). Os DCs sao refeitos quando a area de trabalho muda.
- Entrada por `SendInput`: teclas pelo scancode (o layout da estacao vale), Pause pela tecla virtual, texto Unicode, mouse absoluto na area de trabalho virtual (varios monitores), botoes laterais, rolagem vertical e horizontal.
- Ctrl+Alt+Del por `SendSAS`. Quando a politica `SoftwareSASGeneration` nao permite servicos, ela e ligada so durante a chamada e volta ao valor anterior 2 s depois.
- O remote-helper roda como SYSTEM na sessao do usuario: o servico copia o proprio token e troca a sessao (`TokenSessionId`). Escolha da sessao: a do console com usuario; senao uma sessao ativa da Area de Trabalho Remota; senao a tela de login, se a politica permitir.
- Canal de controle do servico para o remote-helper pela entrada padrao (linhas JSON depois dos parametros): resultado do pedido de acesso e fim pedido pelo usuario.

### Aviso e consentimento pelo eyes-tray

- Agente: o canal local do eyes-tray aceita `{"cmd":"subscribe"}` e passa a mandar `remote-notify`, `remote-ask` e `remote-ended`; aceita `remote-answer` e `remote-end` so de conexoes do usuario da sessao acessada (quando as duas pontas trazem dominio, o dominio tambem precisa bater).
- eyes-tray: janela "Pedido de acesso remoto" com Permitir, Recusar e contagem regressiva; faixa "<tecnico> esta acessando este computador" com "Encerrar acesso"; notificacao do sistema no inicio do acesso.
- `ask` sem eyes-tray conectado recusa; `notify` sem eyes-tray segue sem aviso e registra no log do agente (contrato, secao 8.3).

### API e console

- `GET /api/remote/sessions` aceita `ticketId`.
- Aba "Acessos remotos" no agente (inicio, tecnico, tipo, duracao, situacao ou motivo do fim) e lista "Acessos remotos" na barra lateral do chamado.

## Testes

| Teste | O que confere |
|---|---|
| Go `internal/tray` | pedido aceito pelo usuario da sessao; resposta de outro usuario ignorada e tempo esgotado; sem app conectado; aviso e fim pedido pelo usuario; regra de usuario e dominio |
| Go `internal/remote` | pedido sem eyes-tray vira "denied" para o remote-helper; politica `none` nao manda controle; conversao de coordenadas da area de trabalho virtual |
| Go `tray/internal/ipc` | assinatura dos eventos e envio da resposta pelo app |
| vitest do eyes-tray | pedido com contagem, Permitir e Recusar; aviso e "Encerrar acesso" |
| vitest do console | aba "Acessos remotos" (duracao, motivo do fim, filtro por agente) |
| `RemoteE2ETests` | o EYES real no Xvfb continua passando com o novo canal de controle |
| `go vet` com `GOOS=windows` (amd64 e 386) e `GOOS=darwin` | o codigo do Windows compila e passa no vet |

## O que ficou pendente desta fase

- Execucao em Windows real: nao ha Windows neste ambiente. O codigo foi compilado e verificado (`go vet`) para Windows, mas captura, entrada, UAC, tela bloqueada, Ctrl+Alt+Del e o lancamento na sessao do usuario so serao confirmados no roteiro `docs/remoto/roteiro-piloto.md`, secoes 1 e 2.
- Em especial, o tempo de 2 s para devolver a politica `SoftwareSASGeneration` e uma escolha conservadora que precisa ser conferida no piloto.
