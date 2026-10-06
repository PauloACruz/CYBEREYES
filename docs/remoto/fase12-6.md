# Fase 12.6: Linux e macOS

Referencias: RFC-001 (secao 4.5, D-06 e D-07), ADR-023, `docs/remoto/contrato-remoto.md`.

## O que foi entregue

### Linux (X11)

- Tela, entrada, area de transferencia e arquivos ja vinham das fases 12.2, 12.4 e 12.5 (Xvfb no CI).
- Ponteiro do mouse desenhado na imagem pelo XFixes (`GetCursorImage`), porque o `GetImage` nao inclui o cursor.
- Wayland segue fora da captura propria (D-06): a sessao so Wayland responde `wayland`, e o console abre a tela pelo RDP do GNOME levado pelo relay (canal `rdp`, contrato secao 5.4, `docs/remoto/fase12-8.md`).

### macOS (sem CGO, com `ebitengine/purego` 0.11.1, Apache 2.0)

- Pacote `internal/remote/macos`: CoreGraphics, CoreFoundation, ApplicationServices e AppKit carregados em tempo de execucao.
- Captura por `CGDisplayCreateImage`, um quadro por monitor, com escala Retina (X e Y do monitor em pontos, largura e altura em pixels). Sem a permissao de Gravacao de Tela, o EYES pede a permissao ao macOS e responde com erro explicando onde liberar.
- Entrada por `CGEventPost`: teclas pelo keycode virtual do macOS (tabela da fase 12.2), modificadores com as flags do evento, texto Unicode, mouse com arrasto nos tres botoes e rolagem por `CGEventCreateScrollWheelEvent2`. Sem a permissao de Acessibilidade, a sessao fica so de visualizacao e o motivo vai para o log.
- Area de transferencia pelo `NSPasteboard` (`changeCount` a cada 500 ms), sem eco da propria gravacao.
- O remote-helper roda como o usuario do console (`launchctl asuser` e `sudo -u`), entao as permissoes sao concedidas ao EYES nesse usuario. Na janela de login (console do root) nao ha sessao para capturar na v1.

### Aviso e pedido de acesso no Linux e no macOS

- O eyes-tray e instalado pelo EYES no Windows e, desde o ADR-022 (EYES 3.0.3), tambem no Linux; no macOS nao. Quando o app do usuario nao esta conectado, o EYES usa o que o sistema oferece:
  - Linux: pedido pelo `zenity` (Permitir, Recusar e prazo) ou pelo `kdialog`; aviso pelo `notify-send`, como o usuario da sessao (`runuser`), com o `DISPLAY` e o barramento D-Bus dele.
  - macOS: pedido e aviso pelo `osascript` (caixa de dialogo com prazo e notificacao do sistema).
  - Sem nenhum desses, `ask` recusa e `notify` segue sem aviso, como no contrato.
- Nessas caixas nao ha o botao "Encerrar acesso" durante a sessao (so no eyes-tray).

## Mudanca em relacao ao RFC

- O RFC previa ScreenCaptureKit no macOS. A v1 usa `CGDisplayCreateImage`, que se chama direto sem blocos do Objective-C. A Apple indica o ScreenCaptureKit como substituto dessa funcao nas versoes recentes do macOS; se o piloto mostrar falha ou aviso nessas versoes, a captura passa para o ScreenCaptureKit.

## Testes

| Teste | O que confere |
|---|---|
| Go `capture` | mistura do cursor ARGB pre-multiplicado na imagem |
| Go `remote` | pedido de acesso pela caixa do sistema (aceito, recusado e sem resposta); zenity falso no PATH com as saidas 0, 1 e 5; sem zenity nem kdialog |
| `go vet` e `go build` com `CGO_ENABLED=0` para darwin amd64 e arm64 | o codigo do macOS compila e passa no vet |

## O que ficou pendente desta fase

- Execucao em macOS real (S6): captura, entrada, area de transferencia, permissoes e o comportamento das permissoes a cada atualizacao do binario sem assinatura (D-07). Roteiro do piloto, secao 6.
- Linux em maquina real com GNOME ou KDE em X11 (zenity, kdialog e notify-send da distribuicao). Roteiro do piloto, secao 6.
