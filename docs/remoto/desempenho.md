# Desempenho do acesso remoto (canal desktop)

Medicao e ajustes da tela propria (EYES `remote-helper`, relay da API e visualizador do console). O contrato de fio
esta em `contrato-remoto.md`, secoes 5.1 a 5.3.

## Linha de base (EYES 3.1.0, 2026-10-05)

Maquina de producao `impressora`: Intel Core i3-4130 (2 nucleos, 4 threads), Intel HD 4400, 1600 x 900, Windows 10
22H2. Sessoes somente de visualizacao, medidas pelo console com um cliente do relay em JavaScript (pedido de quadro
com `REFRESH` e `ACK` como o visualizador).

| Medida | Valor |
|---|---|
| CPU do `remote-helper` com a tela parada (tela bloqueada) | 22% de um nucleo |
| Primeiro quadro | 2,34 s |
| Quadro completo pedido e recebido (`REFRESH` ate `FRAME_END`) | p50 533 ms, p90 583 ms; 1,9 quadros/s |
| Quadro completo | 147 KiB, 103 blocos |
| Escala 0,5 ou qualidade 30 | os mesmos ~530 ms (nao era banda nem CPU) |
| Envio continuo (`REFRESH` a cada 33 ms) | 1,0 a 2,8 quadros/s, p90 990 ms, `remote-helper` a 48% de um nucleo |
| Ida e volta navegador-VPS | ~220 ms; API-agente com o navegador, 392 ms |

Causas encontradas:

1. Janela fixa de 2 quadros sem `ACK`: com ~400 ms de ida e volta, no maximo ~5 quadros/s em qualquer rede.
2. Captura e codificacao numa thread so: ~170 ms de CPU por quadro completo, com 6 MB alocados por quadro.
3. GDI relendo a tela 15 vezes por segundo mesmo parada.
4. Cursor desenhado na imagem: o ponteiro andava no ritmo dos quadros (~0,5 s de atraso).
5. Captura e entrada na mesma thread: uma captura lenta atrasava o mouse e o teclado.
6. Movimentos do mouse sem agrupamento: risco de passar dos 200 quadros/s do relay e derrubar a sessao.

## O que mudou (EYES 3.2.0)

- Captura no Windows pelo DXGI Desktop Duplication (Go puro, chamadas COM pela vtable): a GPU entrega so os
  quadros com mudanca e a lista de regioes alteradas; tela parada nao custa nada. Com adaptador de video basico (VM),
  a imagem vem da memoria do sistema pelo `MapDesktopSurface`, sem copia na GPU. O GDI fica como alternativa (sessao
  de Area de Trabalho Remota, driver sem suporte, monitor girado, tela segura sem acesso), com nova tentativa do DXGI
  em 3 s (1 minuto quando nao ha suporte). Buffers reaproveitados e conversao BGRA para RGBA em paralelo, fora da
  thread da area de trabalho.
- Duas threads presas a area de trabalho de entrada: uma para a captura, outra para a entrada. A troca de area de
  trabalho (UAC, tela bloqueada) virou uma geracao por consumidor, entao nenhum recurso do GDI ou do DXGI fica preso a
  area de trabalho anterior.
- Codificador: copia propria do ultimo quadro, comparacao so nas regioes que o DXGI aponta, blocos vizinhos juntos ate
  256 x 256, JPEG em paralelo (ate 4 nucleos) e escala com buffer reaproveitado.
- Refinamento: com a tela parada por 400 ms, os blocos que foram com qualidade menor voltam em qualidade 90, em partes
  de 96 blocos (um quadro novo nunca espera um refinamento grande).
- Controle de fluxo pela ida e volta minima e pela banda medida nas confirmacoes (como o BBR): ate 12 quadros e
  2 x banda x ida e volta em bytes sem `ACK`. Qualidade cai com fila ou janela cheia e sobe devagar com folga.
- Ritmo: `maxFps` respeitado de verdade (antes cada `ACK` disparava um quadro), captura por leitura da tela caindo
  para 4 por segundo depois de 2 s parada, entrada do tecnico voltando ao ritmo na hora.
- Cursor separado (`CURSOR`, feature `cursor`): posicao a cada 33 ms, desenho uma vez por forma. No console o ponteiro
  local ganha a forma do remoto (sem atraso nenhum) e o cursor remoto aparece desenhado quando o tecnico so assiste,
  esta com o mouse fora da tela ou quando outra pessoa move o cursor.
- Visualizador: movimentos e roda agrupados a cada 16 ms (botoes e teclas na hora), canvas opaco com contexto
  reaproveitado, JPEG decodificado direto do quadro recebido (sem copia).
- Relay da API: o canal de tela le cada mensagem num buffer reaproveitado do `ArrayPool` em vez de `MemoryStream` e
  `ToArray` por quadro (cerca de 3 copias e varias alocacoes a menos por bloco).
- Predefinicoes do console: Alta 80/30 q/s, Media 60/24 q/s, Baixa 40 com escala 0,75/15 q/s.
- Log do `remote-helper` a cada minuto: metodo de captura (e por que o DXGI nao esta em uso), capturas, quadros,
  refinamentos, quadros segurados pela janela, KiB, tempo medio de captura e de codificacao, qualidade, ida e volta e
  banda estimada.

## Como medir

1. Abra o console autenticado e uma sessao somente de visualizacao (nao mexe na maquina do usuario).
2. Tela parada: CPU do `eyes remote-helper` no Gerenciador de Tarefas (ou `Get-Process`) por 1 minuto.
3. Movimento: arraste uma janela ou role uma pagina na maquina e acompanhe os quadros por segundo no log do
   `remote-helper` (linha "desempenho da tela").
4. Latencia de pedido e resposta: `REFRESH` seguido do `FRAME_END`, varias vezes, com `ACK` de cada quadro.
