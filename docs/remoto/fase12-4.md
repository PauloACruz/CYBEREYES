# Fase 12.4: area de transferencia automatica

Referencias: RFC-001 (secao 4.6), ADR-022, `docs/remoto/contrato-remoto.md` (secao 6).

## O que foi entregue

### EYES

- Pacote `internal/remote/clip`: texto da area de transferencia da sessao com aviso de mudanca.
  - X11: selecao `CLIPBOARD` acompanhada pelo XFixes; leitura por `ConvertSelection` (UTF8_STRING) e gravacao assumindo a selecao e respondendo `TARGETS`, `UTF8_STRING`, `STRING` e `TEXT`. Textos acima de 200 KiB nao sao servidos a outros programas no X11 (sem o protocolo INCR).
  - Windows: janela so de mensagens com `AddClipboardFormatListener` (`WM_CLIPBOARDUPDATE`), leitura e gravacao de `CF_UNICODETEXT` na thread da janela.
- Sincronizacao no remote-helper: envia `CLIPBOARD` a cada mudanca feita por outro programa, grava o que chega do visualizador, sem eco (o hash SHA-256 do ultimo texto trocado nao e repetido, e o agente recalcula o hash do que recebe), limite de 1 MiB, politica `clipboardToRemote` e `clipboardToLocal` aplicada no agente, nada do visualizador gravado em somente visualizacao, `clipboard-text` anunciado no HELLO so quando algum sentido esta ligado.

### Visualizador

- O texto que chega da estacao vai para a area de transferencia local com `writeText`; se o navegador recusar por falta de gesto, fica guardado e e gravado no proximo clique ou tecla dentro da tela.
- Ctrl+V (ou Cmd+V) dentro da tela: o visualizador espera o evento `paste`, envia o texto local e so depois manda as teclas V (se o evento nao vier em 300 ms, as teclas seguem sozinhas).
- No foco da tela, quando o navegador ja deu a permissao de leitura (Chrome e Edge), o texto local e enviado se mudou.
- Icone "Area de transferencia sincronizada" na barra quando a estacao anuncia o recurso.

### API

- Sem mudanca de codigo: o relay ja contava quadros e bytes de `CLIPBOARD` por sentido (`clipboardToRemote`, `clipboardToLocal`); o conteudo nunca vai para log nem banco.

## Testes

| Teste | O que confere |
|---|---|
| Go `clip` (Xvfb e xclip) | aviso quando outro programa copia, leitura do texto, gravacao colada pelo xclip, sem aviso da propria gravacao |
| Go `remote` | os dois sentidos sem eco, politica bloqueando cada sentido, politica com os dois desligados sem sincronizacao |
| vitest `clipboard` | gravacao local, sem eco, pendente ate o gesto, SHA-256, limite de 1 MiB, recurso desligado |
| vitest da pagina | Ctrl+V manda `CLIPBOARD` antes das duas teclas V e ignora a tecla solta depois |
| `RemoteE2ETests` | EYES real no Xvfb: texto do tecnico colado pelo xclip, texto copiado pelo xclip chega ao visualizador, contagem 1 e 1 na sessao |
| CI | os jobs `agent/test` e `backend` sobem Xvfb com xdotool e xclip |

## O que ficou pendente desta fase

- Imagem PNG na area de transferencia (segunda etapa do contrato, recurso `clipboard-png`): nao implementada.
- Windows real, Firefox e Safari: entram no roteiro do piloto (secao 4 de `docs/remoto/roteiro-piloto.md`).
- macOS: fase 12.6.
